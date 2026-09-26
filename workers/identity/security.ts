import { getAddress, isAddress, type Address } from 'viem';

export interface IdentityEnv {
  DB: D1Database;
  ASSETS?: Fetcher;
  AUTH_ENABLED: string;
  APP_ENV: string;
  APP_ORIGIN: string;
  CHAIN_ID: string;
  RPC_URL: string;
}
export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export const bad = (status: number, code: string): never => { throw new ApiError(status, code); };
export const TOKEN = /^[a-f0-9]{64}$/;
export const SESSION_COOKIE = '__Host-arcbox-session';
export const CHALLENGE_COOKIE = '__Host-arcbox-challenge';
export const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join('');
}
export function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i=0; i<a.length; i++) difference |= a.charCodeAt(i)^b.charCodeAt(i);
  return difference === 0;
}
export function configuration(env: IdentityEnv): URL {
  if (env.AUTH_ENABLED !== 'true' || !['local','testnet'].includes(env.APP_ENV) || env.CHAIN_ID !== '5042002') bad(503,'IDENTITY_DISABLED');
  let origin: URL;
  try { origin = new URL(env.APP_ORIGIN); } catch { return bad(503,'INVALID_CONFIGURATION'); }
  const local = env.APP_ENV==='local' && ['127.0.0.1','localhost'].includes(origin.hostname);
  if ((!local && origin.protocol!=='https:') || origin.origin!==env.APP_ORIGIN || origin.username || origin.password) bad(503,'INVALID_CONFIGURATION');
  if (env.RPC_URL!=='https://rpc.testnet.arc.io') bad(503,'INVALID_CONFIGURATION');
  return origin;
}
export function checkOrigin(request: Request, env: IdentityEnv): void {
  if (new URL(request.url).origin!==env.APP_ORIGIN || request.headers.get('Origin')!==env.APP_ORIGIN) bad(403,'ORIGIN_MISMATCH');
  const site=request.headers.get('Sec-Fetch-Site');
  if (site && site!=='same-origin' && site!=='none') bad(403,'ORIGIN_MISMATCH');
}
export function cookie(request: Request, name: string): string | null {
  const matches=(request.headers.get('Cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(`${name}=`));
  if (matches.length!==1) return null;
  const value=matches[0]!.slice(name.length+1);
  return TOKEN.test(value)?value:null;
}
export function setCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
export function object(value: unknown, keys: string[]): Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value)) bad(422,'INVALID_BODY');
  const obj=value as Record<string,unknown>;
  if (Object.keys(obj).some(key=>!keys.includes(key))) bad(422,'UNKNOWN_FIELD');
  return obj;
}
export async function body(request: Request, keys: string[]): Promise<Record<string,unknown>> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')??'')) bad(415,'JSON_REQUIRED');
  if (Number(request.headers.get('Content-Length')??0)>16384) bad(413,'BODY_TOO_LARGE');
  if (!request.body) return bad(422,'INVALID_BODY');
  const reader=request.body.getReader(); let size=0; const chunks: Uint8Array[]=[];
  while (true) { const result=await reader.read(); if(result.done) break; size+=result.value.byteLength; if(size>16384){await reader.cancel();bad(413,'BODY_TOO_LARGE');} chunks.push(result.value); }
  const bytes=new Uint8Array(size); let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let value:unknown;
  try { value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes)); } catch { return bad(422,'INVALID_BODY'); }
  return object(value,keys);
}
export function text(value:unknown,max:number,min=1):string {
  if(typeof value!=='string') return bad(422,'INVALID_FIELD');
  const s=value.trim();
  if(s.length<min || s.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) bad(422,'INVALID_FIELD');
  return s;
}
export function address(value:unknown):Address {
  if(typeof value!=='string'||!isAddress(value)||/^0x0{40}$/i.test(value))return bad(422,'INVALID_ADDRESS');
  return getAddress(value);
}
export function expectedVersion(request:Request):number {
  const value=request.headers.get('If-Match')??'';
  if(!/^"[1-9][0-9]{0,8}"$/.test(value))return bad(428,'VERSION_REQUIRED');
  return Number(value.slice(1,-1));
}
export async function rate(db:D1Database,key:string,limit:number,now=Date.now()):Promise<void> {
  const bucket=Math.floor(now/60000), hashed=await digest(`${key}:${bucket}`);
  const row=await db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?1,1,?2) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(hashed,(bucket+2)*60000).first<{count:number}>();
  if(!row||row.count>limit)bad(429,'RATE_LIMITED');
  await db.prepare('DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at<?1 LIMIT 100)').bind(now).run();
}
export function response(data:unknown,status=200,extra:Record<string,string>={}):Response {
  return Response.json({data}, {status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra}});
}
