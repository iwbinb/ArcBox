import { expect, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { encodeAbiParameters, encodeFunctionData, keccak256, toHex, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import worker from '../../workers/identity/index';
import identitySchema from '../../migrations/0001_identity.sql?raw';
import orderSchema from '../../migrations/0002_orders.sql?raw';
import { authenticate, type Identity } from '../../workers/identity/auth';
import { CHAIN_ID, EVENT_TOPIC, KINDS, PROBE_ABI, TOKEN_ABI, USDC, type Order, type OrderEnv, type Rule, type Deployment } from '../../workers/orders/domain';
import { approvalData, createIntent, freezeRule, paymentData, registerLocalDeployment } from '../../workers/orders/store';

export const bindings=env as unknown as OrderEnv;
export const origin='https://identity.test';
export type Raw=Record<string,any>;
export type Account=ReturnType<typeof privateKeyToAccount>;
export interface Actor {account:Account;identity:Identity;cookie:string;csrf:string}
export interface Context {owner:Actor;buyer:Actor;workspaceId:string;draftId:string;deployment:Deployment;rule:Rule;order:Order}
const code='0x60006000' as Hex;
export const hash=(value:string)=>keccak256(toHex(value));
export const newHash=()=>hash(crypto.randomUUID());
export const newAddress=()=>privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Hex;
export const rpc={
  chainId:toHex(CHAIN_ID) as string,code:code as string,latest:30,time:Math.floor(Date.now()/1000),allowance:0n,token:20_000_000n,native:20n*10n**18n,
  gas:100000n,gasPrice:20_000_000_000n,failMethod:'',rangeLimit:128,extraLogs:[] as Raw[],
  transactions:new Map<string,Raw>(),receipts:new Map<string,Raw>(),blockHashes:new Map<number,Hex>(),calls:[] as {method:string;params:any[]}[],
  transform:null as null|((method:string,result:unknown,params:any[])=>unknown),
};
export function blockRaw(n:number):Raw{
  return {number:toHex(n),hash:rpc.blockHashes.get(n)??hash(`block:${n}`),timestamp:toHex(rpc.time+n),parentHash:hash(`block:${n-1}`),nonce:'0x0000000000000000',sha3Uncles:hash('uncles'),logsBloom:'0x'+'0'.repeat(512),transactionsRoot:hash('txroot'),stateRoot:hash('state'),receiptsRoot:hash('receipts'),miner:newAddressConstant,difficulty:'0x0',totalDifficulty:'0x0',extraData:'0x',size:'0x100',gasLimit:'0x1c9c380',gasUsed:'0x186a0',baseFeePerGas:'0x4a817c800',transactions:[],uncles:[]};
}
const newAddressConstant='0x1000000000000000000000000000000000000001';
export async function setup():Promise<void>{
  for(const schema of [identitySchema,orderSchema])for(const sql of schema.split('-- break --').map(s=>s.trim()).filter(Boolean))await bindings.DB.prepare(sql).run();
}
export function resetRpc():void{
  rpc.chainId=toHex(CHAIN_ID);rpc.code=code;rpc.latest=30;rpc.time=Math.floor(Date.now()/1000);rpc.allowance=0n;rpc.token=20_000_000n;rpc.native=20n*10n**18n;rpc.gas=100000n;rpc.gasPrice=20_000_000_000n;rpc.failMethod='';rpc.rangeLimit=128;rpc.extraLogs=[];rpc.transactions.clear();rpc.receipts.clear();rpc.blockHashes.clear();rpc.calls.length=0;rpc.transform=null;
  vi.stubGlobal('fetch',async(input:unknown,options?:{body?:unknown})=>{
    const url=input instanceof Request?input.url:String(input);
    if(url.replace(/\/$/,'')!=='https://rpc.testnet.arc.io')throw new Error('Unexpected test network target');
    const query=input instanceof Request?await input.json() as Raw:JSON.parse(String(options?.body)) as Raw;
    const method=String(query.method),params=query.params??[];rpc.calls.push({method,params});
    if(method===rpc.failMethod)throw new Error('Injected RPC outage; not a real network failure');
    let result:unknown;
    switch(method){
      case 'eth_chainId':result=rpc.chainId;break;
      case 'eth_getBlockByNumber':result=blockRaw(params[0]==='latest'?rpc.latest:Number(BigInt(params[0])));break;
      case 'eth_getCode':result=rpc.code;break;
      case 'eth_getTransactionByHash':result=rpc.transactions.get(String(params[0]).toLowerCase())??null;break;
      case 'eth_getTransactionReceipt':result=rpc.receipts.get(String(params[0]).toLowerCase())??null;break;
      case 'eth_getLogs':{
        const filter=params[0],from=Number(BigInt(filter.fromBlock)),to=Number(BigInt(filter.toBlock));
        if(to-from+1>rpc.rangeLimit)return Response.json({jsonrpc:'2.0',id:query.id,error:{code:-32005,message:'fixture range cap'}});
        result=[...rpc.receipts.values()].flatMap(r=>r.logs).concat(rpc.extraLogs).filter(l=>l.address.toLowerCase()===String(filter.address).toLowerCase()&&Number(BigInt(l.blockNumber))>=from&&Number(BigInt(l.blockNumber))<=to);break;
      }
      case 'eth_call':{
        const data=String(params[0].data).slice(0,10),token=String(params[0].to).toLowerCase()===USDC;
        if(token&&data==='0x313ce567')result=toHex(6,{size:32});
        else if(token&&data==='0x70a08231')result=toHex(rpc.token,{size:32});
        else if(token&&data==='0xdd62ed3e')result=toHex(rpc.allowance,{size:32});
        else result=token?toHex(1,{size:32}):'0x';break;
      }
      case 'eth_getBalance':result=toHex(rpc.native);break;
      case 'eth_estimateGas':result=toHex(rpc.gas);break;
      case 'eth_gasPrice':result=toHex(rpc.gasPrice);break;
      default:throw new Error(`Forbidden RPC method in tests: ${method}`);
    }
    if(rpc.transform)result=rpc.transform(method,result,params);
    return Response.json({jsonrpc:'2.0',id:query.id,result});
  });
}
export async function call(path:string,method='GET',value?:unknown,actor?:Actor,headers:Record<string,string>={},environment:OrderEnv=bindings):Promise<Response>{
  const h=new Headers({'CF-Connecting-IP':crypto.randomUUID(),...headers});
  if(method!=='GET'){if(!h.has('Origin'))h.set('Origin',origin);h.set('Content-Type','application/json');}
  if(actor){h.set('Cookie',actor.cookie);if(method!=='GET'&&!h.has('X-CSRF-Token'))h.set('X-CSRF-Token',actor.csrf);}
  return worker.fetch(new Request(origin+'/api/v1'+path,{method,headers:h,...(method!=='GET'?{body:JSON.stringify(value??{})}:{})}),environment);
}
export async function json(r:Response):Promise<Raw>{return await r.json() as Raw;}
export async function actor():Promise<Actor>{
  const account=privateKeyToAccount(generatePrivateKey());
  const nonceResponse=await call('/auth/nonce','POST',{address:account.address,chainId:CHAIN_ID});expect(nonceResponse.status).toBe(200);
  const challenge=(await json(nonceResponse)).data,binding=/__Host-arcbox-challenge=([a-f0-9]{64})/.exec(nonceResponse.headers.get('Set-Cookie')??'')![1];
  const login=await call('/auth/verify','POST',{nonce:challenge.nonce,message:challenge.message,signature:await account.signMessage({message:challenge.message})},undefined,{Cookie:`__Host-arcbox-challenge=${binding}`});expect(login.status).toBe(200);
  const result=(await json(login)).data,token=/__Host-arcbox-session=([a-f0-9]{64})/.exec(login.headers.get('Set-Cookie')??'')![1],cookie=`__Host-arcbox-session=${token}`;
  const identity=await authenticate(new Request(origin+'/api/v1/session',{headers:{Cookie:cookie}}),bindings);
  return {account,identity,cookie,csrf:result.csrfToken};
}
export async function context():Promise<Context>{
  const owner=await actor(),buyer=await actor();
  const w=await call('/workspaces','POST',{name:'Order test '+crypto.randomUUID()},owner);expect(w.status).toBe(201);const workspaceId=(await json(w)).data.id;
  const draft=await call(`/workspaces/${workspaceId}/drafts`,'POST',{toolType:'deliver',title:'Local order fixture',description:'No public payments.'},owner);expect(draft.status).toBe(201);const draftId=(await json(draft)).data.id;
  const deployment=await registerLocalDeployment(bindings,{workspaceId,address:newAddress(),codeHash:keccak256(code),deploymentBlock:10});
  const rule=await freezeRule(bindings,owner.identity,workspaceId,{draftId,draftVersion:1,deploymentId:deployment.id,amountU6:'1000000'});
  const order=(await createIntent(bindings,buyer.identity,rule.id,crypto.randomUUID())).order;
  return {owner,buyer,workspaceId,draftId,deployment,rule,order};
}
export async function join(c:Context,target:Actor,role='viewer'):Promise<void>{
  const r=await call(`/workspaces/${c.workspaceId}/invitations`,'POST',{address:target.account.address,role},c.owner);expect(r.status).toBe(201);
  expect((await call(`/invitations/${(await json(r)).data.id}/accept`,'POST',{},target)).status).toBe(200);
}
export interface EventOptions {kind?:number;sequence?:number;block?:number;txIndex?:number;logIndex?:number;txHash?:Hex;amount?:string;payer?:Hex;recipient?:Hex;nonce?:Hex;rulesHash?:Hex;orderId?:Hex;emitter?:Hex;reverted?:boolean;approval?:boolean}
export function addReceipt(c:Context,options:EventOptions={}):Hex{
  const {order:o,rule:r,deployment:d}=c,kind=options.kind??1,sequence=options.sequence??kind,n=options.block??(10+sequence),txIndex=options.txIndex??0,logIndex=options.logIndex??0,txHash=options.txHash??newHash();
  const b=blockRaw(n),payer=options.payer??o.payer,recipient=options.recipient??(kind===1?d.address:KINDS[kind-1]?.startsWith('SETTLEMENT')?d.beneficiary:o.payer);
  const amount=options.amount??(kind===2?'0':o.amount_u6),word=(address:string)=>('0x'+'0'.repeat(24)+address.slice(2).toLowerCase()) as Hex;
  const topics=options.approval?[hash('Approval(address,address,uint256)'),word(o.payer),word(d.address)]:[EVENT_TOPIC,options.orderId??o.chain_order_id,word(payer),options.rulesHash??r.rules_hash];
  const data=options.approval?toHex(BigInt(o.amount_u6),{size:32}):encodeAbiParameters([{type:'uint32'},{type:'uint8'},{type:'uint256'},{type:'address'},{type:'bytes32'}],[sequence,kind,BigInt(amount),recipient,options.nonce??o.nonce]);
  const log={address:options.emitter??(options.approval?USDC:d.address),topics,data,blockNumber:toHex(n),blockHash:b.hash,transactionHash:txHash,transactionIndex:toHex(txIndex),logIndex:toHex(logIndex),removed:false};
  const to=options.approval?USDC:d.address,from=options.approval||kind===1?o.payer:d.beneficiary;
  const input=options.approval?approvalData(o,d):kind===1?paymentData(o,r):encodeFunctionData({abi:PROBE_ABI,functionName:'advance',args:[o.chain_order_id,kind]});
  rpc.transactions.set(txHash,{hash:txHash,from,to,input,value:'0x0',nonce:toHex(100+sequence),blockNumber:toHex(n),blockHash:b.hash,transactionIndex:toHex(txIndex),gas:'0x30d40',gasPrice:'0x4a817c800',type:'0x0',chainId:toHex(CHAIN_ID),v:'0x1b',r:hash('r'),s:hash('s')});
  rpc.receipts.set(txHash,{transactionHash:txHash,from,to,blockNumber:toHex(n),blockHash:b.hash,transactionIndex:toHex(txIndex),status:options.reverted?'0x0':'0x1',type:'0x0',gasUsed:'0x186a0',effectiveGasPrice:'0x4a817c800',cumulativeGasUsed:'0x186a0',logsBloom:'0x'+'0'.repeat(512),contractAddress:null,logs:options.reverted?[]:[log]});
  rpc.latest=Math.max(rpc.latest,n);return txHash;
}
export const count=async(sql:string,...values:(string|number)[]):Promise<number>=>Number(await bindings.DB.prepare(sql).bind(...values).first('n'));
