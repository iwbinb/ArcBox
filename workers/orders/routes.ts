import { authenticate, type Identity } from '../identity/auth';
import { bad, body, expectedVersion, rate, response, text } from '../identity/security';
import { member } from '../identity/workspaces';
import { hash32, orderSummary, ordersConfiguration, type Order, type OrderEnv, type Purpose } from './domain';
import { authorizedOrder, createIntent, detail, freezeRule, rule, submitAttempt, transactionPlan } from './store';
import { refreshAttempt } from './sync';

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function identifier(value:unknown):string {
  if(typeof value!=='string'||!uuidPattern.test(value))return bad(422,'INVALID_ID');return value;
}
function cursor(request:Request):string {
  const value=new URL(request.url).searchParams.get('cursor')??'';
  return value?identifier(value):'';
}
export function isOrderRoute(path:string):boolean {
  return /^\/api\/v1\/(orders|order-rules)(\/|$)/.test(path)
    || /^\/api\/v1\/me\/orders(\/|$)/.test(path)
    || /^\/api\/v1\/workspaces\/[^/]+\/(orders|order-rules)(\/|$)/.test(path);
}
async function listOrders(request:Request,env:OrderEnv,identity:Identity,workspaceId?:string):Promise<Response>{
  const after=cursor(request);
  if(workspaceId)await member(env.DB,workspaceId,identity.userId);
  const result=workspaceId
    ? await env.DB.prepare('SELECT o.* FROM orders o WHERE o.workspace_id=?1 AND o.id>?2 AND EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=o.workspace_id AND m.user_id=?3) ORDER BY o.id LIMIT 26').bind(workspaceId,after,identity.userId).all<Order>()
    : await env.DB.prepare('SELECT * FROM orders WHERE payer=?1 AND id>?2 ORDER BY id LIMIT 26').bind(identity.address.toLowerCase(),after).all<Order>();
  return response({items:result.results.slice(0,25).map(orderSummary),nextCursor:result.results.length>25?result.results[24]!.id:null});
}

/** Runs behind the identity Worker's exact-origin and method checks. */
export async function orderRoutes(request:Request,env:OrderEnv):Promise<Response>{
  ordersConfiguration(env);
  const p=new URL(request.url).pathname.slice('/api/v1/'.length).split('/');
  const method=request.method;
  // An explicitly frozen rule is a public snapshot. It contains no customer,
  // invitation, private file, signature, session or transaction-attempt data.
  if(p[0]==='order-rules'&&p.length===2&&method==='GET'){
    const r=await rule(env.DB,identifier(p[1]));
    return response({id:r.id,rulesHash:r.rules_hash,snapshot:JSON.parse(r.canonical_json),scope:'LOCAL_PROBE_ONLY'});
  }
  const identity=await authenticate(request,env,method!=='GET');
  if(p[0]==='me'&&p[1]==='orders'&&p.length===2&&method==='GET')return listOrders(request,env,identity);
  if(p[0]==='workspaces'&&p.length===3){
    const workspaceId=identifier(p[1]);
    if(p[2]==='orders'&&method==='GET')return listOrders(request,env,identity,workspaceId);
    if(p[2]==='order-rules'){
      await member(env.DB,workspaceId,identity.userId,['owner']);
      if(method==='POST'){
        const input=await body(request,['draftId','deploymentId','amountU6']);
        const frozen=await freezeRule(env,identity,workspaceId,{draftId:identifier(input.draftId),draftVersion:expectedVersion(request),deploymentId:identifier(input.deploymentId),amountU6:text(input.amountU6,78)});
        return response({id:frozen.id,rulesHash:frozen.rules_hash,snapshot:JSON.parse(frozen.canonical_json)},201);
      }
      if(method==='GET'){
        const result=await env.DB.prepare('SELECT id,draft_id,draft_version,title,tool_type,amount_u6,rules_hash FROM order_rules WHERE workspace_id=?1 AND id>?2 ORDER BY id LIMIT 26').bind(workspaceId,cursor(request)).all();
        return response({items:result.results.slice(0,25),nextCursor:result.results.length>25?result.results[24]!.id:null});
      }
    }
  }
  if(p[0]!=='orders')return bad(404,'NOT_FOUND');
  if(p.length===1&&method==='POST'){
    const input=await body(request,['ruleId']);
    const result=await createIntent(env,identity,identifier(input.ruleId),request.headers.get('Idempotency-Key')??'');
    return response({order:orderSummary(result.order),replayed:result.replayed,intentSigned:false,broadcastEnabled:false},result.replayed?200:201);
  }
  if(p.length<2)return bad(404,'NOT_FOUND');
  const orderId=identifier(p[1]);
  if(p.length===2&&method==='GET'){
    const result=await detail(env.DB,identity,orderId);
    return response(result,200,{'ETag':`"${result.order.version}"`});
  }
  if(p.length===3&&p[2]==='tx-plan'&&method==='GET'){
    const action=new URL(request.url).searchParams.get('action');
    if(action!=='approve'&&action!=='pay')return bad(422,'INVALID_ACTION');
    await rate(env.DB,`order-plan:${identity.userId}`,20);
    return response(await transactionPlan(env,identity,orderId,action));
  }
  if(p.length===3&&p[2]==='transactions'&&method==='POST'){
    const input=await body(request,['txHash','purpose']);
    if(!['approval','payment','business'].includes(String(input.purpose)))bad(422,'INVALID_PURPOSE');
    const attempt=await submitAttempt(env,identity,orderId,hash32(input.txHash),input.purpose as Purpose);
    return response({attempt,acceptedForVerification:true,paymentConfirmed:false},202);
  }
  if(p.length===5&&p[2]==='transactions'&&p[4]==='refresh'&&method==='POST'){
    await body(request,[]);await authorizedOrder(env.DB,identity,orderId,true);
    const attemptId=identifier(p[3]);
    if(!await env.DB.prepare('SELECT id FROM transaction_attempts WHERE id=?1 AND order_id=?2').bind(attemptId,orderId).first())return bad(404,'NOT_FOUND');
    await rate(env.DB,`order-refresh:${identity.userId}`,20);
    return response(await refreshAttempt(env,attemptId));
  }
  if(p.length===3&&p[2]==='ledger'&&method==='GET'){
    await authorizedOrder(env.DB,identity,orderId);
    const rows=await env.DB.prepare('SELECT l.event_key,l.entry_index,l.account,l.side,l.amount_u6,e.sequence,e.block_number FROM order_ledger l JOIN order_chain_events e ON e.event_key=l.event_key WHERE l.order_id=?1 ORDER BY e.sequence,l.entry_index LIMIT 128').bind(orderId).all();
    return response({items:rows.results,source:'VERIFIED_EVENT_PROJECTION'});
  }
  return bad(404,'NOT_FOUND');
}
