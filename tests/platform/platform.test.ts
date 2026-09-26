import { beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../../workers/identity/index';
import { authenticate } from '../../workers/identity/auth';
import { digest } from '../../workers/identity/security';
import { createIntent, order } from '../../workers/orders/store';
import { catalog, catalogEntry, DEAD_QUEUE, GRANT_MS, jobInsert, MAX_ATTEMPTS, platformConfiguration, QUEUE, type Envelope, type Job } from '../../workers/platform/domain';
import { completeUpload, createUpload, file, freezeFileRule } from '../../workers/platform/files';
import { bridgeOutbox, dispatchDue, getJob, handleQueue, parseEnvelope, processJob, retryJob } from '../../workers/platform/jobs';
import { join, resetRpc, rpc } from '../orders/helpers';
import { actor, call, context, download, due, env, fileContext, grant, json, origin, paid, project, sample, settleJobs, setupPlatform, uploadRaw, waitFor } from './helpers';

beforeAll(setupPlatform);
beforeEach(resetRpc);
const count=async(table:string,id:string,column='job_id')=>Number(await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column}=?1`).bind(id).first('n'));
const envelope=(j:Job):Envelope=>({schema:1,jobId:j.id,generation:j.generation});

for(const mode of ['demo','testnet','mainnet'])test(`BOUNDARY hosted ${mode} cannot enable local platform`,()=>expect(()=>platformConfiguration({...env,APP_ENV:mode})).toThrow());
test('BOUNDARY absent flag and non-test hostname fail closed',()=>{
  expect(()=>platformConfiguration({...env,PLATFORM_ENABLED:undefined})).toThrow();
  expect(()=>platformConfiguration({...env,APP_ORIGIN:'https://example.com'})).toThrow();
});
test('FILE-01 catalog is a bounded reviewed sample set, not a malware scanner',async()=>{
  const a=await actor(),r=await call('/files/catalog','GET',undefined,a),data=(await json(r)).data;
  expect(r.status).toBe(200);expect(data.arbitraryUploadsEnabled).toBe(false);expect(data.items.length).toBe(2);
  for(const item of data.items){expect(item.sha256).toBe(await digest(item.content));expect(item.bytes).toBe(new TextEncoder().encode(item.content).length);expect(item.review).toBe('CONTROLLED_SAMPLE_NOT_MALWARE_SCAN');}
});
test('FILE-02 unauthenticated catalog and upload creation are denied',async()=>{
  expect((await call('/files/catalog')).status).toBe(401);
  expect((await call('/files/upload-sessions','POST',{})).status).toBe(401);
});
test('FILE-03 arbitrary catalog, caller keys and scan-state overrides are rejected',async()=>{
  const c=await context();
  for(const v of [{workspaceId:c.workspaceId,catalogId:'arbitrary'}, {workspaceId:c.workspaceId,catalogId:'sample-v1',storageKey:'../../private'}, {workspaceId:c.workspaceId,catalogId:'sample-v1',state:'READY'}])expect((await call('/files/upload-sessions','POST',v,c.owner,{'Idempotency-Key':crypto.randomUUID()})).status).toBe(422);
  expect(await count('file_versions',c.workspaceId,'workspace_id')).toBe(0);
});
test('FILE-04 idempotent concurrent upload creation persists one version',async()=>{
  const c=await context(),key=crypto.randomUUID();
  const both=await Promise.all([createUpload(env,c.owner.identity,c.workspaceId,'sample-v1',key),createUpload(env,c.owner.identity,c.workspaceId,'sample-v1',key)]);
  expect(both[0].id).toBe(both[1].id);expect(await count('file_versions',c.workspaceId,'workspace_id')).toBe(1);
  await expect(createUpload(env,c.owner.identity,c.workspaceId,'sample-v2',key)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
});
test('FILE-05 viewer, outsider and cross-workspace series cannot upload',async()=>{
  const c=await context(),viewer=await actor(),outside=await actor();await join(c,viewer);
  for(const a of [viewer,outside])await expect(createUpload(env,a.identity,c.workspaceId,'sample-v1',crypto.randomUUID())).rejects.toThrow();
  const other=await context(),s=await sample(other);
  await expect(createUpload(env,c.owner.identity,c.workspaceId,'sample-v1',crypto.randomUUID(),s.file.series_id)).rejects.toThrow('NOT_FOUND');
});
test('FILE-06 wrong bytes and oversized stream cannot reach R2',async()=>{
  const c=await context(),f=await createUpload(env,c.owner.identity,c.workspaceId,'sample-v1',crypto.randomUUID());
  expect((await uploadRaw(f.id,c.owner,'evil')).status).toBe(422);
  expect((await uploadRaw(f.id,c.owner,'x'.repeat(65537))).status).toBe(413);
  expect(await env.FILES!.head((await file(env,f.id)).storage_key)).toBeNull();
});
for(const type of ['text/html','application/javascript','application/octet-stream'])test(`FILE-07 disallowed MIME ${type}`,async()=>{
  const c=await context(),f=await createUpload(env,c.owner.identity,c.workspaceId,'sample-v1',crypto.randomUUID());
  expect((await uploadRaw(f.id,c.owner,(await catalogEntry('sample-v1')).content,{'Content-Type':type})).status).toBe(415);
});
test('FILE-08 compressed bodies, CSRF and foreign origin are rejected',async()=>{
  const c=await context(),f=await createUpload(env,c.owner.identity,c.workspaceId,'sample-v1',crypto.randomUUID()),content=(await catalogEntry('sample-v1')).content;
  expect((await uploadRaw(f.id,c.owner,content,{'Content-Encoding':'gzip'})).status).toBe(415);
  expect((await uploadRaw(f.id,c.owner,content,{'X-CSRF-Token':'bad'})).status).toBe(403);
  expect((await uploadRaw(f.id,c.owner,content,{Origin:'https://attacker.test'})).status).toBe(403);
});
test('FILE-09 completion is queued and cannot skip byte verification',async()=>{
  const c=await context(),f=await createUpload(env,c.owner.identity,c.workspaceId,'sample-v1',crypto.randomUUID());
  await expect(completeUpload(env,c.owner.identity,f.id)).rejects.toThrow('FILE_NOT_READY');
  await uploadRaw(f.id,c.owner,(await catalogEntry('sample-v1')).content);
  const done=await completeUpload(env,c.owner.identity,f.id);expect(done.job).toBeTruthy();
  expect((await file(env,f.id)).state).toBe('QUARANTINED');
});
test('FILE-10 verified sample becomes READY and repeated uploads cannot replace it',async()=>{
  const c=await context(),s=await sample(c);expect(s.file.state).toBe('READY');
  expect((await uploadRaw(s.file.id,c.owner,(await catalogEntry('sample-v1')).content)).status).toBe(200);
  expect((await file(env,s.file.id)).state).toBe('READY');
  expect((await uploadRaw(s.file.id,c.owner,'modified')).status).toBe(422);
});
test('FILE-11 immutable metadata and no deletion preserve retained versions',async()=>{
  const c=await context(),s=await sample(c);
  await expect(env.DB.prepare('UPDATE file_versions SET storage_key=?1 WHERE id=?2').bind('forged',s.file.id).run()).rejects.toThrow();
  await expect(env.DB.prepare('DELETE FROM file_versions WHERE id=?1').bind(s.file.id).run()).rejects.toThrow();
  expect((await call(`/files/${s.file.id}`,'DELETE',{},c.owner)).status).toBe(404);
});
test('FILE-12 list omits private R2 keys and upload idempotency hashes',async()=>{
  const c=await context();await sample(c);
  const r=await call(`/workspaces/${c.workspaceId}/files`,'GET',undefined,c.owner),body=await r.text();
  expect(r.status).toBe(200);expect(body).not.toMatch(/storage_key|key_hash|request_hash|session_hash/);
  expect((await call(`/workspaces/${c.workspaceId}/files`,'GET',undefined,c.buyer)).status).toBe(404);
});
test('RULE-01 frozen file version survives subsequent version creation',async()=>{
  const c=await fileContext(),later=await sample(c,true,'sample-v2',c.file.series_id);
  expect(later.file.version).toBe(2);expect(JSON.parse(c.rule.canonical_json).file.id).toBe(c.file.id);
  expect(await env.DB.prepare('SELECT file_id FROM file_rule_bindings WHERE rule_id=?1').bind(c.rule.id).first('file_id')).toBe(c.file.id);
  await expect(env.DB.prepare('UPDATE file_rule_bindings SET file_id=?1 WHERE rule_id=?2').bind(later.file.id,c.rule.id).run()).rejects.toThrow();
});
test('RULE-02 existing rules cannot be retrofitted and unverified files cannot freeze',async()=>{
  const c=await context(),s=await sample(c);
  await expect(freezeFileRule(env,c.owner.identity,c.workspaceId,{draftId:c.draftId,draftVersion:1,deploymentId:c.deployment.id,amountU6:'1000000',fileId:s.file.id})).rejects.toThrow('RULE_ALREADY_FROZEN');
  const q=await sample(c,false);await expect(freezeFileRule(env,c.owner.identity,c.workspaceId,{draftId:c.draftId,draftVersion:1,deploymentId:c.deployment.id,amountU6:'1000000',fileId:q.file.id})).rejects.toThrow('FILE_NOT_READY');
});
test('ACCESS-01 unpaid order and ordinary no-file paid order cannot download',async()=>{
  const c=await fileContext();expect((await call(`/orders/${c.order.id}/downloads`,'POST',{},c.buyer)).status).toBe(403);
  const old=await context();await settleJobs(await project(old));expect((await call(`/orders/${old.order.id}/downloads`,'POST',{},old.buyer)).status).toBe(403);
});
test('ACCESS-02 verified event unlocks exact bytes, not a public object URL',async()=>{
  const c=await paid(),g=await grant(c),r=await download(c,g.token);
  expect(r.status).toBe(200);expect(await r.text()).toBe((await catalogEntry('sample-v1')).content);
  expect(r.headers.get('Cache-Control')).toBe('no-store');expect(r.headers.get('Content-Type')).toBe('application/octet-stream');expect(r.headers.get('Content-Disposition')).toContain('attachment');
  expect(await env.DB.prepare('SELECT token_hash FROM download_grants WHERE id=?1').bind(g.grantId).first('token_hash')).not.toBe(g.token);
});
test('ACCESS-03 concurrent consumption has exactly one winner',async()=>{
  const c=await paid(),g=await grant(c),rs=await Promise.all([download(c,g.token),download(c,g.token)]);
  expect(rs.filter(r=>r.status===200)).toHaveLength(1);expect(rs.filter(r=>[403,409].includes(r.status))).toHaveLength(1);
  expect((await download(c,g.token)).status).toBe(403);
});
test('ACCESS-04 grant is bound to payer and originating session',async()=>{
  const c=await paid(),g=await grant(c);
  expect((await download(c,g.token,c.owner)).status).toBe(404);
  const token='b'.repeat(64),tokenHash=await digest(token);
  await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at,signer_kind) VALUES(?1,?2,?3,?4,'eoa')").bind(tokenHash,c.buyer.identity.userId,Date.now()+60000,Date.now()).run();
  const cookie=`__Host-arcbox-session=${token}`,identity=await authenticate(new Request(origin,{headers:{Cookie:cookie}}),env);
  expect((await download(c,g.token,{...c.buyer,cookie,identity,csrf:identity.csrf})).status).toBe(403);
});
test('ACCESS-05 expired grant is denied at its exact deadline',async()=>{
  const c=await paid(),g=await grant(c),clock=vi.spyOn(Date,'now').mockReturnValue(g.expiresAt);
  try{expect((await download(c,g.token)).status).toBe(403);}finally{clock.mockRestore();}
  expect(g.expiresAt-Date.now()).toBeLessThanOrEqual(GRANT_MS);
});
test('ACCESS-06 refund blocks already-issued grant before queue catches up',async()=>{
  const c=await paid(),g=await grant(c);await project(c,{kind:3,sequence:2});
  expect(await env.DB.prepare('SELECT state FROM file_entitlements WHERE order_id=?1').bind(c.order.id).first('state')).toBe('ACTIVE');
  expect((await download(c,g.token)).status).toBe(403);
  expect((await call(`/orders/${c.order.id}/downloads`,'POST',{},c.buyer)).status).toBe(403);
});
test('ACCESS-07 reverse event jobs cannot restore a refunded entitlement',async()=>{
  const c=await fileContext();await project(c);const jobs=await project(c,{kind:3,sequence:2});
  await settleJobs([...jobs].reverse());
  expect(await env.DB.prepare('SELECT state FROM file_entitlements WHERE order_id=?1').bind(c.order.id).first('state')).toBe('REVOKED');
  expect((await call(`/orders/${c.order.id}/downloads`,'POST',{},c.buyer)).status).toBe(403);
});
test('ACCESS-08 missing object does not consume grant; restore then retry',async()=>{
  const c=await paid(),g=await grant(c);await env.FILES!.delete(c.file.storage_key);
  expect((await download(c,g.token)).status).toBe(503);
  expect(await env.DB.prepare('SELECT consumed_at FROM download_grants WHERE id=?1').bind(g.grantId).first('consumed_at')).toBeNull();
  expect((await uploadRaw(c.file.id,c.owner,(await catalogEntry('sample-v1')).content)).status).toBe(200);
  expect((await download(c,g.token)).status).toBe(200);
});
test('ACCESS-09 corrupted bytes never leak to downloader',async()=>{
  const c=await paid(),g=await grant(c);
  await env.FILES!.put(c.file.storage_key,'corrupt',{httpMetadata:{contentType:'text/plain'},customMetadata:{fileId:c.file.id,sha256:c.file.sha256}});
  const r=await download(c,g.token);expect(r.status).toBe(503);expect(await r.text()).not.toContain('corrupt');
});
test('ACCESS-10 session revocation denies subsequent downloads',async()=>{
  const c=await paid(),g=await grant(c);await call('/auth/logout','POST',{},c.buyer);expect((await download(c,g.token)).status).toBe(401);
});
test('ACCESS-11 query secrets and Range requests are refused',async()=>{
  const c=await paid(),g=await grant(c);
  expect((await call(`/orders/${c.order.id}/download?token=${g.token}`,'GET',undefined,c.buyer)).status).toBe(422);
  expect((await call(`/orders/${c.order.id}/download`,'GET',undefined,c.buyer,{'X-ArcBox-Download':g.token,Range:'bytes=0-1'})).status).toBe(422);
});
test('ACCESS-12 halted deployment blocks file delivery without changing funds',async()=>{
  const c=await paid(),g=await grant(c);await env.DB.prepare("UPDATE order_deployments SET status='HALTED' WHERE id=?1").bind(c.deployment.id).run();
  expect((await download(c,g.token)).status).toBe(403);expect((await order(env.DB,c.order.id)).funds_state).toBe('LOCKED');
});
test('QUEUE-01 actual producer binding executes verification and duplicates converge',async()=>{
  const c=await context(),s=await sample(c,false);expect(await dispatchDue(env,c.workspaceId)).toBe(1);
  await waitFor(async()=> (await getJob(env,s.job.id))?.state==='SUCCEEDED');
  await env.JOBS!.send(envelope(s.job));await env.JOBS!.send(envelope(s.job));
  await waitFor(async()=>await count('platform_inbox',s.job.id)===1);
  expect((await file(env,s.file.id)).state).toBe('READY');expect(await count('platform_inbox',s.job.id)).toBe(1);
});
test('QUEUE-02 repeated and concurrent job processing creates one durable effect',async()=>{
  const c=await fileContext(),jobs=await project(c),j=jobs[0]!;
  await Promise.all([processJob(env,envelope(j)),processJob(env,envelope(j))]);
  expect(await count('platform_inbox',j.id)).toBe(1);expect(await count('file_entitlements',c.order.id,'order_id')).toBe(1);
  expect(await count('platform_notifications',j.id)).toBe(2);
});
test('QUEUE-03 late SQL failure rolls back entitlement, notification and inbox',async()=>{
  const c=await fileContext(),j=(await project(c))[0]!;
  await env.DB.prepare(`CREATE TRIGGER platform_test_failure BEFORE INSERT ON platform_inbox WHEN NEW.job_id='${j.id}' BEGIN SELECT RAISE(ABORT,'injected private database failure'); END`).run();
  try{
    expect((await processJob(env,envelope(j))).ack).toBe(false);
    expect(await count('file_entitlements',c.order.id,'order_id')).toBe(0);expect(await count('platform_notifications',j.id)).toBe(0);expect(await count('platform_inbox',j.id)).toBe(0);
    expect((await getJob(env,j.id))?.last_error).toBe('TASK_RETRY_REQUIRED');
  }finally{await env.DB.prepare('DROP TRIGGER platform_test_failure').run();}
  await due(j.id);expect((await processJob(env,envelope(j))).ack).toBe(true);
  expect(await count('file_entitlements',c.order.id,'order_id')).toBe(1);
});
test('QUEUE-04 missing file retries with bounded attempts then enters DEAD',async()=>{
  const c=await context(),s=await sample(c,false);await env.FILES!.delete(s.file.storage_key);
  for(let n=1;n<=MAX_ATTEMPTS;n++){await due(s.job.id);const result=await processJob(env,envelope(s.job));expect(result.ack).toBe(n===MAX_ATTEMPTS);}
  expect((await getJob(env,s.job.id))?.state).toBe('DEAD');expect(await count('platform_inbox',s.job.id)).toBe(0);
});
test('QUEUE-05 real broker exhausts retries and reaches dead-letter consumer',async()=>{
  const c=await context(),s=await sample(c,false);await env.FILES!.delete(s.file.storage_key);await dispatchDue(env,c.workspaceId);
  await waitFor(async()=> (await getJob(env,s.job.id))?.state==='DEAD',15000);
  expect((await getJob(env,s.job.id))?.last_error).toBe('BROKER_DEAD_LETTER');
});
test('QUEUE-06 sender failure leaves source pending and allows later dispatch',async()=>{
  const c=await fileContext(),j=(await project(c))[0]!;
  const failing={...env,JOBS:{send:async()=>{throw new Error('private queue credentials');}} as unknown as Queue<Envelope>};
  await dispatchDue(failing,c.workspaceId);
  expect((await getJob(env,j.id))?.last_error).toBe('QUEUE_SEND_FAILED');
  expect(await env.DB.prepare('SELECT state FROM order_outbox WHERE id=?1').bind(j.source_id).first('state')).toBe('PENDING');
  await due(j.id);await dispatchDue(env,c.workspaceId);await waitFor(async()=> (await getJob(env,j.id))?.state==='SUCCEEDED');
});
test('QUEUE-07 active lease excludes a second worker and expired lease recovers',async()=>{
  const c=await context(),s=await sample(c,false);
  await env.DB.prepare("UPDATE platform_jobs SET state='RUNNING',lease_token='old',lease_until=?1 WHERE id=?2").bind(Date.now()+60000,s.job.id).run();
  expect((await processJob(env,envelope(s.job))).ack).toBe(false);expect(await count('platform_inbox',s.job.id)).toBe(0);
  await due(s.job.id);expect((await processJob(env,envelope(s.job))).ack).toBe(true);
});
test('QUEUE-08 manual retry is versioned; stale DLQ cannot kill new generation',async()=>{
  const c=await context(),s=await sample(c,false);
  await env.DB.prepare("UPDATE platform_jobs SET state='DEAD',last_error='FILE_UNAVAILABLE' WHERE id=?1").bind(s.job.id).run();
  const old=(await getJob(env,s.job.id))!,next=await retryJob(env,c.owner.identity,c.workspaceId,old.id,old.version);
  expect(next.generation).toBe(2);await expect(retryJob(env,c.owner.identity,c.workspaceId,old.id,old.version)).rejects.toThrow('JOB_VERSION_OR_ACCESS_CHANGED');
  let acked=false;
  await handleQueue({queue:DEAD_QUEUE,messages:[{body:envelope(old),ack:()=>{acked=true;},retry:()=>{throw new Error('unexpected retry');}}]} as unknown as MessageBatch<unknown>,env);
  expect(acked).toBe(true);expect((await getJob(env,old.id))?.state).toBe('PENDING');
  expect((await processJob(env,{schema:1,jobId:old.id,generation:2})).ack).toBe(true);
});
test('QUEUE-09 viewer retry, wrong workspace and missing version are denied',async()=>{
  const c=await context(),s=await sample(c,false),viewer=await actor();await join(c,viewer);
  await env.DB.prepare("UPDATE platform_jobs SET state='DEAD' WHERE id=?1").bind(s.job.id).run();
  expect((await call(`/workspaces/${c.workspaceId}/jobs/${s.job.id}/retry`,'POST',{},viewer,{'If-Match':'"1"'})).status).toBe(403);
  expect((await call(`/workspaces/${c.workspaceId}/jobs/${s.job.id}/retry`,'POST',{},c.owner)).status).toBe(428);
  const other=await context();expect((await call(`/workspaces/${other.workspaceId}/jobs/${s.job.id}/retry`,'POST',{},other.owner,{'If-Match':'"1"'})).status).toBe(404);
});
test('QUEUE-10 integrity failures are quarantined and cannot be manually approved',async()=>{
  const c=await context(),s=await sample(c,false);await env.FILES!.put(s.file.storage_key,'bad');
  expect((await processJob(env,envelope(s.job))).ack).toBe(true);expect((await file(env,s.file.id)).state).toBe('REJECTED');
  const j=(await getJob(env,s.job.id))!;
  await expect(retryJob(env,c.owner.identity,c.workspaceId,j.id,j.version)).rejects.toThrow('NEW_FILE_VERSION_REQUIRED');
});
test('QUEUE-11 malformed and unknown envelopes do not create tenant records',async()=>{
  for(const v of [null,{},[],{schema:1,jobId:'../../x',generation:1},{schema:1,jobId:crypto.randomUUID(),generation:1,source:'forged'}])expect(parseEnvelope(v)).toBeNull();
  expect((await processJob(env,{schema:1,jobId:crypto.randomUUID(),generation:1})).ack).toBe(true);
});
test('QUEUE-12 scheduled handler dispatches durable file task without public writes',async()=>{
  const c=await context(),s=await sample(c,false),ctx=createExecutionContext();
  await worker.scheduled(createScheduledController({scheduledTime:Date.now()}),env,ctx);await waitOnExecutionContext(ctx);
  // Global dispatch is bounded; use scoped catch-up if other test jobs consumed the batch.
  for(let n=0;n<4&&(await getJob(env,s.job.id))?.state!=='SUCCEEDED';n++){await dispatchDue(env,c.workspaceId);await new Promise(r=>setTimeout(r,300));}
  await waitFor(async()=> (await getJob(env,s.job.id))?.state==='SUCCEEDED');
  expect(rpc.calls.every(c=>!c.method.startsWith('eth_send'))).toBe(true);
});
test('RECOVERY-01 payer without merchant workspace sees own recovery, outsider does not',async()=>{
  const c=await paid(),r=await call(`/recovery/${c.order.id}`,'GET',undefined,c.buyer),data=(await json(r)).data;
  expect(r.status).toBe(200);expect(data.downloadEligible).toBe(true);expect(data.fundsActionsEnabled).toBe(false);
  const a=await actor();expect((await call(`/recovery/${c.order.id}`,'GET',undefined,a)).status).toBe(404);
  expect(JSON.stringify(data)).not.toMatch(/storage_key|token_hash|session_hash|signed_message/);
});
test('RECOVERY-02 notifications are private and read marking cannot cross users',async()=>{
  const c=await paid(),buyer=(await json(await call('/me/notifications','GET',undefined,c.buyer))).data.items;
  expect(buyer.length).toBe(1);expect(buyer[0].code).toBe('PAID');
  const other=await actor();expect((await json(await call('/me/notifications','GET',undefined,other))).data.items).toHaveLength(0);
  expect((await call('/me/notifications/read','POST',{id:buyer[0].id},other)).status).toBe(404);
  expect((await call('/me/notifications/read','POST',{id:buyer[0].id},c.buyer)).status).toBe(200);
  expect((await json(await call('/me/notifications','GET',undefined,c.buyer))).data.items[0].read_at).toBeTypeOf('number');
});
test('RECOVERY-03 operational audit is append-only, scoped, and sanitized',async()=>{
  const c=await context();await sample(c);
  const r=await call(`/workspaces/${c.workspaceId}/activity`,'GET',undefined,c.owner),body=await r.text();expect(r.status).toBe(200);expect(body).not.toMatch(/storage_key|token_hash|signature|lease_token/);
  expect((await call(`/workspaces/${c.workspaceId}/activity`,'GET',undefined,c.buyer)).status).toBe(404);
  await expect(env.DB.prepare('UPDATE platform_activity SET code=?1 WHERE workspace_id=?2').bind('edited',c.workspaceId).run()).rejects.toThrow();
});
test('RECOVERY-04 member removal immediately removes operations access',async()=>{
  const c=await context(),a=await actor();await join(c,a);
  expect((await call(`/workspaces/${c.workspaceId}/operations`,'GET',undefined,a)).status).toBe(200);
  await env.DB.prepare('DELETE FROM memberships WHERE workspace_id=?1 AND user_id=?2').bind(c.workspaceId,a.identity.userId).run();
  expect((await call(`/workspaces/${c.workspaceId}/operations`,'GET',undefined,a)).status).toBe(404);
});
test('RECOVERY-05 invalid pagination and arbitrary task creation are refused',async()=>{
  const c=await context();expect((await call(`/workspaces/${c.workspaceId}/jobs?cursor=bad`,'GET',undefined,c.owner)).status).toBe(422);
  expect((await call(`/workspaces/${c.workspaceId}/activity?cursor=-1`,'GET',undefined,c.owner)).status).toBe(422);
  expect((await call(`/workspaces/${c.workspaceId}/jobs`,'POST',{type:'TRANSFER',to:'attacker'},c.owner)).status).toBe(404);
});
