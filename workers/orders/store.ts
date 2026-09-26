import { encodeFunctionData, type Hex } from 'viem';
import type { Identity } from '../identity/auth';
import { bad, digest, randomToken } from '../identity/security';
import { member } from '../identity/workspaces';
import { ADAPTER, CHAIN_ID, INTENT_SECONDS, MAX_AMOUNT, PROBE_ABI, TOKEN_ABI, USDC, canonicalRule, hash32, orderSummary, ordersConfiguration, ruleHash, uint, wallet, type Attempt, type Deployment, type Order, type OrderEnv, type Purpose, type Rule } from './domain';
import { ChainReader, type ChainTransaction } from './chain-reader';

export const id=()=>crypto.randomUUID();
export function assertion(db:D1Database,operation:string,predicate:string,values:(string|number|null)[]):D1PreparedStatement {
  return db.prepare(`INSERT INTO order_mutation_guards(id,ok) SELECT ?1,CASE WHEN ${predicate} THEN 1 ELSE 0 END`).bind(operation,...values);
}
export const releaseAssertion=(db:D1Database,operation:string)=>db.prepare('DELETE FROM order_mutation_guards WHERE id=?1').bind(operation);
export const isConflict=(error:unknown)=>/UNIQUE constraint|CHECK constraint/.test(String(error));

export async function deployment(db:D1Database,deploymentId:string,active=true):Promise<Deployment>{
  const d=await db.prepare('SELECT * FROM order_deployments WHERE id=?1').bind(deploymentId).first<Deployment>();
  if(!d)return bad(404,'NOT_FOUND');
  if(d.chain_id!==CHAIN_ID||d.asset!==USDC||d.adapter!==ADAPTER||(active&&d.status!=='ACTIVE'))bad(503,'DEPLOYMENT_UNAVAILABLE');
  return d;
}
export async function rule(db:D1Database,ruleId:string):Promise<Rule>{
  const r=await db.prepare('SELECT * FROM order_rules WHERE id=?1').bind(ruleId).first<Rule>();
  if(!r)return bad(404,'NOT_FOUND');
  if(ruleHash(r.canonical_json)!==r.rules_hash)bad(503,'RULE_INTEGRITY_FAILURE');
  return r;
}
export async function order(db:D1Database,orderId:string):Promise<Order>{
  const o=await db.prepare('SELECT * FROM orders WHERE id=?1').bind(orderId).first<Order>();
  if(!o)return bad(404,'NOT_FOUND');return o;
}

/** Internal test/bootstrap primitive, deliberately not exposed by HTTP.
 * Registration requires the exact bytecode at the stated deployment block. */
export async function registerLocalDeployment(env:OrderEnv,input:{workspaceId:string;address:string;codeHash:string;deploymentBlock:number}):Promise<Deployment>{
  ordersConfiguration(env);
  if(!Number.isSafeInteger(input.deploymentBlock)||input.deploymentBlock<0)bad(422,'INVALID_DEPLOYMENT_BLOCK');
  const owner=await env.DB.prepare('SELECT u.address FROM workspaces w JOIN users u ON u.id=w.owner_id WHERE w.id=?1').bind(input.workspaceId).first<{address:string}>();
  if(!owner)return bad(404,'NOT_FOUND');
  const d:Deployment={id:id(),workspace_id:input.workspaceId,chain_id:CHAIN_ID,address:wallet(input.address),asset:USDC as Hex,beneficiary:wallet(owner.address),adapter:ADAPTER,code_hash:hash32(input.codeHash),deployment_block:input.deploymentBlock,status:'ACTIVE',created_at:Date.now()};
  const reader=new ChainReader(env);await reader.assertChain();await reader.verifyDeployment(d,d.deployment_block);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO order_deployments(id,workspace_id,chain_id,address,asset,beneficiary,adapter,code_hash,deployment_block,status,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)').bind(d.id,d.workspace_id,d.chain_id,d.address,d.asset,d.beneficiary,d.adapter,d.code_hash,d.deployment_block,d.status,d.created_at),
    env.DB.prepare('INSERT INTO order_sync_cursors(deployment_id,last_complete_block) VALUES(?1,?2)').bind(d.id,d.deployment_block-1),
  ]);return d;
}
export async function freezeRule(env:OrderEnv,identity:Identity,workspaceId:string,input:{draftId:string;draftVersion:number;deploymentId:string;amountU6:string}):Promise<Rule>{
  ordersConfiguration(env);await member(env.DB,workspaceId,identity.userId,['owner']);
  const d=await deployment(env.DB,input.deploymentId);
  if(d.workspace_id!==workspaceId)bad(404,'NOT_FOUND');
  const draft=await env.DB.prepare('SELECT id,version,tool_type,title,description,archived FROM drafts WHERE id=?1 AND workspace_id=?2').bind(input.draftId,workspaceId).first<{id:string;version:number;tool_type:string;title:string;description:string;archived:number}>();
  if(!draft)return bad(404,'NOT_FOUND');if(draft.archived||draft.version!==input.draftVersion)bad(409,'VERSION_CONFLICT');
  const amount=uint(input.amountU6,MAX_AMOUNT,false).toString();
  const canonical=canonicalRule(d,draft,amount),hash=ruleHash(canonical);
  const existing=await env.DB.prepare('SELECT * FROM order_rules WHERE deployment_id=?1 AND draft_id=?2 AND draft_version=?3').bind(d.id,draft.id,draft.version).first<Rule>();
  if(existing){if(existing.rules_hash!==hash)bad(409,'RULE_ALREADY_FROZEN');return existing;}
  const result:Rule={id:id(),workspace_id:workspaceId,deployment_id:d.id,draft_id:draft.id,draft_version:draft.version,rules_hash:hash,canonical_json:canonical,amount_u6:amount,title:draft.title,tool_type:draft.tool_type,created_by:identity.userId,created_at:Date.now()};
  const op=id();
  try{
    await env.DB.batch([
      assertion(env.DB,op,"EXISTS(SELECT 1 FROM drafts f JOIN memberships m ON m.workspace_id=f.workspace_id JOIN order_deployments d ON d.workspace_id=f.workspace_id WHERE f.id=?2 AND f.version=?3 AND f.archived=0 AND m.user_id=?4 AND m.role='owner' AND d.id=?5 AND d.status='ACTIVE')",[draft.id,draft.version,identity.userId,d.id]),
      env.DB.prepare('INSERT INTO order_rules(id,workspace_id,deployment_id,draft_id,draft_version,rules_hash,canonical_json,amount_u6,title,tool_type,created_by,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)').bind(result.id,workspaceId,d.id,draft.id,draft.version,hash,canonical,amount,draft.title,draft.tool_type,identity.userId,result.created_at),
      releaseAssertion(env.DB,op),
    ]);
  }catch(error){
    if(isConflict(error)){
      const same=await env.DB.prepare('SELECT * FROM order_rules WHERE deployment_id=?1 AND draft_id=?2 AND draft_version=?3').bind(d.id,draft.id,draft.version).first<Rule>();
      if(same&&same.rules_hash===hash)return same;return bad(409,'RULE_OR_ACCESS_CHANGED');
    }throw error;
  }
  return result;
}
export async function createIntent(env:OrderEnv,identity:Identity,ruleId:string,key:string):Promise<{order:Order;replayed:boolean}>{
  ordersConfiguration(env);
  if(!/^[A-Za-z0-9._:-]{16,128}$/.test(key))bad(422,'IDEMPOTENCY_KEY_REQUIRED');
  const keyHash=await digest(`order.v1:${identity.userId}:${key}`),requestHash=await digest(JSON.stringify([ruleId,identity.address.toLowerCase()]));
  const replay=async()=>{
    const saved=await env.DB.prepare('SELECT request_hash,order_id FROM order_idempotency WHERE key_hash=?1').bind(keyHash).first<{request_hash:string;order_id:string}>();
    if(!saved)return null;if(saved.request_hash!==requestHash)bad(409,'IDEMPOTENCY_CONFLICT');
    return {order:await order(env.DB,saved.order_id),replayed:true};
  };
  const found=await replay();if(found)return found;
  const r=await rule(env.DB,ruleId),d=await deployment(env.DB,r.deployment_id),now=Date.now();
  const orderId=id(),chainOrderId=`0x${randomToken()}`,nonce=`0x${randomToken()}`,op=id();
  try{
    await env.DB.batch([
      assertion(env.DB,op,"EXISTS(SELECT 1 FROM order_deployments WHERE id=?2 AND status='ACTIVE') AND (SELECT count(*) FROM orders WHERE payer=?3 AND payment_state='UNPAID' AND expires_at>?4)<100",[d.id,identity.address.toLowerCase(),Math.floor(now/1000)]),
      env.DB.prepare('INSERT INTO orders(id,workspace_id,rule_id,deployment_id,chain_order_id,payer,amount_u6,nonce,expires_at,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)').bind(orderId,r.workspace_id,r.id,d.id,chainOrderId,identity.address.toLowerCase(),r.amount_u6,nonce,Math.floor(now/1000)+INTENT_SECONDS,now),
      env.DB.prepare('INSERT INTO order_idempotency(key_hash,request_hash,order_id,created_at) VALUES(?1,?2,?3,?4)').bind(keyHash,requestHash,orderId,now),
      releaseAssertion(env.DB,op),
    ]);
  }catch(error){if(isConflict(error)){const existing=await replay();if(existing)return existing;return bad(409,'ORDER_LIMIT_OR_STATE_CHANGED');}throw error;}
  return {order:await order(env.DB,orderId),replayed:false};
}
export async function authorizedOrder(db:D1Database,identity:Identity,orderId:string,write=false):Promise<Order>{
  const o=await db.prepare(`SELECT o.* FROM orders o WHERE o.id=?1 AND (o.payer=?2 OR EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=o.workspace_id AND m.user_id=?3 ${write?"AND m.role IN ('owner','editor','operator')":''}))`).bind(orderId,identity.address.toLowerCase(),identity.userId).first<Order>();
  if(!o)return bad(404,'NOT_FOUND');return o;
}
export async function submitAttempt(env:OrderEnv,identity:Identity,orderId:string,hash:Hex,purpose:Purpose):Promise<Attempt>{
  ordersConfiguration(env);const o=await authorizedOrder(env.DB,identity,orderId,true);
  const saved=()=>env.DB.prepare('SELECT * FROM transaction_attempts WHERE order_id=?1 AND tx_hash=?2 AND purpose=?3').bind(o.id,hash,purpose).first<Attempt>();
  const old=await saved();if(old)return old;
  const attemptId=id(),now=Date.now(),op=id();
  try{
    await env.DB.batch([
      assertion(env.DB,op,"EXISTS(SELECT 1 FROM orders o WHERE o.id=?2 AND (o.payer=?3 OR EXISTS(SELECT 1 FROM memberships m WHERE m.workspace_id=o.workspace_id AND m.user_id=?4 AND m.role IN ('owner','editor','operator')))) AND (SELECT count(*) FROM transaction_attempts WHERE order_id=?2)<32",[o.id,identity.address.toLowerCase(),identity.userId]),
      env.DB.prepare('INSERT INTO transaction_attempts(id,order_id,tx_hash,purpose,next_check_at,created_at) VALUES(?1,?2,?3,?4,?5,?5)').bind(attemptId,o.id,hash,purpose,now),
      env.DB.prepare("INSERT INTO order_outbox(id,effect_key,order_id,type,payload_json,created_at) VALUES(?1,?2,?3,'VERIFY_RECEIPT',?4,?5)").bind(id(),`verify:${attemptId}`,o.id,JSON.stringify({attemptId,orderId:o.id}),now),
      releaseAssertion(env.DB,op),
    ]);
  }catch(error){if(isConflict(error)){const existing=await saved();if(existing)return existing;return bad(409,'ATTEMPT_LIMIT_OR_ACCESS_CHANGED');}throw error;}
  return (await saved())!;
}
export function paymentData(o:Order,r:Rule):Hex{
  return encodeFunctionData({abi:PROBE_ABI,functionName:'pay',args:[o.chain_order_id,r.rules_hash,o.nonce,BigInt(o.amount_u6),BigInt(o.expires_at)]});
}
export function approvalData(o:Order,d:Deployment):Hex{
  return encodeFunctionData({abi:TOKEN_ABI,functionName:'approve',args:[d.address,BigInt(o.amount_u6)]});
}
export function verifyAttemptTransaction(t:ChainTransaction,o:Order,r:Rule,d:Deployment,purpose:Purpose):void{
  if(t.value!==0n||t.to!==(purpose==='approval'?USDC:d.address))bad(422,'TRANSACTION_TARGET_MISMATCH');
  if(purpose==='approval'||purpose==='payment'){
    if(t.from!==o.payer||t.input!==(purpose==='approval'?approvalData(o,d):paymentData(o,r)).toLowerCase())bad(422,'TRANSACTION_INTENT_MISMATCH');
  }
}
export async function transactionPlan(env:OrderEnv,identity:Identity,orderId:string,action:'approve'|'pay'){
  ordersConfiguration(env);const o=await authorizedOrder(env.DB,identity,orderId);
  if(o.payer!==identity.address.toLowerCase())bad(403,'PAYER_REQUIRED');
  if(o.payment_state!=='UNPAID')bad(409,'ALREADY_PAID');
  const r=await rule(env.DB,o.rule_id),d=await deployment(env.DB,o.deployment_id),reader=new ChainReader(env);
  await reader.assertChain();const block=await reader.block();
  if(Math.max(block.timestamp,Math.floor(Date.now()/1000))>=o.expires_at)bad(409,'INTENT_EXPIRED');
  await reader.verifyDeployment(d,block.number);
  const balance=await reader.balance(o.payer,d.address,block.number),amount=BigInt(o.amount_u6);
  if(balance.token<amount)bad(422,'INSUFFICIENT_FUNDS');
  if(action==='pay'&&balance.allowance<amount)bad(409,'APPROVAL_REQUIRED');
  if(action==='approve'&&balance.allowance>=amount)bad(409,'APPROVAL_NOT_REQUIRED');
  const to=action==='approve'?USDC as Hex:d.address,data=action==='approve'?approvalData(o,d):paymentData(o,r);
  const fees=await reader.simulate(o.payer,to,data,block.number),estimatedFee=fees.gas*fees.gasPrice;
  if(balance.native<(action==='pay'?amount*1_000_000_000_000n:0n)+estimatedFee)bad(422,'INSUFFICIENT_GAS');
  if((await reader.block(block.number)).hash!==block.hash)bad(503,'RPC_BLOCK_MISMATCH');
  return {chainId:CHAIN_ID,from:o.payer,to,data,value:'0',action,orderId:o.id,amountU6:o.amount_u6,rulesHash:r.rules_hash,expiresAt:o.expires_at,simulationBlock:block.number,simulationBlockHash:block.hash,estimatedGas:fees.gas.toString(),estimatedGasFeeU18:estimatedFee.toString(),requiresWalletSignature:true,intentSigned:false,broadcastEnabled:false,scope:'LOCAL_PROBE_ONLY'};
}
export async function detail(db:D1Database,identity:Identity,orderId:string){
  const o=await authorizedOrder(db,identity,orderId),r=await rule(db,o.rule_id);
  const [attempts,events,cursor]=await Promise.all([
    db.prepare('SELECT id,tx_hash,purpose,status,sender,tx_nonce,last_error,checks,checked_at FROM transaction_attempts WHERE order_id=?1 ORDER BY created_at,id LIMIT 32').bind(o.id).all(),
    db.prepare('SELECT e.event_key,e.sequence,e.block_number,s.state,s.reason FROM order_chain_events e JOIN order_event_outcomes s ON s.event_key=e.event_key WHERE e.chain_order_id=?1 AND e.deployment_id=?2 ORDER BY e.sequence LIMIT 64').bind(o.chain_order_id,o.deployment_id).all(),
    db.prepare('SELECT last_complete_block,last_block_hash,last_checked_at,last_error FROM order_sync_cursors WHERE deployment_id=?1').bind(o.deployment_id).first(),
  ]);
  return {order:orderSummary(o),rule:{id:r.id,rulesHash:r.rules_hash,snapshot:JSON.parse(r.canonical_json)},attempts:attempts.results,events:events.results,indexer:cursor};
}
