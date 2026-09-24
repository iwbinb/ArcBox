import { createPublicClient, http, hashMessage, recoverMessageAddress, encodeFunctionData, decodeFunctionResult, type Address, type Hex } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { address, ApiError, bad, body, CHALLENGE_COOKIE, configuration, cookie, digest, equal, randomToken, rate, response, SESSION_COOKIE, setCookie, type IdentityEnv } from './security';

const SESSION_MS=8*60*60*1000;
const CHALLENGE_MS=5*60*1000;
const statement='Sign in to ArcBox. This message does not authorize a payment or transaction.';
const signatureAbi=[{type:'function',name:'isValidSignature',stateMutability:'view',inputs:[{name:'hash',type:'bytes32'},{name:'signature',type:'bytes'}],outputs:[{type:'bytes4'}]}] as const;
export interface Identity {userId:string;address:Address;expiresAt:number;token:string;csrf:string;tokenHash:string}
interface Challenge {nonce_hash:string;binding_hash:string;address:string;message:string;expires_at:number;session_until:number;created_at:number}
interface Session {user_id:string;address:Address;expires_at:number;signer_kind:'eoa'|'erc1271';signed_message:string|null;signature:Hex|null}

// EOA recovery proves the address's signing key. Contract signatures use only
// bounded eth_call to a deployed ERC-1271 contract; never a deploy/factory call.
export async function verifySignature(env:IdentityEnv,wallet:Address,message:string,signature:Hex,contractOnly=false):Promise<'eoa'|'erc1271'> {
  if(!/^0x(?:[0-9a-fA-F]{2}){1,4096}$/.test(signature))return bad(401,'INVALID_SIGNATURE');
  if(!contractOnly){
    try { if((await recoverMessageAddress({message,signature})).toLowerCase()===wallet.toLowerCase())return 'eoa'; }catch{/* Try only deployed ERC-1271 below. */}
  }
  const client=createPublicClient({transport:http(env.RPC_URL,{timeout:5000,retryCount:0}),batch:{multicall:false}});
  try{
    if(await client.getChainId()!==5042002) return bad(503,'RPC_CHAIN_MISMATCH');
    const code=await client.getCode({address:wallet});
    if(!code || code==='0x' || code.startsWith('0xef0100'))return bad(401,'INVALID_SIGNATURE');
    const result=await client.call({to:wallet,data:encodeFunctionData({abi:signatureAbi,functionName:'isValidSignature',args:[hashMessage(message),signature]}),gas:100000n});
    if(!result.data)return bad(401,'INVALID_SIGNATURE');
    const magic=decodeFunctionResult({abi:signatureAbi,functionName:'isValidSignature',data:result.data});
    if(magic!=='0x1626ba7e')return bad(401,'INVALID_SIGNATURE');
    return 'erc1271';
  }catch(error){if(error instanceof ApiError)throw error; return bad(503,'SIGNATURE_CHECK_UNAVAILABLE');}
}
export async function challenge(request:Request,env:IdentityEnv):Promise<Response> {
  const input=await body(request,['address','chainId']);
  const wallet=address(input.address);
  if(input.chainId!==5042002)bad(422,'WRONG_CHAIN');
  await rate(env.DB,`nonce-ip:${request.headers.get('CF-Connecting-IP')??'local'}`,40);
  await rate(env.DB,`nonce-wallet:${wallet.toLowerCase()}`,10);
  const now=Date.now(),nonce=randomToken(),binding=randomToken(),until=now+SESSION_MS;
  const origin=configuration(env);
  const message=createSiweMessage({address:wallet,chainId:5042002,domain:origin.host,scheme:origin.protocol.slice(0,-1),uri:`${origin.origin}/app`,version:'1',statement,nonce,issuedAt:new Date(now),expirationTime:new Date(until)});
  await env.DB.prepare('INSERT INTO auth_challenges(nonce_hash,binding_hash,address,message,created_at,expires_at,session_until) VALUES(?1,?2,?3,?4,?5,?6,?7)').bind(await digest(nonce),await digest(binding),wallet.toLowerCase(),message,now,now+CHALLENGE_MS,until).run();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_challenges WHERE nonce_hash IN (SELECT nonce_hash FROM auth_challenges WHERE expires_at<?1 LIMIT 100)').bind(now),
    env.DB.prepare('DELETE FROM auth_grants WHERE nonce_hash IN (SELECT nonce_hash FROM auth_grants WHERE created_at<?1 LIMIT 100)').bind(now-SESSION_MS),
    env.DB.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<?1 LIMIT 100)').bind(now),
  ]);
  return response({nonce,message,expiresAt:now+CHALLENGE_MS},200,{'Set-Cookie':setCookie(CHALLENGE_COOKIE,binding,300)});
}
export async function login(request:Request,env:IdentityEnv):Promise<Response> {
  const input=await body(request,['nonce','message','signature']);
  if(typeof input.nonce!=='string'||!/^[a-f0-9]{64}$/.test(input.nonce)||typeof input.message!=='string'||typeof input.signature!=='string')return bad(422,'INVALID_BODY');
  const binding=cookie(request,CHALLENGE_COOKIE); if(!binding)return bad(401,'CHALLENGE_REQUIRED');
  await rate(env.DB,`verify:${await digest(binding)}`,10);
  const hash=await digest(input.nonce),now=Date.now();
  const stored=await env.DB.prepare('SELECT * FROM auth_challenges WHERE nonce_hash=?1').bind(hash).first<Challenge>();
  if(!stored||stored.expires_at<=now||stored.created_at>now||!equal(stored.binding_hash,await digest(binding))||stored.message!==input.message) return bad(401,'INVALID_CHALLENGE');
  const kind=await verifySignature(env,address(stored.address),stored.message,input.signature as Hex);
  const token=randomToken(),tokenHash=await digest(token),operation=randomToken(),userId=`5042002:${stored.address}`,old=cookie(request,SESSION_COOKIE);
  // Each statement depends on the unique operation gate. Competing verification
  // rolls back or inserts no session, even if its earlier SELECT saw the nonce.
  const batch=[
    env.DB.prepare('INSERT INTO auth_grants(nonce_hash,operation_id,created_at) SELECT nonce_hash,?2,?3 FROM auth_challenges WHERE nonce_hash=?1 AND expires_at>?3 AND binding_hash=?4').bind(hash,operation,Date.now(),await digest(binding)),
    env.DB.prepare('INSERT INTO users(id,address,chain_id,created_at) SELECT ?1,?2,5042002,?3 WHERE EXISTS(SELECT 1 FROM auth_grants WHERE operation_id=?4) ON CONFLICT(id) DO NOTHING').bind(userId,stored.address,now,operation),
    env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at,signer_kind,signed_message,signature) SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE EXISTS(SELECT 1 FROM auth_grants WHERE operation_id=?8)').bind(tokenHash,userId,stored.session_until,now,kind,kind==='erc1271'?stored.message:null,kind==='erc1271'?input.signature:null,operation),
    env.DB.prepare('UPDATE sessions SET revoked_at=?1 WHERE token_hash=?2 AND EXISTS(SELECT 1 FROM auth_grants WHERE operation_id=?3)').bind(now,old?await digest(old):'',operation),
    env.DB.prepare("INSERT INTO audit_logs(workspace_id,actor_id,action,entity_id,created_at) SELECT NULL,?1,'auth.login',?1,?2 WHERE EXISTS(SELECT 1 FROM auth_grants WHERE operation_id=?3)").bind(userId,now,operation),
    env.DB.prepare('DELETE FROM auth_challenges WHERE nonce_hash=?1 AND EXISTS(SELECT 1 FROM auth_grants WHERE operation_id=?2)').bind(hash,operation),
  ];
  let applied:D1Result[];
  try{applied=await env.DB.batch(batch);}catch(error){if(String(error).includes('UNIQUE constraint'))return bad(409,'CHALLENGE_CONSUMED');throw error;}
  if(applied[2]?.meta.changes!==1)return bad(401,'INVALID_CHALLENGE');
  const result=response({user:{id:userId,address:address(stored.address),chainId:5042002},expiresAt:stored.session_until,csrfToken:await digest(`csrf:${token}`)});
  result.headers.append('Set-Cookie',setCookie(SESSION_COOKIE,token,Math.max(0,Math.floor((stored.session_until-Date.now())/1000))));
  result.headers.append('Set-Cookie',setCookie(CHALLENGE_COOKIE,'',0));
  return result;
}
export async function authenticate(request:Request,env:IdentityEnv,mutating=false):Promise<Identity> {
  const token=cookie(request,SESSION_COOKIE); if(!token)return bad(401,'AUTH_REQUIRED');
  const tokenHash=await digest(token),now=Date.now();
  const row=await env.DB.prepare('SELECT s.*,u.address FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>?2').bind(tokenHash,now).first<Session>();
  if(!row)return bad(401,'SESSION_EXPIRED');
  const csrf=await digest(`csrf:${token}`);
  if(mutating){if(!equal(request.headers.get('X-CSRF-Token')??'',csrf))return bad(403,'CSRF_REQUIRED');await rate(env.DB,`writes:${row.user_id}`,120);}
  if(row.signer_kind==='erc1271'){
    if(!row.signed_message||!row.signature)return bad(401,'SESSION_EXPIRED');
    try{await verifySignature(env,address(row.address),row.signed_message,row.signature,true);}catch(error){
      if(error instanceof ApiError && error.status===401){await env.DB.prepare('UPDATE sessions SET revoked_at=?1 WHERE token_hash=?2').bind(now,tokenHash).run();}
      throw error;
    }
  }
  return {userId:row.user_id,address:address(row.address),expiresAt:row.expires_at,token,tokenHash,csrf};
}
export function sessionResponse(identity:Identity):Response {
  return response({user:{id:identity.userId,address:identity.address,chainId:5042002},expiresAt:identity.expiresAt,csrfToken:identity.csrf});
}
export async function logout(env:IdentityEnv,identity:Identity):Promise<Response> {
  await env.DB.batch([
    env.DB.prepare('UPDATE sessions SET revoked_at=?1 WHERE token_hash=?2').bind(Date.now(),identity.tokenHash),
    env.DB.prepare("INSERT INTO audit_logs(actor_id,action,entity_id,created_at) VALUES(?1,'auth.logout',?1,?2)").bind(identity.userId,Date.now()),
  ]);
  return response({signedOut:true},200,{'Set-Cookie':setCookie(SESSION_COOKIE,'',0)});
}
