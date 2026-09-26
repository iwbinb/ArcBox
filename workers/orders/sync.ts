import { keccak256, toHex, type Hex } from 'viem';
import { ApiError, bad } from '../identity/security';
import { EVENT_TOPIC, USDC, ordersConfiguration, type Attempt, type Deployment, type OrderEnv } from './domain';
import { ChainReader, logFingerprint, type ChainTransaction } from './chain-reader';
import { decodeBusiness, incident, ingestVerifiedReceipt, matchesOrder, reconcileOrder } from './projection';
import { assertion, deployment, id, order, releaseAssertion, rule, verifyAttemptTransaction } from './store';

const approvalTopic=keccak256(toHex('Approval(address,address,uint256)'));
const topicAddress=(value:string)=>'0x'+'0'.repeat(24)+value.slice(2).toLowerCase();
interface Cursor {deployment_id:string;last_complete_block:number;last_block_hash:Hex|null;lease_token:string|null;lease_until:number;version:number;last_checked_at:number;last_error:string|null}
interface RangeResult {events:number;applied:number;endHash:Hex}
const errorCode=(error:unknown)=>error instanceof ApiError?error.code:'SYNC_STORAGE_ERROR';

async function saveAttempt(db:D1Database,a:Attempt,status:Attempt['status'],code:string|null,tx:ChainTransaction|null=null):Promise<Attempt>{
  const now=Date.now(),delay=Math.min(60000,1000*2**Math.min(a.checks,6));
  // A slow failed read must not downgrade a receipt already confirmed by another worker.
  const saved=await db.prepare("UPDATE transaction_attempts SET status=?1,last_error=?2,checks=checks+1,next_check_at=?3,checked_at=?4,sender=COALESCE(?5,sender),tx_nonce=COALESCE(?6,tx_nonce) WHERE id=?7 AND status IN ('QUEUED','PENDING')").bind(status,code,now+delay,now,tx?.from??null,tx?.nonce??null,a.id).run();
  if(saved.meta.changes===1&&tx&&['CONFIRMED','REVERTED'].includes(status)){
    await db.prepare("UPDATE transaction_attempts SET status='REPLACED',last_error='SAME_NONCE_MINED',checked_at=?1 WHERE order_id=?2 AND purpose=?3 AND id!=?4 AND sender=?5 AND tx_nonce=?6 AND status IN ('QUEUED','PENDING')").bind(now,a.order_id,a.purpose,a.id,tx.from,tx.nonce).run();
  }
  return (await db.prepare('SELECT * FROM transaction_attempts WHERE id=?1').bind(a.id).first<Attempt>())!;
}
/** A transaction hash is only a hint. No caller can provide a receipt, event,
 * account balance, RPC endpoint or "mark paid" command through this function. */
export async function refreshAttempt(env:OrderEnv,attemptId:string):Promise<Attempt>{
  ordersConfiguration(env);
  const a=await env.DB.prepare('SELECT * FROM transaction_attempts WHERE id=?1').bind(attemptId).first<Attempt>();
  if(!a)return bad(404,'NOT_FOUND');
  if(!['QUEUED','PENDING'].includes(a.status))return a;
  const o=await order(env.DB,a.order_id),r=await rule(env.DB,o.rule_id),d=await deployment(env.DB,o.deployment_id);
  const reader=new ChainReader(env);let tx:ChainTransaction|null=null;
  try{
    await reader.assertChain();const receipt=await reader.receipt(a.tx_hash);
    if(!receipt){
      tx=await reader.transaction(a.tx_hash);
      if(tx)verifyAttemptTransaction(tx,o,r,d,a.purpose);
      return saveAttempt(env.DB,a,'PENDING',tx?'RECEIPT_PENDING':'TRANSACTION_UNKNOWN',tx);
    }
    tx=receipt.transaction;verifyAttemptTransaction(tx,o,r,d,a.purpose);
    await reader.verifyDeployment(d,receipt.block.number);
    if(receipt.status==='reverted')return saveAttempt(env.DB,a,'REVERTED','CHAIN_REVERTED',tx);
    if(a.purpose==='approval'){
      const approvals=receipt.logs.filter(l=>l.address===USDC&&l.topics.length===3&&l.topics[0]===approvalTopic&&l.topics[1]===topicAddress(o.payer)&&l.topics[2]===topicAddress(d.address)&&l.data===toHex(BigInt(o.amount_u6),{size:32}));
      if(approvals.length!==1)bad(422,'APPROVAL_EVENT_MISSING');
      return saveAttempt(env.DB,a,'CONFIRMED',null,tx);
    }
    const relevant=receipt.logs.map(l=>decodeBusiness(l,d,receipt.block.timestamp)).filter(e=>e&&e.orderId===o.chain_order_id);
    if(!relevant.length||(a.purpose==='payment'&&!relevant.some(e=>e!.kind==='PAID'))||(a.purpose==='business'&&!relevant.some(e=>e!.kind!=='PAID')))bad(422,'ORDER_EVENT_MISSING');
    for(const event of relevant)matchesOrder(event!,o,r,d);
    await ingestVerifiedReceipt(env.DB,d,receipt);
    const states=await env.DB.prepare("SELECT s.state FROM order_chain_events e JOIN order_event_outcomes s ON s.event_key=e.event_key WHERE e.deployment_id=?1 AND e.chain_order_id=?2 AND s.state!='APPLIED' LIMIT 64").bind(d.id,o.chain_order_id).all<{state:string}>();
    const note=states.results.some(s=>s.state==='QUARANTINED')?'PROJECTION_QUARANTINED':states.results.length?'PROJECTION_PENDING':null;
    return saveAttempt(env.DB,a,'CONFIRMED',note,tx);
  }catch(error){
    const permanent=error instanceof ApiError&&error.status<500&&error.code!=='PROJECTION_BUSY';
    return saveAttempt(env.DB,a,permanent?'REJECTED':'PENDING',errorCode(error),tx);
  }
}
/** Retry durable inbox records even when the scanner is already at the head. */
export async function drainPending(db:D1Database,d:Deployment):Promise<number>{
  const ready=await db.prepare("SELECT o.id FROM orders o JOIN order_deployments d ON d.id=o.deployment_id WHERE o.deployment_id=?1 AND d.status='ACTIVE' AND EXISTS(SELECT 1 FROM order_chain_events e JOIN order_event_outcomes s ON s.event_key=e.event_key WHERE e.deployment_id=o.deployment_id AND e.chain_order_id=o.chain_order_id AND e.sequence=o.applied_sequence+1 AND s.state='PENDING') ORDER BY o.id LIMIT 4").bind(d.id).all<{id:string}>();
  let applied=0;for(const o of ready.results)applied+=await reconcileOrder(db,o.id,d);return applied;
}
async function collectRange(env:OrderEnv,d:Deployment,reader:ChainReader,from:number,to:number):Promise<RangeResult>{
  const anchor=await reader.block(to);await reader.verifyDeployment(d,to);
  const logs=await reader.logs(d,from,to),hashes=[...new Set(logs.map(l=>l.transactionHash))];
  if(logs.length>64||hashes.length>8)bad(503,'RPC_RANGE_LIMIT');
  const seen=new Set<string>(),positions=new Set<string>();
  for(const l of logs){
    const key=`${l.transactionHash}:${l.logIndex}`,position=`${l.blockNumber}:${l.logIndex}`;
    if(seen.has(key)||positions.has(position))bad(503,'DUPLICATE_RPC_LOG');seen.add(key);positions.add(position);
  }
  const expected=new Set(logs.map(logFingerprint));let events=0,applied=0;
  for(const hash of hashes){
    const receipt=await reader.receipt(hash);
    if(!receipt||receipt.status!=='success'||receipt.block.number<from||receipt.block.number>to)return bad(503,'RPC_LOG_RECEIPT_MISMATCH');
    const matches=receipt.logs.filter(l=>l.address===d.address&&l.topics[0]===EVENT_TOPIC);
    if(matches.length!==logs.filter(l=>l.transactionHash===hash).length||matches.some(l=>!expected.has(logFingerprint(l))))bad(503,'RPC_LOG_RECEIPT_MISMATCH');
    await reader.verifyDeployment(d,receipt.block.number);
    const result=await ingestVerifiedReceipt(env.DB,d,receipt);events+=result.events;applied+=result.applied;
  }
  if((await reader.block(to)).hash!==anchor.hash)bad(503,'RPC_BLOCK_MISMATCH');
  return {events,applied,endHash:anchor.hash};
}
export async function scanDeployment(env:OrderEnv,deploymentId:string):Promise<Record<string,unknown>>{
  ordersConfiguration(env);const d=await deployment(env.DB,deploymentId),token=id(),now=Date.now();
  const cursor=await env.DB.prepare('UPDATE order_sync_cursors SET lease_token=?1,lease_until=?2,version=version+1 WHERE deployment_id=?3 AND lease_until<=?4 RETURNING *').bind(token,now+60000,d.id,now).first<Cursor>();
  if(!cursor)return {status:'BUSY',deploymentId};
  const reader=new ChainReader(env);
  try{
    await reader.assertChain();const latest=await reader.block();
    if(latest.number<cursor.last_complete_block)bad(503,'RPC_HEAD_BEHIND');
    if(cursor.last_complete_block>=d.deployment_block){
      if(!cursor.last_block_hash||(await reader.block(cursor.last_complete_block)).hash!==cursor.last_block_hash)bad(503,'CURSOR_ANCHOR_MISMATCH');
    }
    const recovered=await drainPending(env.DB,d);
    const from=cursor.last_complete_block+1;
    if(from>latest.number){
      await env.DB.prepare('UPDATE order_sync_cursors SET lease_token=NULL,lease_until=0,last_checked_at=?1,last_error=NULL WHERE deployment_id=?2 AND lease_token=?3').bind(now,d.id,token).run();
      return {status:'CURRENT',deploymentId,lastCompleteBlock:cursor.last_complete_block,recovered};
    }
    let to=Math.min(from+127,latest.number),result:RangeResult|null=null;
    for(let attempt=0;attempt<8;attempt++){
      try{result=await collectRange(env,d,reader,from,to);break;}
      catch(error){
        // An unavailable provider is not a range-size signal. Retain the cursor.
        if(error instanceof ApiError&&error.code==='RPC_RANGE_LIMIT'&&to>from){to=from+Math.floor((to-from)/2);continue;}
        throw error;
      }
    }
    if(!result)return bad(503,'SCAN_BUDGET_EXHAUSTED');
    const end=await reader.block(to),op=id();
    if(end.hash!==result.endHash)bad(503,'RPC_BLOCK_MISMATCH');
    await env.DB.batch([
      assertion(env.DB,op,"EXISTS(SELECT 1 FROM order_sync_cursors c JOIN order_deployments d ON d.id=c.deployment_id WHERE c.deployment_id=?2 AND c.lease_token=?3 AND c.last_complete_block=?4 AND d.status='ACTIVE')",[d.id,token,cursor.last_complete_block]),
      env.DB.prepare('UPDATE order_sync_cursors SET last_complete_block=?1,last_block_hash=?2,last_checked_at=?3,last_error=NULL,lease_token=NULL,lease_until=0,version=version+1 WHERE deployment_id=?4 AND lease_token=?5').bind(to,result.endHash,Date.now(),d.id,token),
      releaseAssertion(env.DB,op),
    ]);
    return {status:'SCANNED',deploymentId,fromBlock:from,toBlock:to,recovered,...result};
  }catch(error){
    const code=errorCode(error);
    await env.DB.prepare('UPDATE order_sync_cursors SET lease_token=NULL,lease_until=0,last_checked_at=?1,last_error=?2 WHERE deployment_id=?3 AND lease_token=?4').bind(Date.now(),code,d.id,token).run();
    if(['CURSOR_ANCHOR_MISMATCH','DEPLOYMENT_CODE_MISMATCH','RPC_BLOCK_MISMATCH','RPC_LOG_RECEIPT_MISMATCH','DUPLICATE_RPC_LOG'].includes(code))await incident(env.DB,d,`cursor:${cursor.last_complete_block}`,code);
    throw error;
  }
}
/** Deliberate bounded replay uses the same verifier, but never moves the forward cursor. */
export async function replayRange(env:OrderEnv,deploymentId:string,from:number,to:number){
  ordersConfiguration(env);const d=await deployment(env.DB,deploymentId);
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<d.deployment_block||to<from||to-from>=128)bad(422,'INVALID_REPLAY_RANGE');
  const reader=new ChainReader(env);await reader.assertChain();return collectRange(env,d,reader,from,to);
}
/** Local-only scheduled entry. Queue delivery and hosted Cron wiring belong to M2-C/D. */
export async function syncTick(env:OrderEnv):Promise<Record<string,unknown>>{
  if(env.ORDER_SYNC_ENABLED!=='true')return {status:'DISABLED'};
  ordersConfiguration(env);
  const due=await env.DB.prepare("SELECT a.id FROM transaction_attempts a JOIN orders o ON o.id=a.order_id JOIN order_deployments d ON d.id=o.deployment_id WHERE a.status IN ('QUEUED','PENDING') AND a.checks<8 AND a.next_check_at<=?1 AND d.status='ACTIVE' ORDER BY a.next_check_at,a.id LIMIT 2").bind(Date.now()).all<{id:string}>();
  for(const a of due.results)await refreshAttempt(env,a.id);
  const next=await env.DB.prepare("SELECT d.id FROM order_deployments d JOIN order_sync_cursors c ON c.deployment_id=d.id WHERE d.status='ACTIVE' ORDER BY c.last_checked_at,d.id LIMIT 1").first<{id:string}>();
  return {status:'COMPLETE',attempts:due.results.length,scan:next?await scanDeployment(env,next.id):null};
}
