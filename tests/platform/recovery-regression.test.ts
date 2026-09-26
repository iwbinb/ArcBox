import { beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { join, resetRpc } from '../orders/helpers';
import { actor, call, context, due, env, fileContext, grant, json, origin, paid, project, setupPlatform } from './helpers';
import { catalogEntry, jobInsert, type Envelope, type PlatformEnv } from '../../workers/platform/domain';
import { consumeDownload, createUpload, file, issueDownload, uploadContent } from '../../workers/platform/files';
import { dispatchDue, getJob, processJob } from '../../workers/platform/jobs';

beforeAll(setupPlatform);
beforeEach(resetRpc);

function afterObjectRead(effect:()=>Promise<void>):PlatformEnv {
  // A deterministic fault at the external-read boundary, not a mocked database.
  const files={get:async(key:string)=>{const object=await env.FILES!.get(key);await effect();return object;}} as unknown as R2Bucket;
  return {...env,FILES:files};
}
function downloadRequest(orderId:string,token:string){return new Request(origin+`/api/v1/orders/${orderId}/download`,{headers:{'X-ArcBox-Download':token}});}

test('RACE-01 session revoked while R2 is read cannot receive bytes or consume grant',async()=>{
  const c=await paid(),g=await grant(c);
  const interrupted=afterObjectRead(async()=>{await env.DB.prepare('UPDATE sessions SET revoked_at=?1 WHERE token_hash=?2').bind(Date.now(),c.buyer.identity.tokenHash).run();});
  await expect(consumeDownload(downloadRequest(c.order.id,g.token),interrupted,c.buyer.identity,c.order.id)).rejects.toThrow('DOWNLOAD_USED_OR_ACCESS_CHANGED');
  expect(await env.DB.prepare('SELECT consumed_at FROM download_grants WHERE id=?1').bind(g.grantId).first('consumed_at')).toBeNull();
});
test('RACE-02 refund during object read wins over a previously valid download grant',async()=>{
  const c=await paid(),g=await grant(c);
  const interrupted=afterObjectRead(async()=>{await env.DB.prepare("UPDATE orders SET funds_state='REFUND_CREDIT',delivery_state='REVOKED',version=version+1 WHERE id=?1").bind(c.order.id).run();});
  await expect(consumeDownload(downloadRequest(c.order.id,g.token),interrupted,c.buyer.identity,c.order.id)).rejects.toThrow('DOWNLOAD_USED_OR_ACCESS_CHANGED');
  expect(await env.DB.prepare('SELECT consumed_at FROM download_grants WHERE id=?1').bind(g.grantId).first('consumed_at')).toBeNull();
});
test('RACE-03 membership removed after receiving upload bytes cannot publish the file',async()=>{
  const c=await context(),editor=await actor();await join(c,editor,'editor');
  const f=await createUpload(env,editor.identity,c.workspaceId,'sample-v1',crypto.randomUUID()),entry=await catalogEntry('sample-v1');
  const files={
    put:env.FILES!.put.bind(env.FILES!),
    get:async(key:string)=>{const object=await env.FILES!.get(key);await env.DB.prepare('DELETE FROM memberships WHERE workspace_id=?1 AND user_id=?2').bind(c.workspaceId,editor.identity.userId).run();return object;},
  } as unknown as R2Bucket;
  const request=new Request(origin+`/api/v1/files/${f.id}/content`,{method:'POST',headers:{'Content-Type':'text/plain'},body:entry.content});
  await expect(uploadContent(request,{...env,FILES:files},editor.identity,f.id)).rejects.toThrow('FILE_OR_ACCESS_CHANGED');
  expect((await file(env,f.id)).state).toBe('UPLOADING');
});
test('EXPIRY-01 retained file is inaccessible at the exact entitlement deadline',async()=>{
  const c=await paid(),until=await env.DB.prepare('SELECT retention_until FROM file_entitlements WHERE order_id=?1').bind(c.order.id).first<number>('retention_until');
  expect(until).not.toBeNull();const clock=vi.spyOn(Date,'now').mockReturnValue(until!);
  try{await expect(issueDownload(env,c.buyer.identity,c.order.id)).rejects.toThrow('FILE_ACCESS_NOT_AVAILABLE');}finally{clock.mockRestore();}
});
test('EXPIRY-02 upload deadline is not renewed by idempotent creation replay',async()=>{
  const c=await context(),key=crypto.randomUUID(),f=await createUpload(env,c.owner.identity,c.workspaceId,'sample-v1',key),entry=await catalogEntry('sample-v1');
  const clock=vi.spyOn(Date,'now').mockReturnValue(f.uploadUntil);
  try{
    const replay=await createUpload(env,c.owner.identity,c.workspaceId,'sample-v1',key);expect(replay.uploadUntil).toBe(f.uploadUntil);
    await expect(uploadContent(new Request(origin,{method:'POST',headers:{'Content-Type':'text/plain'},body:entry.content}),env,c.owner.identity,f.id)).rejects.toThrow('UPLOAD_EXPIRED_OR_REJECTED');
  }finally{clock.mockRestore();}
});
test('RECOVERY-CONTRACT explicit status fields match the current order and halted indexer',async()=>{
  const c=await paid(),view=(await json(await call(`/recovery/${c.order.id}`,'GET',undefined,c.buyer))).data;
  expect(view.order).toMatchObject({id:c.order.id,paymentState:'CONFIRMED',fundsState:'LOCKED',deliveryState:'NOT_STARTED',amountU6:'1000000'});
  expect(view.downloadEligible).toBe(true);
  await env.DB.prepare("UPDATE order_deployments SET status='HALTED' WHERE id=?1").bind(c.deployment.id).run();
  const halted=(await json(await call(`/recovery/${c.order.id}`,'GET',undefined,c.buyer))).data;
  expect(halted.downloadEligible).toBe(false);expect(halted.indexerStatus).toBe('HALTED');expect(halted.actions).not.toContain('REQUEST_DOWNLOAD');
});
test('PAGINATION-01 cursor returns all files once and remains workspace-scoped',async()=>{
  const c=await context();
  for(let n=0;n<26;n++)await createUpload(env,c.owner.identity,c.workspaceId,'sample-v1',crypto.randomUUID());
  const first=(await json(await call(`/workspaces/${c.workspaceId}/files`,'GET',undefined,c.owner))).data;
  expect(first.items).toHaveLength(25);expect(first.nextCursor).toBeTypeOf('string');
  const last=(await json(await call(`/workspaces/${c.workspaceId}/files?cursor=${first.nextCursor}`,'GET',undefined,c.owner))).data;
  expect(last.items).toHaveLength(1);expect(last.nextCursor).toBeNull();expect(new Set([...first.items,...last.items].map(f=>f.id)).size).toBe(26);
  expect((await call(`/workspaces/${c.workspaceId}/files?cursor=${first.nextCursor}`,'GET',undefined,c.buyer)).status).toBe(404);
});
test('RECOVERY-CRASH accepted envelope plus failed sent marker replays one effect',async()=>{
  const c=await fileContext(),job=(await project(c))[0]!,messages:Envelope[]=[];
  // Fault-injection transport records accepted envelopes. Real broker and DLQ
  // execution are tested separately; this case exercises SQL marker failure.
  const accepted={...env,JOBS:{send:async(value:Envelope)=>{messages.push(value);}} as unknown as Queue<Envelope>};
  await env.DB.prepare(`CREATE TRIGGER reject_sent_marker BEFORE UPDATE ON order_outbox WHEN NEW.id='${job.source_id}' BEGIN SELECT RAISE(ABORT,'test marker failure'); END`).run();
  try{await dispatchDue(accepted,c.workspaceId);}finally{await env.DB.prepare('DROP TRIGGER reject_sent_marker').run();}
  expect(messages).toHaveLength(1);expect((await getJob(env,job.id))?.state).toBe('RETRY');
  expect(await env.DB.prepare('SELECT state FROM order_outbox WHERE id=?1').bind(job.source_id).first('state')).toBe('PENDING');
  await due(job.id);await processJob(env,messages[0]!);await processJob(env,messages[0]!);
  expect(await env.DB.prepare('SELECT count(*) n FROM platform_inbox WHERE job_id=?1').bind(job.id).first('n')).toBe(1);
  expect(await env.DB.prepare('SELECT count(*) n FROM platform_notifications WHERE job_id=?1').bind(job.id).first('n')).toBe(2);
});
test('SOURCE-01 a forged cross-workspace task cannot mark another tenant file ready',async()=>{
  const c=await context(),other=await context(),f=await createUpload(env,other.owner.identity,other.workspaceId,'sample-v1',crypto.randomUUID());
  await jobInsert(env.DB,c.workspaceId,'VERIFY_FILE',f.id,`file:${f.id}`).run();
  const j=await env.DB.prepare('SELECT id,generation FROM platform_jobs WHERE effect_key=?1').bind(`file:${f.id}`).first<{id:string;generation:number}>();
  expect((await processJob(env,{schema:1,jobId:j!.id,generation:j!.generation})).ack).toBe(true);
  expect((await getJob(env,j!.id))?.last_error).toBe('INVALID_JOB_SOURCE');expect((await file(env,f.id)).state).toBe('UPLOADING');
});
