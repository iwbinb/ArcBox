import type { Identity } from '../identity/auth';
import { bad, configuration, digest } from '../identity/security';
import { assertion } from '../orders/store';
import type { OrderEnv } from '../orders/domain';

export const QUEUE = 'arcbox-platform-local';
export const DEAD_QUEUE = 'arcbox-platform-dead-local';
export const FILE_LIMIT = 65_536;
export const RETENTION_MS = 2_592_000_000;
export const GRANT_MS = 60_000;
export const LEASE_MS = 60_000;
export const MAX_ATTEMPTS = 5;
export interface Envelope { schema: 1; jobId: string; generation: number }
export interface PlatformEnv extends OrderEnv { PLATFORM_ENABLED?: string; FILES?: R2Bucket; JOBS?: Queue<Envelope> }
export interface FileVersion {
  id:string; workspace_id:string; series_id:string; version:number; catalog_id:string;
  name:string; mime:string; bytes:number; sha256:string; storage_key:string;
  key_hash:string; request_hash:string; state:'UPLOADING'|'QUARANTINED'|'READY'|'REJECTED';
  upload_until:number; created_by:string; created_at:number;
}
export interface Job {
  id:string; effect_key:string; workspace_id:string; type:'VERIFY_FILE'|'VERIFY_RECEIPT'|'ORDER_PROJECTED'; source_id:string;
  state:'PENDING'|'QUEUED'|'RUNNING'|'RETRY'|'SUCCEEDED'|'DEAD'; generation:number; attempts:number; dispatch_attempts:number;
  available_at:number; lease_token:string|null; lease_until:number; version:number; last_error:string|null; created_at:number; updated_at:number;
}
export function identifier(value:unknown):string {
  if(typeof value!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))return bad(422,'INVALID_ID');
  return value;
}
export function platformConfiguration(env:PlatformEnv):void {
  const origin=configuration(env);
  if(env.PLATFORM_ENABLED!=='true'||env.APP_ENV!=='local'||!(['127.0.0.1','localhost'].includes(origin.hostname)||origin.hostname.endsWith('.test')))bad(503,'PLATFORM_DISABLED');
}
export function bucket(env:PlatformEnv):R2Bucket { platformConfiguration(env);if(!env.FILES)return bad(503,'FILE_STORAGE_UNAVAILABLE');return env.FILES; }
export const uuid=()=>crypto.randomUUID();
export async function shaBytes(bytes:Uint8Array):Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer)),n=>n.toString(16).padStart(2,'0')).join('');
}
// These two harmless text fixtures are the complete reviewed catalog for M2-C.
// No HTTP endpoint can add a hash, approve arbitrary bytes, or execute a file.
const CATALOG = [
  {id:'sample-v1',name:'arcbox-sample-v1.txt',content:'ArcBox controlled demonstration file.\nVersion: 1\nNo personal or payment information.\n'},
  {id:'sample-v2',name:'arcbox-sample-v2.txt',content:'ArcBox controlled demonstration file.\nVersion: 2\nExisting orders keep their original version.\n'},
] as const;
export async function catalog() {
  return Promise.all(CATALOG.map(async f=>({...f,mime:'text/plain',bytes:new TextEncoder().encode(f.content).length,sha256:await digest(f.content),review:'CONTROLLED_SAMPLE_NOT_MALWARE_SCAN'})));
}
export async function catalogEntry(id:unknown) {
  if(typeof id!=='string')return bad(422,'CONTROLLED_FILE_REQUIRED');
  const entry=(await catalog()).find(f=>f.id===id);if(!entry)return bad(422,'CONTROLLED_FILE_REQUIRED');return entry;
}
export function fileSummary(f:FileVersion) {
  return {id:f.id,seriesId:f.series_id,version:f.version,name:f.name,mime:f.mime,bytes:f.bytes,sha256:f.sha256,state:f.state,uploadUntil:f.upload_until,createdAt:f.created_at,review:'CONTROLLED_SAMPLE_NOT_MALWARE_SCAN'};
}
export function userGuard(db:D1Database,op:string,i:Identity,workspaceId:string,roles:readonly string[]):D1PreparedStatement {
  // Roles are code constants, never caller input. Recheck after external awaits.
  return assertion(db,op,`EXISTS(SELECT 1 FROM memberships WHERE workspace_id=?2 AND user_id=?3 AND role IN (${roles.map(r=>"'"+r+"'").join(',')})) AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=?4 AND user_id=?3 AND revoked_at IS NULL AND expires_at>?5)`,[workspaceId,i.userId,i.tokenHash,Date.now()]);
}
export function activity(db:D1Database,workspaceId:string,actorId:string|null,action:string,entityId:string,code:string|null=null):D1PreparedStatement {
  return db.prepare('INSERT INTO platform_activity(workspace_id,actor_id,action,entity_id,code,created_at) VALUES(?1,?2,?3,?4,?5,?6)').bind(workspaceId,actorId,action,entityId,code,Date.now());
}
export function jobInsert(db:D1Database,workspaceId:string,type:Job['type'],sourceId:string,effectKey:string):D1PreparedStatement {
  const now=Date.now();
  return db.prepare('INSERT INTO platform_jobs(id,effect_key,workspace_id,type,source_id,available_at,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6,?6) ON CONFLICT(effect_key) DO NOTHING').bind(uuid(),effectKey,workspaceId,type,sourceId,now);
}
export const RETRY_CODES = new Set(['RPC_UNAVAILABLE','RPC_BLOCK_MISMATCH','RPC_RECEIPT_MISMATCH','FILE_UNAVAILABLE','FILE_NOT_READY','RECEIPT_PENDING','PROJECTION_BUSY']);
export const PERMANENT_CODES = new Set(['FILE_INTEGRITY_FAILURE','INVALID_JOB_SOURCE','RULE_INTEGRITY_FAILURE','DEPLOYMENT_UNAVAILABLE']);
export const backoff=(attempt:number)=>Math.min(300,2**Math.min(attempt,8));
