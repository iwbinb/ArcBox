export interface Provider {
  request(args:{method:string;params?:unknown[]}):Promise<unknown>;
  on?(event:string,listener:()=>void):void;
  removeListener?(event:string,listener:()=>void):void;
}
export interface Session {user:{id:string;address:string;chainId:number};expiresAt:number;csrfToken:string}
export interface Workspace {id:string;name:string;version:number;role:'owner'|'editor'|'operator'|'viewer'}
export interface Draft {id:string;tool_type:string;title:string;description:string;version:number;archived:number}
export interface Member {user_id:string;address:string;role:Workspace['role']}
export interface Invitation {id:string;name:string;workspace_id:string;role:string;expires_at:number}
export interface Audit {id:number;action:string;entity_id:string;created_at:number;version:number|null}
export interface Revision {version:number;title:string;description:string;archived:number}
export interface Page<T>{items:T[];nextCursor:string|number|null}
export class ClientError extends Error {constructor(public code:string,public status=0){super(code);}}
export function provider():Provider|undefined{return (window as Window & {ethereum?:Provider}).ethereum;}
export async function api<T>(path:string,method='GET',data?:unknown,csrf='',version?:number):Promise<T>{
  const headers:Record<string,string>={Accept:'application/json'};
  if(method!=='GET'){headers['Content-Type']='application/json';headers['X-CSRF-Token']=csrf;}
  if(version!==undefined)headers['If-Match']=`"${version}"`;
  const result=await fetch('/api/v1'+path,{method,credentials:'same-origin',cache:'no-store',headers,...(method!=='GET'?{body:JSON.stringify(data??{})}:{}),signal:AbortSignal.timeout(12000)});
  const value=await result.json() as {data:T;error?:{code:string}};
  if(!result.ok)throw new ClientError(value.error?.code??'REQUEST_FAILED',result.status);
  return value.data;
}
export async function checkWallet(session:Session):Promise<void>{
  const p=provider();if(!p)throw new ClientError('WALLET_REQUIRED');
  const [accounts,chain]=await Promise.all([p.request({method:'eth_accounts'}),p.request({method:'eth_chainId'})]);
  if(!Array.isArray(accounts)||typeof accounts[0]!=='string'||accounts[0].toLowerCase()!==session.user.address.toLowerCase()||chain!=='0x4cef52')throw new ClientError('WALLET_CHANGED');
}
export async function connectWallet():Promise<{address:string;p:Provider}>{
  const p=provider();if(!p)throw new ClientError('WALLET_REQUIRED');
  const accounts=await p.request({method:'eth_requestAccounts'});
  if(!Array.isArray(accounts)||typeof accounts[0]!=='string')throw new ClientError('WALLET_REQUIRED');
  if(await p.request({method:'eth_chainId'})!=='0x4cef52')await p.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x4cef52'}]});
  if(await p.request({method:'eth_chainId'})!=='0x4cef52')throw new ClientError('WRONG_CHAIN');
  return {address:accounts[0],p};
}
export async function signIn(address:string,p:Provider):Promise<Session>{
  const challenge=await api<{nonce:string;message:string}>('/auth/nonce','POST',{address,chainId:5042002});
  const bytes=Array.from(new TextEncoder().encode(challenge.message),v=>v.toString(16).padStart(2,'0')).join('');
  const signature=await p.request({method:'personal_sign',params:['0x'+bytes,address]});
  return api<Session>('/auth/verify','POST',{nonce:challenge.nonce,message:challenge.message,signature});
}
