import { authenticate, type Identity } from '../identity/auth';
import { bad, body, expectedVersion, rate, response, text } from '../identity/security';
import { member } from '../identity/workspaces';
import { authorizedOrder, detail } from '../orders/store';
import { catalog, fileSummary, identifier, platformConfiguration, type FileVersion, type PlatformEnv } from './domain';
import { completeUpload, consumeDownload, createUpload, freezeFileRule, issueDownload, uploadContent } from './files';
import { platformTick, retryJob } from './jobs';

export function isPlatformRoute(path:string):boolean {
  return /^\/api\/v1\/(files|recovery)(\/|$)/.test(path)
    || /^\/api\/v1\/me\/notifications(\/|$)/.test(path)
    || /^\/api\/v1\/workspaces\/[^/]+\/(files|file-rules|operations|jobs|activity)(\/|$)/.test(path)
    || /^\/api\/v1\/orders\/[^/]+\/downloads?(\/|$)/.test(path);
}
function cursor(request:Request,kind:'uuid'|'number'|'notification'='uuid'):string|number {
  const s=new URL(request.url).searchParams.get('cursor')??'';
  if(kind==='number'){if(s&&!/^[0-9]{1,12}$/.test(s))bad(422,'INVALID_CURSOR');return Number(s||0);}
  if(!s)return '';
  if(kind==='notification'){if(s.length>200||!/^[a-z0-9:-]+$/.test(s))bad(422,'INVALID_CURSOR');return s;}
  return identifier(s);
}
function page<T extends {id:string|number}>(rows:T[]){return {items:rows.slice(0,25),nextCursor:rows.length>25?rows[24]!.id:null};}
const JOB_FIELDS='id,type,state,generation,attempts,dispatch_attempts,available_at,lease_until,version,last_error,created_at,updated_at';
async function recovery(env:PlatformEnv,i:Identity,orderId:string) {
  const result=await detail(env.DB,i,orderId),o=result.order;
  const [ent,files,jobs,deploymentStatus]=await Promise.all([
    env.DB.prepare('SELECT file_id,wallet,state,retention_until FROM file_entitlements WHERE order_id=?1').bind(o.id).first<{file_id:string;wallet:string;state:string;retention_until:number}>(),
    env.DB.prepare('SELECT f.* FROM file_rule_bindings b JOIN file_versions f ON f.id=b.file_id WHERE b.rule_id=?1').bind(o.rule_id).first<FileVersion>(),
    env.DB.prepare(`SELECT ${JOB_FIELDS.split(',').map(k=>'j.'+k).join(',')} FROM platform_jobs j JOIN order_outbox b ON b.id=j.source_id WHERE b.order_id=?1 AND j.workspace_id=?2 ORDER BY j.created_at DESC LIMIT 25`).bind(o.id,o.workspace_id).all(),
    env.DB.prepare('SELECT status FROM order_deployments WHERE id=?1').bind(o.deployment_id).first<string>('status'),
  ]);
  // This is a UI summary, not a download authorization. Actual downloads repeat
  // all checks after reading R2 and atomically consume a session-bound grant.
  if((await authorizedOrder(env.DB,i,orderId)).version!==o.version)bad(409,'RECOVERY_STATE_CHANGED');
  if(!await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash=?1 AND user_id=?2 AND revoked_at IS NULL AND expires_at>?3').bind(i.tokenHash,i.userId,Date.now()).first())bad(401,'SESSION_EXPIRED');
  const own=o.payer===i.address.toLowerCase();
  const available=own&&!!ent&&ent.wallet===o.payer&&ent.file_id===files?.id&&ent.state==='ACTIVE'&&ent.retention_until>Date.now()&&files?.state==='READY'&&deploymentStatus==='ACTIVE'&&o.payment_state==='CONFIRMED'&&['LOCKED','SETTLEMENT_CREDIT','SETTLED'].includes(o.funds_state)&&o.delivery_state!=='REVOKED';
  return {
    ...result,
    // The new recovery endpoint intentionally exposes a stable presentation
    // contract. Existing M2-B order-detail response fields remain unchanged.
    order:{id:o.id,version:o.version,paymentState:o.payment_state,fundsState:o.funds_state,deliveryState:o.delivery_state,businessState:o.business_state,amountU6:o.amount_u6,source:'VERIFIED_EVENT_PROJECTION'},
    file:files?fileSummary(files):null,
    entitlement:ent?{file_id:ent.file_id,state:ent.state,retention_until:ent.retention_until}:null,
    jobs:jobs.results,downloadEligible:available,indexerStatus:deploymentStatus,
    actions:available?['REQUEST_DOWNLOAD']:o.payment_state==='UNPAID'?['CHECK_TRANSACTION_BEFORE_REPAYING']:['REFRESH_STATUS','CONTACT_WORKSPACE'],
    scope:'LOCAL_PLATFORM_ONLY',fundsActionsEnabled:false,
  };
}
export async function platformRoutes(request:Request,env:PlatformEnv):Promise<Response> {
  platformConfiguration(env);
  const i=await authenticate(request,env,request.method!=='GET'),method=request.method;
  const p=new URL(request.url).pathname.slice('/api/v1/'.length).split('/');
  if(p[0]==='files'){
    if(p.length===2&&p[1]==='catalog'&&method==='GET')return response({items:await catalog(),arbitraryUploadsEnabled:false});
    if(p.length===2&&p[1]==='upload-sessions'&&method==='POST'){
      const v=await body(request,['workspaceId','catalogId','seriesId']);await rate(env.DB,`file-create:${i.userId}`,20);
      return response(await createUpload(env,i,identifier(v.workspaceId),v.catalogId,request.headers.get('Idempotency-Key')??'',v.seriesId===undefined?undefined:identifier(v.seriesId)),201);
    }
    if(p.length===3&&method==='POST'){
      const id=identifier(p[1]);await rate(env.DB,`file-write:${i.userId}`,30);
      if(p[2]==='content')return response(await uploadContent(request,env,i,id));
      if(p[2]==='complete'){await body(request,[]);return response(await completeUpload(env,i,id),202);}
    }
  }
  if(p[0]==='workspaces'&&p.length>=3){
    const w=identifier(p[1]);await member(env.DB,w,i.userId);
    if(p.length===3&&p[2]==='files'&&method==='GET'){
      const rows=await env.DB.prepare('SELECT * FROM file_versions f WHERE workspace_id=?1 AND id>?2 AND EXISTS(SELECT 1 FROM memberships WHERE workspace_id=f.workspace_id AND user_id=?3) ORDER BY id LIMIT 26').bind(w,cursor(request),i.userId).all<FileVersion>();
      return response(page(rows.results.map(fileSummary)));
    }
    if(p.length===3&&p[2]==='file-rules'&&method==='POST'){
      const v=await body(request,['draftId','deploymentId','amountU6','fileId']);await rate(env.DB,`file-rule:${i.userId}`,20);
      if(typeof v.amountU6!=='string')bad(422,'INVALID_INTEGER_AMOUNT');
      const r=await freezeFileRule(env,i,w,{draftId:identifier(v.draftId),draftVersion:expectedVersion(request),deploymentId:identifier(v.deploymentId),amountU6:v.amountU6 as string,fileId:identifier(v.fileId)});
      return response({id:r.id,rulesHash:r.rules_hash,snapshot:JSON.parse(r.canonical_json)},201);
    }
    if(p.length===3&&p[2]==='jobs'&&method==='GET'){
      const rows=await env.DB.prepare(`SELECT ${JOB_FIELDS} FROM platform_jobs j WHERE workspace_id=?1 AND id>?2 AND EXISTS(SELECT 1 FROM memberships WHERE workspace_id=j.workspace_id AND user_id=?3) ORDER BY id LIMIT 26`).bind(w,cursor(request),i.userId).all<{id:string}>();return response(page(rows.results));
    }
    if(p.length===5&&p[2]==='jobs'&&p[4]==='retry'&&method==='POST'){
      await body(request,[]);await rate(env.DB,`job-retry:${i.userId}`,10);
      return response(await retryJob(env,i,w,identifier(p[3]),expectedVersion(request)));
    }
    if(p.length===3&&p[2]==='activity'&&method==='GET'){
      const rows=await env.DB.prepare('SELECT id,action,entity_id,code,created_at FROM platform_activity a WHERE workspace_id=?1 AND id>?2 AND EXISTS(SELECT 1 FROM memberships WHERE workspace_id=a.workspace_id AND user_id=?3) ORDER BY id LIMIT 26').bind(w,cursor(request,'number'),i.userId).all<{id:number}>();return response(page(rows.results));
    }
    if(p.length===3&&p[2]==='operations'&&method==='GET'){
      const [counts,incidents,cursors]=await Promise.all([
        env.DB.prepare('SELECT state,count(*) AS count FROM platform_jobs WHERE workspace_id=?1 GROUP BY state').bind(w).all(),
        env.DB.prepare('SELECT x.id,x.code,x.created_at FROM order_sync_incidents x JOIN order_deployments d ON d.id=x.deployment_id WHERE d.workspace_id=?1 ORDER BY x.id DESC LIMIT 25').bind(w).all(),
        env.DB.prepare('SELECT c.deployment_id,c.last_complete_block,c.last_checked_at,c.last_error,d.status FROM order_sync_cursors c JOIN order_deployments d ON d.id=c.deployment_id WHERE d.workspace_id=?1 ORDER BY c.deployment_id LIMIT 25').bind(w).all(),
      ]);
      await member(env.DB,w,i.userId);
      return response({counts:counts.results,incidents:incidents.results,indexers:cursors.results,storageConfigured:!!env.FILES,queueConfigured:!!env.JOBS,scope:'LOCAL_PLATFORM_ONLY',arbitraryUploadsEnabled:false,externalNotificationsEnabled:false});
    }
    if(p.length===4&&p[2]==='operations'&&p[3]==='run'&&method==='POST'){
      await body(request,[]);await member(env.DB,w,i.userId,['owner','operator']);await rate(env.DB,`job-dispatch:${i.userId}`,10);
      return response(await platformTick(env,w),202);
    }
  }
  if(p[0]==='me'&&p[1]==='notifications'){
    if(p.length===2&&method==='GET'){
      const rows=await env.DB.prepare('SELECT id,order_id,code,created_at,read_at FROM platform_notifications WHERE user_id=?1 AND id>?2 ORDER BY id LIMIT 26').bind(i.userId,cursor(request,'notification')).all<{id:string}>();return response(page(rows.results));
    }
    if(p.length===3&&p[2]==='read'&&method==='POST'){
      const v=await body(request,['id']),id=text(v.id,200);
      const row=await env.DB.prepare('UPDATE platform_notifications SET read_at=coalesce(read_at,?1) WHERE id=?2 AND user_id=?3 AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=?4 AND user_id=?3 AND revoked_at IS NULL AND expires_at>?1) RETURNING id,read_at').bind(Date.now(),id,i.userId,i.tokenHash).first();
      if(!row)bad(404,'NOT_FOUND');return response(row);
    }
  }
  if(p[0]==='recovery'&&p.length===2&&method==='GET')return response(await recovery(env,i,identifier(p[1])));
  if(p[0]==='orders'&&p.length===3){
    const orderId=identifier(p[1]);
    if(p[2]==='downloads'&&method==='POST'){await body(request,[]);await rate(env.DB,`download-grant:${i.userId}`,20);return response(await issueDownload(env,i,orderId),201);}
    if(p[2]==='download'&&method==='GET'){await rate(env.DB,`download:${i.userId}`,30);return consumeDownload(request,env,i,orderId);}
  }
  return bad(404,'NOT_FOUND');
}
