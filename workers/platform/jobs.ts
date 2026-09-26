import type { Identity } from '../identity/auth';
import { ApiError, bad, digest, object } from '../identity/security';
import { member } from '../identity/workspaces';
import type { BusinessEvent, Order } from '../orders/domain';
import { assertion, isConflict, order, releaseAssertion, rule } from '../orders/store';
import { refreshAttempt } from '../orders/sync';
import { activity, backoff, DEAD_QUEUE, identifier, jobInsert, LEASE_MS, MAX_ATTEMPTS, PERMANENT_CODES, platformConfiguration, QUEUE, RETENTION_MS, RETRY_CODES, userGuard, uuid, type Envelope, type Job, type PlatformEnv } from './domain';
import { checkObject, file } from './files';

type Outbox={id:string;effect_key:string;order_id:string;type:Job['type'];payload_json:string};
export async function bridgeOutbox(env:PlatformEnv,workspaceId?:string):Promise<number> {
  platformConfiguration(env);
  const rows=await env.DB.prepare("SELECT b.*,o.workspace_id FROM order_outbox b JOIN orders o ON o.id=b.order_id WHERE b.state='PENDING' AND (?1 IS NULL OR o.workspace_id=?1) AND NOT EXISTS(SELECT 1 FROM platform_jobs j WHERE j.effect_key='outbox:'||b.id) ORDER BY b.created_at,b.id LIMIT 20").bind(workspaceId??null).all<Outbox&{workspace_id:string}>();
  for(const row of rows.results)await jobInsert(env.DB,row.workspace_id,row.type,row.id,`outbox:${row.id}`).run();
  return rows.results.length;
}
export async function getJob(env:PlatformEnv,id:string):Promise<Job|null> {
  return env.DB.prepare('SELECT * FROM platform_jobs WHERE id=?1').bind(id).first<Job>();
}
async function dead(env:PlatformEnv,j:Job,code:string):Promise<void> {
  const op=uuid();
  try{await env.DB.batch([
    assertion(env.DB,op,"EXISTS(SELECT 1 FROM platform_jobs WHERE id=?2 AND version=?3 AND state NOT IN ('SUCCEEDED','DEAD') AND lease_until<=?4) AND NOT EXISTS(SELECT 1 FROM platform_inbox WHERE job_id=?2)",[j.id,j.version,Date.now()]),
    env.DB.prepare("UPDATE platform_jobs SET state='DEAD',last_error=?1,lease_token=NULL,lease_until=0,updated_at=?2,version=version+1 WHERE id=?3").bind(code,Date.now(),j.id),
    activity(env.DB,j.workspace_id,null,'job.dead',j.id,code),releaseAssertion(env.DB,op),
  ]);}catch(error){if(!isConflict(error))throw error;}
}
export async function dispatchDue(env:PlatformEnv,workspaceId?:string):Promise<number> {
  platformConfiguration(env);if(!env.JOBS)return bad(503,'QUEUE_UNAVAILABLE');
  const rows=await env.DB.prepare("SELECT * FROM platform_jobs WHERE state NOT IN ('SUCCEEDED','DEAD') AND available_at<=?1 AND lease_until<=?1 AND (?2 IS NULL OR workspace_id=?2) ORDER BY available_at,id LIMIT 10").bind(Date.now(),workspaceId??null).all<Job>();
  let sent=0;
  for(const row of rows.results){
    if(row.dispatch_attempts>=MAX_ATTEMPTS||row.attempts>=MAX_ATTEMPTS){await dead(env,row,'DELIVERY_OR_ATTEMPTS_EXHAUSTED');continue;}
    const token=uuid(),now=Date.now();
    const j=await env.DB.prepare("UPDATE platform_jobs SET lease_token=?1,lease_until=?2,dispatch_attempts=dispatch_attempts+1,version=version+1,updated_at=?3 WHERE id=?4 AND version=?5 AND state NOT IN ('SUCCEEDED','DEAD') AND lease_until<=?3 RETURNING *").bind(token,now+LEASE_MS,now,row.id,row.version).first<Job>();
    if(!j)continue;
    try{
      await env.JOBS.send({schema:1,jobId:j.id,generation:j.generation});
      // SENT means accepted by the broker, not that the effect has completed.
      const statements=[env.DB.prepare("UPDATE platform_jobs SET state='QUEUED',available_at=?1,lease_token=NULL,lease_until=0,last_error=NULL,updated_at=?2,version=version+1 WHERE id=?3 AND lease_token=?4").bind(Date.now()+LEASE_MS,Date.now(),j.id,token)];
      if(j.type!=='VERIFY_FILE')statements.push(env.DB.prepare("UPDATE order_outbox SET state='SENT',sent_at=coalesce(sent_at,?1) WHERE id=?2").bind(Date.now(),j.source_id));
      await env.DB.batch(statements);sent++;
    }catch{
      // Crash after send/before marker is safe: the same job can be delivered again.
      const op=uuid(),terminal=j.dispatch_attempts>=MAX_ATTEMPTS;
      try{await env.DB.batch([
        assertion(env.DB,op,'EXISTS(SELECT 1 FROM platform_jobs WHERE id=?2 AND lease_token=?3)',[j.id,token]),
        env.DB.prepare('UPDATE platform_jobs SET state=?1,available_at=?2,lease_token=NULL,lease_until=0,last_error=?3,updated_at=?4,version=version+1 WHERE id=?5').bind(terminal?'DEAD':'RETRY',Date.now()+backoff(j.dispatch_attempts)*1000,'QUEUE_SEND_FAILED',Date.now(),j.id),
        activity(env.DB,j.workspace_id,null,terminal?'job.dead':'job.retry',j.id,'QUEUE_SEND_FAILED'),releaseAssertion(env.DB,op),
      ]);}catch(error){if(!isConflict(error))throw error;}
    }
  }
  return sent;
}
async function source(env:PlatformEnv,j:Job):Promise<{b:Outbox;o:Order;payload:Record<string,unknown>}> {
  const b=await env.DB.prepare('SELECT b.* FROM order_outbox b JOIN orders o ON o.id=b.order_id WHERE b.id=?1 AND b.type=?2 AND o.workspace_id=?3').bind(j.source_id,j.type,j.workspace_id).first<Outbox>();
  if(!b||j.effect_key!==`outbox:${b.id}`)return bad(422,'INVALID_JOB_SOURCE');
  const o=await order(env.DB,b.order_id);
  let payload:Record<string,unknown>;
  try{payload=object(JSON.parse(b.payload_json),j.type==='VERIFY_RECEIPT'?['attemptId','orderId']:['orderId','eventKey','sequence','paymentState','fundsState','deliveryState']);}
  catch{return bad(422,'INVALID_JOB_SOURCE');}
  if(payload.orderId!==o.id)return bad(422,'INVALID_JOB_SOURCE');
  return {b,o,payload};
}
async function effects(env:PlatformEnv,j:Job):Promise<{statements:D1PreparedStatement[];guard?:D1PreparedStatement;guardId?:string;code:string}> {
  if(j.type==='VERIFY_FILE'){
    const f=await file(env,j.source_id);
    if(f.workspace_id!==j.workspace_id||j.effect_key!==`file:${f.id}`)bad(422,'INVALID_JOB_SOURCE');
    if(f.state==='REJECTED')bad(422,'FILE_INTEGRITY_FAILURE');
    if(f.state==='UPLOADING')bad(503,'FILE_NOT_READY');
    await checkObject(env,f);
    return {code:'FILE_READY',statements:[env.DB.prepare("UPDATE file_versions SET state='READY' WHERE id=?1 AND state='QUARANTINED'").bind(f.id)]};
  }
  const {o,payload}=await source(env,j);
  if(j.type==='VERIFY_RECEIPT'){
    const attemptId=identifier(payload.attemptId);
    if(!await env.DB.prepare('SELECT id FROM transaction_attempts WHERE id=?1 AND order_id=?2').bind(attemptId,o.id).first())bad(422,'INVALID_JOB_SOURCE');
    const attempt=await refreshAttempt(env,attemptId);
    if(['PENDING','QUEUED'].includes(attempt.status))bad(503,'RECEIPT_PENDING');
    return {code:'RECEIPT_'+attempt.status,statements:[]};
  }
  if(typeof payload.eventKey!=='string'||typeof payload.sequence!=='number')bad(422,'INVALID_JOB_SOURCE');
  const record=await env.DB.prepare("SELECT e.event_json,e.fingerprint FROM order_chain_events e JOIN order_event_outcomes s ON s.event_key=e.event_key WHERE e.event_key=?1 AND e.deployment_id=?2 AND e.chain_order_id=?3 AND e.sequence=?4 AND s.state='APPLIED'").bind(payload.eventKey,o.deployment_id,o.chain_order_id,payload.sequence).first<{event_json:string;fingerprint:string}>();
  if(!record||await digest(record.event_json)!==record.fingerprint)bad(422,'INVALID_JOB_SOURCE');
  const event=JSON.parse(record!.event_json) as BusinessEvent,r=await rule(env.DB,o.rule_id);
  if(event.orderId!==o.chain_order_id||event.payer!==o.payer||event.rulesHash!==r.rules_hash||event.sequence>o.applied_sequence)bad(422,'INVALID_JOB_SOURCE');
  const statements:D1PreparedStatement[]=[];
  const binding=await env.DB.prepare('SELECT file_id,retention_ms FROM file_rule_bindings WHERE rule_id=?1').bind(r.id).first<{file_id:string;retention_ms:number}>();
  if(binding){
    const f=await file(env,binding.file_id),snapshot=JSON.parse(r.canonical_json) as {file?:{id:string;sha256:string}};
    if(f.workspace_id!==o.workspace_id||snapshot.file?.id!==f.id||snapshot.file.sha256!==f.sha256||binding.retention_ms!==RETENTION_MS)bad(422,'INVALID_JOB_SOURCE');
    const revoked=o.delivery_state==='REVOKED'||['REFUND_CREDIT','REFUNDED'].includes(o.funds_state);
    if(!revoked){if(f.state!=='READY')bad(503,'FILE_NOT_READY');await checkObject(env,f);}
    const paid=await env.DB.prepare("SELECT e.event_key,e.event_json FROM order_chain_events e JOIN order_event_outcomes s ON s.event_key=e.event_key WHERE e.deployment_id=?1 AND e.chain_order_id=?2 AND e.sequence=1 AND s.state='APPLIED'").bind(o.deployment_id,o.chain_order_id).first<{event_key:string;event_json:string}>();
    if(!paid||o.payment_state!=='CONFIRMED')bad(422,'INVALID_JOB_SOURCE');
    const paidEvent=JSON.parse(paid!.event_json) as BusinessEvent,until=paidEvent.timestamp*1000+RETENTION_MS;
    if(paidEvent.kind!=='PAID'||!Number.isSafeInteger(until))bad(422,'INVALID_JOB_SOURCE');
    statements.push(env.DB.prepare("INSERT INTO file_entitlements(order_id,file_id,wallet,state,retention_until,source_event,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(order_id) DO UPDATE SET state=CASE WHEN file_entitlements.state='REVOKED' THEN 'REVOKED' ELSE excluded.state END").bind(o.id,f.id,o.payer,revoked?'REVOKED':'ACTIVE',until,paid!.event_key,Date.now()));
  }
  // Event notifications are historical observations; recovery always returns current state.
  statements.push(env.DB.prepare("INSERT INTO platform_notifications(id,job_id,user_id,workspace_id,order_id,code,created_at) SELECT ?1||':'||u.id,?1,u.id,?2,?3,?4,?5 FROM users u JOIN workspaces w ON w.id=?2 WHERE u.id=w.owner_id OR (u.address=?6 AND u.chain_id=5042002) ON CONFLICT(job_id,user_id) DO NOTHING").bind(j.id,o.workspace_id,o.id,event.kind,Date.now(),o.payer));
  const guardId=uuid();
  return {statements,guardId,guard:assertion(env.DB,guardId,'EXISTS(SELECT 1 FROM orders WHERE id=?2 AND version=?3)',[o.id,o.version]),code:'ORDER_EFFECT_APPLIED'};
}
export interface JobResult {ack:boolean;delaySeconds?:number}
export async function processJob(env:PlatformEnv,envelope:Envelope):Promise<JobResult> {
  platformConfiguration(env);
  const old=await getJob(env,envelope.jobId);
  if(!old||old.generation!==envelope.generation||['SUCCEEDED','DEAD'].includes(old.state))return {ack:true};
  const now=Date.now();
  if(old.lease_until>now||(old.state!=='QUEUED'&&old.available_at>now))return {ack:false,delaySeconds:1};
  if(old.attempts>=MAX_ATTEMPTS){await dead(env,old,'ATTEMPTS_EXHAUSTED');return {ack:true};}
  const token=uuid();
  const j=await env.DB.prepare("UPDATE platform_jobs SET state='RUNNING',attempts=attempts+1,lease_token=?1,lease_until=?2,version=version+1,updated_at=?3 WHERE id=?4 AND version=?5 AND generation=?6 AND state NOT IN ('SUCCEEDED','DEAD') AND lease_until<=?3 RETURNING *").bind(token,now+LEASE_MS,now,old.id,old.version,envelope.generation).first<Job>();
  if(!j)return {ack:false,delaySeconds:1};
  try{
    const result=await effects(env,j),op=uuid();
    await env.DB.batch([
      assertion(env.DB,op,"EXISTS(SELECT 1 FROM platform_jobs WHERE id=?2 AND state='RUNNING' AND lease_token=?3 AND lease_until>?4) AND NOT EXISTS(SELECT 1 FROM platform_inbox WHERE job_id=?2)",[j.id,token,Date.now()]),
      ...(result.guard?[result.guard]:[]),...result.statements,
      env.DB.prepare('INSERT INTO platform_inbox(job_id,result_code,completed_at) VALUES(?1,?2,?3)').bind(j.id,result.code,Date.now()),
      env.DB.prepare("UPDATE platform_jobs SET state='SUCCEEDED',lease_token=NULL,lease_until=0,last_error=NULL,updated_at=?1,version=version+1 WHERE id=?2").bind(Date.now(),j.id),
      activity(env.DB,j.workspace_id,null,'job.succeeded',j.id,result.code),
      ...(result.guardId?[releaseAssertion(env.DB,result.guardId)]:[]),releaseAssertion(env.DB,op),
    ]);
    return {ack:true};
  }catch(error){
    const current=await getJob(env,j.id);
    if(!current||current.lease_token!==token)return {ack:current?.state==='SUCCEEDED',delaySeconds:1};
    const code=error instanceof ApiError&&(RETRY_CODES.has(error.code)||PERMANENT_CODES.has(error.code))?error.code:'TASK_RETRY_REQUIRED';
    const terminal=PERMANENT_CODES.has(code)||j.attempts>=MAX_ATTEMPTS,seconds=backoff(j.attempts),op=uuid();
    try{await env.DB.batch([
      assertion(env.DB,op,'EXISTS(SELECT 1 FROM platform_jobs WHERE id=?2 AND lease_token=?3)',[j.id,token]),
      env.DB.prepare('UPDATE platform_jobs SET state=?1,available_at=?2,lease_token=NULL,lease_until=0,last_error=?3,updated_at=?4,version=version+1 WHERE id=?5').bind(terminal?'DEAD':'RETRY',Date.now()+seconds*1000,code,Date.now(),j.id),
      ...(j.type==='VERIFY_FILE'&&code==='FILE_INTEGRITY_FAILURE'?[env.DB.prepare("UPDATE file_versions SET state='REJECTED' WHERE id=?1 AND state IN ('QUARANTINED','READY')").bind(j.source_id)]:[]),
      activity(env.DB,j.workspace_id,null,terminal?'job.dead':'job.retry',j.id,code),releaseAssertion(env.DB,op),
    ]);}catch(failure){if(!isConflict(failure))throw failure;}
    return {ack:terminal,delaySeconds:seconds};
  }
}
export function parseEnvelope(value:unknown):Envelope|null {
  try{
    const v=object(value,['schema','jobId','generation']);
    if(v.schema!==1||!Number.isSafeInteger(v.generation)||(v.generation as number)<1)return null;
    return {schema:1,jobId:identifier(v.jobId),generation:v.generation as number};
  }catch{return null;}
}
export async function handleQueue(batch:MessageBatch<unknown>,env:PlatformEnv):Promise<void> {
  platformConfiguration(env);
  if(![QUEUE,DEAD_QUEUE].includes(batch.queue))bad(503,'UNKNOWN_QUEUE');
  for(const message of batch.messages){
    const envelope=parseEnvelope(message.body);
    // Malformed/unresolvable envelopes contain no trusted tenant identity. Do not log raw bodies.
    if(!envelope){message.ack();continue;}
    if(batch.queue===DEAD_QUEUE){
      const j=await getJob(env,envelope.jobId);
      if(!j||j.generation!==envelope.generation||['SUCCEEDED','DEAD'].includes(j.state)){message.ack();continue;}
      if(j.lease_until>Date.now()){message.retry({delaySeconds:1});continue;}
      await dead(env,j,'BROKER_DEAD_LETTER');message.ack();continue;
    }
    const result=await processJob(env,envelope);
    if(result.ack)message.ack();else message.retry({delaySeconds:result.delaySeconds??1});
  }
}
export async function retryJob(env:PlatformEnv,i:Identity,workspaceId:string,jobId:string,version:number) {
  platformConfiguration(env);await member(env.DB,workspaceId,i.userId,['owner','operator']);
  const j=await getJob(env,jobId);if(!j||j.workspace_id!==workspaceId)return bad(404,'NOT_FOUND');
  if(j.last_error==='FILE_INTEGRITY_FAILURE')bad(409,'NEW_FILE_VERSION_REQUIRED');
  const op=uuid(),state=uuid();
  try{await env.DB.batch([
    userGuard(env.DB,op,i,workspaceId,['owner','operator']),
    assertion(env.DB,state,"EXISTS(SELECT 1 FROM platform_jobs WHERE id=?2 AND version=?3 AND state='DEAD' AND generation<1000) AND NOT EXISTS(SELECT 1 FROM platform_inbox WHERE job_id=?2)",[j.id,version]),
    env.DB.prepare("UPDATE platform_jobs SET state='PENDING',generation=generation+1,attempts=0,dispatch_attempts=0,available_at=?1,lease_token=NULL,lease_until=0,last_error=NULL,version=version+1,updated_at=?1 WHERE id=?2").bind(Date.now(),j.id),
    activity(env.DB,workspaceId,i.userId,'job.manual-retry',j.id),releaseAssertion(env.DB,op),releaseAssertion(env.DB,state),
  ]);}catch(error){if(isConflict(error))return bad(409,'JOB_VERSION_OR_ACCESS_CHANGED');throw error;}
  const result=await getJob(env,j.id);return {id:result!.id,state:result!.state,version:result!.version,generation:result!.generation};
}
export async function platformTick(env:PlatformEnv,workspaceId?:string) {
  platformConfiguration(env);const bridged=await bridgeOutbox(env,workspaceId),sent=await dispatchDue(env,workspaceId);return {bridged,sent,completed:false};
}
