import { expect } from 'vitest';
import worker from '../../workers/identity/index';
import schema from '../../migrations/0003_platform.sql?raw';
import { ChainReader } from '../../workers/orders/chain-reader';
import { ingestVerifiedReceipt } from '../../workers/orders/projection';
import { createIntent } from '../../workers/orders/store';
import { catalogEntry, type PlatformEnv, type Job } from '../../workers/platform/domain';
import { completeUpload, createUpload, file, freezeFileRule } from '../../workers/platform/files';
import { bridgeOutbox, getJob, processJob } from '../../workers/platform/jobs';
import { actor, addReceipt, bindings, call, context, json, origin, setup, type Actor, type Context, type EventOptions } from '../orders/helpers';
export { actor, call, context, json, origin };
export const env=bindings as PlatformEnv;
export async function setupPlatform(){await setup();for(const sql of schema.split('-- break --').map(s=>s.trim()).filter(Boolean))await env.DB.prepare(sql).run();}
export async function uploadRaw(id:string,a:Actor,content:string,headers:Record<string,string>={}) {
  return worker.fetch(new Request(origin+`/api/v1/files/${id}/content`,{method:'POST',headers:{Origin:origin,'Content-Type':'text/plain','Cookie':a.cookie,'X-CSRF-Token':a.csrf,...headers},body:content}),env);
}
export async function sample(c:Context,ready=true,catalogId='sample-v1',seriesId?:string){
  const entry=await catalogEntry(catalogId),summary=await createUpload(env,c.owner.identity,c.workspaceId,entry.id,crypto.randomUUID(),seriesId);
  const sent=await uploadRaw(summary.id,c.owner,entry.content);expect(sent.status).toBe(200);
  await completeUpload(env,c.owner.identity,summary.id);
  const job=await env.DB.prepare('SELECT * FROM platform_jobs WHERE effect_key=?1').bind(`file:${summary.id}`).first<Job>();expect(job).not.toBeNull();
  if(ready)expect((await processJob(env,{schema:1,jobId:job!.id,generation:1})).ack).toBe(true);
  return {file:await file(env,summary.id),job:(await getJob(env,job!.id))!};
}
export async function fileContext(){
  const c=await context(),s=await sample(c);
  const d=await call(`/workspaces/${c.workspaceId}/drafts`,'POST',{toolType:'deliver',title:'Frozen file rule',description:'Controlled local file'},c.owner);expect(d.status).toBe(201);
  c.draftId=(await json(d)).data.id;
  c.rule=await freezeFileRule(env,c.owner.identity,c.workspaceId,{draftId:c.draftId,draftVersion:1,deploymentId:c.deployment.id,amountU6:'1000000',fileId:s.file.id});
  c.order=(await createIntent(env,c.buyer.identity,c.rule.id,crypto.randomUUID())).order;
  return {...c,file:s.file};
}
export async function project(c:Context,options:EventOptions={}){
  const reader=new ChainReader(env),hash=addReceipt(c,options),receipt=await reader.receipt(hash);expect(receipt).not.toBeNull();
  await reader.verifyDeployment(c.deployment,receipt!.block.number);await ingestVerifiedReceipt(env.DB,c.deployment,receipt!);
  await bridgeOutbox(env,c.workspaceId);
  return (await env.DB.prepare('SELECT j.* FROM platform_jobs j JOIN order_outbox b ON b.id=j.source_id WHERE b.order_id=?1 ORDER BY b.created_at,b.id').bind(c.order.id).all<Job>()).results;
}
export async function settleJobs(jobs:Job[]){for(const j of jobs)expect((await processJob(env,{schema:1,jobId:j.id,generation:j.generation})).ack).toBe(true);}
export async function paid(){const c=await fileContext();await settleJobs(await project(c));return c;}
export async function grant(c:Context){const r=await call(`/orders/${c.order.id}/downloads`,'POST',{},c.buyer);expect(r.status).toBe(201);return (await json(r)).data as {grantId:string;token:string;expiresAt:number};}
export async function download(c:Context,token:string,a=c.buyer){return call(`/orders/${c.order.id}/download`,'GET',undefined,a,{'X-ArcBox-Download':token});}
export async function due(id:string){await env.DB.prepare('UPDATE platform_jobs SET available_at=0,lease_until=0,lease_token=NULL,version=version+1 WHERE id=?1').bind(id).run();return (await getJob(env,id))!;}
export async function waitFor(fn:()=>Promise<boolean>,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('TEST_WAIT_TIMEOUT');}
