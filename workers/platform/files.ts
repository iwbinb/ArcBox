import type { Identity } from '../identity/auth';
import { ApiError, bad, digest, randomToken } from '../identity/security';
import { member } from '../identity/workspaces';
import { canonicalRule, MAX_AMOUNT, ordersConfiguration, ruleHash, uint, type Rule } from '../orders/domain';
import { assertion, deployment, isConflict, releaseAssertion, rule } from '../orders/store';
import { activity, bucket, catalogEntry, FILE_LIMIT, fileSummary, GRANT_MS, identifier, jobInsert, platformConfiguration, RETENTION_MS, shaBytes, userGuard, uuid, type FileVersion, type PlatformEnv } from './domain';

const EDITORS=['owner','editor'] as const;
export async function file(env:PlatformEnv,fileId:string):Promise<FileVersion> {
  const value=await env.DB.prepare('SELECT * FROM file_versions WHERE id=?1').bind(fileId).first<FileVersion>();
  if(!value)return bad(404,'NOT_FOUND');return value;
}
export async function createUpload(env:PlatformEnv,i:Identity,workspaceId:string,catalogId:unknown,key:string,seriesId?:string) {
  platformConfiguration(env);bucket(env);await member(env.DB,workspaceId,i.userId,EDITORS.slice());
  if(!/^[A-Za-z0-9._:-]{16,128}$/.test(key))bad(422,'IDEMPOTENCY_KEY_REQUIRED');
  const entry=await catalogEntry(catalogId),keyHash=await digest(`file.v1:${workspaceId}:${i.userId}:${key}`);
  const requestHash=await digest(JSON.stringify([entry.id,seriesId??null]));
  const replay=async()=>{
    const saved=await env.DB.prepare('SELECT * FROM file_versions WHERE key_hash=?1').bind(keyHash).first<FileVersion>();
    if(saved&&saved.request_hash!==requestHash)bad(409,'IDEMPOTENCY_CONFLICT');return saved;
  };
  const saved=await replay();if(saved)return fileSummary(saved);
  const id=uuid(),now=Date.now();let version=1;
  if(seriesId){
    identifier(seriesId);
    const latest=await env.DB.prepare('SELECT max(version) AS version FROM file_versions WHERE workspace_id=?1 AND series_id=?2').bind(workspaceId,seriesId).first<{version:number|null}>();
    if(!latest?.version)return bad(404,'NOT_FOUND');version=latest.version+1;
  }
  const op=uuid(),cap=uuid();
  try{
    await env.DB.batch([
      userGuard(env.DB,op,i,workspaceId,EDITORS),
      assertion(env.DB,cap,'(SELECT count(*) FROM file_versions WHERE workspace_id=?2)<100',[workspaceId]),
      env.DB.prepare('INSERT INTO file_versions(id,workspace_id,series_id,version,catalog_id,name,mime,bytes,sha256,storage_key,key_hash,request_hash,upload_until,created_by,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)').bind(id,workspaceId,seriesId??id,version,entry.id,entry.name,entry.mime,entry.bytes,entry.sha256,`local/${workspaceId}/${id}`,keyHash,requestHash,now+600_000,i.userId,now),
      activity(env.DB,workspaceId,i.userId,'file.upload-created',id),
      releaseAssertion(env.DB,op),releaseAssertion(env.DB,cap),
    ]);
  }catch(error){if(isConflict(error)){const existing=await replay();if(existing)return fileSummary(existing);return bad(409,'FILE_LIMIT_VERSION_OR_ACCESS_CHANGED');}throw error;}
  return fileSummary(await file(env,id));
}
async function limited(stream:ReadableStream<Uint8Array>|null,max:number):Promise<Uint8Array> {
  if(!stream)return bad(422,'EMPTY_FILE');
  const reader=stream.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){await reader.cancel();return bad(413,'FILE_TOO_LARGE');}chunks.push(part.value);}
  }finally{reader.releaseLock();}
  const data=new Uint8Array(size);let offset=0;for(const part of chunks){data.set(part,offset);offset+=part.length;}return data;
}
export async function checkObject(env:PlatformEnv,f:FileVersion):Promise<Uint8Array> {
  try{
    const approved=await catalogEntry(f.catalog_id);
    if(f.sha256!==approved.sha256||f.bytes!==approved.bytes||f.name!==approved.name||f.mime!==approved.mime||f.bytes>FILE_LIMIT)bad(503,'FILE_INTEGRITY_FAILURE');
    const object=await bucket(env).get(f.storage_key);
    if(!object)return bad(503,'FILE_UNAVAILABLE');
    if(object.size!==f.bytes||object.httpMetadata?.contentType!==f.mime||object.customMetadata?.fileId!==f.id||object.customMetadata?.sha256!==f.sha256)bad(503,'FILE_INTEGRITY_FAILURE');
    const bytes=await limited(object.body,f.bytes);
    if(bytes.length!==f.bytes||await shaBytes(bytes)!==f.sha256)bad(503,'FILE_INTEGRITY_FAILURE');
    return bytes;
  }catch(error){if(error instanceof ApiError)throw error;return bad(503,'FILE_UNAVAILABLE');}
}
export async function uploadContent(request:Request,env:PlatformEnv,i:Identity,fileId:string) {
  const f=await file(env,fileId);await member(env.DB,f.workspace_id,i.userId,EDITORS.slice());
  if(f.created_by!==i.userId)bad(403,'UPLOAD_OWNER_REQUIRED');
  if(f.upload_until<=Date.now()||f.state==='REJECTED')bad(409,'UPLOAD_EXPIRED_OR_REJECTED');
  if(!/^text\/plain(?:;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')??'')||request.headers.has('Content-Encoding'))bad(415,'CONTROLLED_TEXT_REQUIRED');
  const length=request.headers.get('Content-Length');
  if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>f.bytes))bad(413,'FILE_TOO_LARGE');
  const bytes=await limited(request.body,f.bytes),approved=await catalogEntry(f.catalog_id);
  if(bytes.length!==f.bytes||await shaBytes(bytes)!==approved.sha256||f.sha256!==approved.sha256)bad(422,'FILE_NOT_APPROVED');
  // Fixed key and conditional create: a retry cannot replace immutable bytes.
  try{
    await bucket(env).put(f.storage_key,bytes,{onlyIf:new Headers({'If-None-Match':'*'}),sha256:f.sha256,httpMetadata:{contentType:f.mime},customMetadata:{fileId:f.id,sha256:f.sha256}});
  }catch{return bad(503,'FILE_UNAVAILABLE');}
  await checkObject(env,f);
  const op=uuid(),state=uuid();
  try{
    await env.DB.batch([
      userGuard(env.DB,op,i,f.workspace_id,EDITORS),
      assertion(env.DB,state,"EXISTS(SELECT 1 FROM file_versions WHERE id=?2 AND state!='REJECTED' AND upload_until>?3)",[f.id,Date.now()]),
      env.DB.prepare("UPDATE file_versions SET state='QUARANTINED' WHERE id=?1 AND state='UPLOADING'").bind(f.id),
      activity(env.DB,f.workspace_id,i.userId,'file.bytes-received',f.id),
      releaseAssertion(env.DB,op),releaseAssertion(env.DB,state),
    ]);
  }catch(error){if(isConflict(error))return bad(409,'FILE_OR_ACCESS_CHANGED');throw error;}
  return fileSummary(await file(env,f.id));
}
export async function completeUpload(env:PlatformEnv,i:Identity,fileId:string) {
  const f=await file(env,fileId);await member(env.DB,f.workspace_id,i.userId,EDITORS.slice());
  if(!['QUARANTINED','READY'].includes(f.state))bad(409,'FILE_NOT_READY');
  const op=uuid();
  try{await env.DB.batch([userGuard(env.DB,op,i,f.workspace_id,EDITORS),jobInsert(env.DB,f.workspace_id,'VERIFY_FILE',f.id,`file:${f.id}`),releaseAssertion(env.DB,op)]);}
  catch(error){if(isConflict(error))return bad(409,'ACCESS_CHANGED');throw error;}
  return {file:fileSummary(f),job:await env.DB.prepare('SELECT id,state,version FROM platform_jobs WHERE effect_key=?1').bind(`file:${f.id}`).first(),acceptedForVerification:true};
}
export async function freezeFileRule(env:PlatformEnv,i:Identity,workspaceId:string,input:{draftId:string;draftVersion:number;deploymentId:string;amountU6:string;fileId:string}):Promise<Rule> {
  platformConfiguration(env);ordersConfiguration(env);await member(env.DB,workspaceId,i.userId,['owner']);
  const f=await file(env,input.fileId),d=await deployment(env.DB,input.deploymentId);
  if(f.workspace_id!==workspaceId||d.workspace_id!==workspaceId)bad(404,'NOT_FOUND');
  if(f.state!=='READY')bad(409,'FILE_NOT_READY');await checkObject(env,f);
  const draft=await env.DB.prepare('SELECT id,version,tool_type,title,description,archived FROM drafts WHERE id=?1 AND workspace_id=?2').bind(input.draftId,workspaceId).first<{id:string;version:number;tool_type:string;title:string;description:string;archived:number}>();
  if(!draft)return bad(404,'NOT_FOUND');if(draft.archived||draft.version!==input.draftVersion)bad(409,'VERSION_CONFLICT');
  if(draft.tool_type!=='deliver')bad(422,'DELIVER_DRAFT_REQUIRED');
  const amount=uint(input.amountU6,MAX_AMOUNT,false).toString();
  const canonical=JSON.stringify({...JSON.parse(canonicalRule(d,draft,amount)),schema:'arcbox.order-rule.file.v1',file:{id:f.id,seriesId:f.series_id,version:f.version,sha256:f.sha256,bytes:f.bytes,mime:f.mime,name:f.name,retentionMs:RETENTION_MS}});
  const hash=ruleHash(canonical),existing=await env.DB.prepare('SELECT * FROM order_rules WHERE deployment_id=?1 AND draft_id=?2 AND draft_version=?3').bind(d.id,draft.id,draft.version).first<Rule>();
  if(existing){if(existing.rules_hash!==hash)bad(409,'RULE_ALREADY_FROZEN');return existing;}
  const id=uuid(),op=uuid(),state=uuid(),now=Date.now();
  try{
    await env.DB.batch([
      userGuard(env.DB,op,i,workspaceId,['owner']),
      assertion(env.DB,state,"EXISTS(SELECT 1 FROM drafts WHERE id=?2 AND version=?3 AND archived=0) AND EXISTS(SELECT 1 FROM file_versions WHERE id=?4 AND state='READY') AND EXISTS(SELECT 1 FROM order_deployments WHERE id=?5 AND status='ACTIVE')",[draft.id,draft.version,f.id,d.id]),
      env.DB.prepare('INSERT INTO order_rules(id,workspace_id,deployment_id,draft_id,draft_version,rules_hash,canonical_json,amount_u6,title,tool_type,created_by,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)').bind(id,workspaceId,d.id,draft.id,draft.version,hash,canonical,amount,draft.title,draft.tool_type,i.userId,now),
      env.DB.prepare('INSERT INTO file_rule_bindings(rule_id,file_id,retention_ms) VALUES(?1,?2,?3)').bind(id,f.id,RETENTION_MS),
      activity(env.DB,workspaceId,i.userId,'file.rule-frozen',id),releaseAssertion(env.DB,op),releaseAssertion(env.DB,state),
    ]);
  }catch(error){if(isConflict(error)){const same=await env.DB.prepare('SELECT * FROM order_rules WHERE deployment_id=?1 AND draft_id=?2 AND draft_version=?3').bind(d.id,draft.id,draft.version).first<Rule>();if(same?.rules_hash===hash)return same;return bad(409,'RULE_FILE_OR_ACCESS_CHANGED');}throw error;}
  return rule(env.DB,id);
}
export const ACCESS_FROM='FROM file_entitlements e JOIN orders o ON o.id=e.order_id JOIN file_versions f ON f.id=e.file_id JOIN file_rule_bindings b ON b.rule_id=o.rule_id AND b.file_id=f.id JOIN order_deployments d ON d.id=o.deployment_id';
export const ACCESS_OK="e.state='ACTIVE' AND e.retention_until>?4 AND f.state='READY' AND d.status='ACTIVE' AND o.payment_state='CONFIRMED' AND o.funds_state IN ('LOCKED','SETTLEMENT_CREDIT','SETTLED') AND o.delivery_state!='REVOKED' AND o.payer=?3 AND e.wallet=?3";
async function access(env:PlatformEnv,i:Identity,orderId:string) {
  platformConfiguration(env);
  const own=await env.DB.prepare('SELECT id,rule_id FROM orders WHERE id=?1 AND payer=?2').bind(orderId,i.address.toLowerCase()).first<{id:string;rule_id:string}>();
  if(!own)return bad(404,'NOT_FOUND');await rule(env.DB,own.rule_id);
  const row=await env.DB.prepare(`SELECT f.*,e.retention_until ${ACCESS_FROM} WHERE e.order_id=?2 AND ${ACCESS_OK}`).bind(null,orderId,i.address.toLowerCase(),Date.now()).first<FileVersion&{retention_until:number}>();
  if(!row)return bad(403,'FILE_ACCESS_NOT_AVAILABLE');return row;
}
export async function issueDownload(env:PlatformEnv,i:Identity,orderId:string) {
  const f=await access(env,i,orderId),now=Date.now(),expires=Math.min(now+GRANT_MS,f.retention_until,i.expiresAt),token=randomToken(),id=uuid(),op=uuid();
  const hash=await digest('download.v1:'+token);
  try{
    await env.DB.batch([
      assertion(env.DB,op,`EXISTS(SELECT 1 ${ACCESS_FROM} WHERE e.order_id=?2 AND ${ACCESS_OK}) AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=?5 AND user_id=?6 AND revoked_at IS NULL AND expires_at>?4) AND (SELECT count(*) FROM download_grants WHERE order_id=?2 AND consumed_at IS NULL AND expires_at>?4)<20`,[orderId,i.address.toLowerCase(),Date.now(),i.tokenHash,i.userId]),
      env.DB.prepare('INSERT INTO download_grants(id,token_hash,order_id,session_hash,expires_at,created_at) VALUES(?1,?2,?3,?4,?5,?6)').bind(id,hash,orderId,i.tokenHash,expires,now),
      activity(env.DB,f.workspace_id,i.userId,'file.download-granted',orderId),releaseAssertion(env.DB,op),
    ]);
  }catch(error){if(isConflict(error))return bad(409,'FILE_OR_SESSION_CHANGED');throw error;}
  // Bearer secret stays in a response body and a subsequent request header, not a URL or log.
  return {grantId:id,token,expiresAt:expires,path:`/api/v1/orders/${orderId}/download`,singleUse:true,sessionBound:true,file:fileSummary(f)};
}
export async function consumeDownload(request:Request,env:PlatformEnv,i:Identity,orderId:string):Promise<Response> {
  if(new URL(request.url).search||request.headers.has('Range'))bad(422,'DOWNLOAD_HEADER_REQUIRED');
  const token=request.headers.get('X-ArcBox-Download')??'';if(!/^[a-f0-9]{64}$/.test(token))bad(403,'INVALID_DOWNLOAD_GRANT');
  const hash=await digest('download.v1:'+token),f=await access(env,i,orderId);
  const grant=await env.DB.prepare('SELECT id FROM download_grants WHERE token_hash=?1 AND order_id=?2 AND session_hash=?3 AND consumed_at IS NULL AND expires_at>?4').bind(hash,orderId,i.tokenHash,Date.now()).first<{id:string}>();
  if(!grant)return bad(403,'INVALID_DOWNLOAD_GRANT');
  const bytes=await checkObject(env,f),op=uuid(),now=Date.now();
  try{
    await env.DB.batch([
      assertion(env.DB,op,`EXISTS(SELECT 1 ${ACCESS_FROM} WHERE e.order_id=?2 AND ${ACCESS_OK}) AND EXISTS(SELECT 1 FROM download_grants g JOIN sessions s ON s.token_hash=g.session_hash WHERE g.id=?5 AND g.token_hash=?6 AND g.session_hash=?7 AND g.consumed_at IS NULL AND g.expires_at>?4 AND s.revoked_at IS NULL AND s.expires_at>?4 AND s.user_id=?8)`,[orderId,i.address.toLowerCase(),now,grant.id,hash,i.tokenHash,i.userId]),
      env.DB.prepare('UPDATE download_grants SET consumed_at=?1 WHERE id=?2').bind(now,grant.id),
      activity(env.DB,f.workspace_id,i.userId,'file.download-consumed',orderId),releaseAssertion(env.DB,op),
    ]);
  }catch(error){if(isConflict(error))return bad(409,'DOWNLOAD_USED_OR_ACCESS_CHANGED');throw error;}
  return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.length),'Content-Disposition':`attachment; filename="${f.name}"`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}
