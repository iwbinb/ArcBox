import { decodeEventLog, encodeAbiParameters, type Hex } from 'viem';
import { ApiError, bad, digest } from '../identity/security';
import { CHAIN_ID, EVENT_TOPIC, KINDS, MAX_EVENTS_PER_ORDER, PROBE_ABI, hash32, uint, wallet, type BusinessEvent, type Deployment, type EventRow, type Order, type Rule } from './domain';
import type { ChainLog, VerifiedReceipt } from './chain-reader';
import { assertion, id, isConflict, order, releaseAssertion, rule } from './store';

// This module only maintains a local D1 projection. It cannot sign transactions,
// transfer tokens, modify a deployed contract, or expose administrative HTTP APIs.
export function decodeBusiness(log:ChainLog,d:Deployment,timestamp:number):BusinessEvent|null{
  if(log.address!==d.address||log.topics[0]!==EVENT_TOPIC)return null;
  if(log.topics.length!==4||log.blockNumber<d.deployment_block)bad(503,'INVALID_BUSINESS_EVENT');
  let args:Record<string,unknown>;
  try{args=decodeEventLog({abi:PROBE_ABI,data:log.data,topics:log.topics as [Hex,...Hex[]],strict:true}).args as unknown as Record<string,unknown>;}
  catch{return bad(503,'INVALID_BUSINESS_EVENT');}
  const sequence=Number(args.sequence),kind=Number(args.kind);
  if(!Number.isSafeInteger(sequence)||sequence<1||sequence>MAX_EVENTS_PER_ORDER||!Number.isInteger(kind)||kind<1||kind>KINDS.length)bad(503,'INVALID_BUSINESS_EVENT');
  const amountU6=uint(String(args.amountU6)).toString(),recipient=wallet(args.recipient),nonce=hash32(args.nonce);
  const data=encodeAbiParameters([{type:'uint32'},{type:'uint8'},{type:'uint256'},{type:'address'},{type:'bytes32'}],[sequence,kind,BigInt(amountU6),recipient,nonce]);
  if(data.toLowerCase()!==log.data)bad(503,'NON_CANONICAL_EVENT');
  return {key:`${CHAIN_ID}:${log.transactionHash}:${log.logIndex}`,deploymentId:d.id,chainId:CHAIN_ID,contract:d.address,txHash:log.transactionHash,blockHash:log.blockHash,blockNumber:log.blockNumber,transactionIndex:log.transactionIndex,logIndex:log.logIndex,timestamp,orderId:hash32(args.orderId),payer:wallet(args.payer),rulesHash:hash32(args.rulesHash),sequence,kind:KINDS[kind-1]!,amountU6,recipient,nonce};
}
export function matchesOrder(e:BusinessEvent,o:Order,r:Rule,d:Deployment):void{
  if(e.chainId!==CHAIN_ID||e.deploymentId!==d.id||e.contract!==d.address||e.orderId!==o.chain_order_id||e.payer!==o.payer||e.rulesHash!==r.rules_hash||e.nonce!==o.nonce||o.deployment_id!==d.id)bad(409,'ORDER_EVENT_MISMATCH');
  if(e.amountU6!==(e.kind==='AVAILABLE'?'0':o.amount_u6))bad(409,'EVENT_AMOUNT_MISMATCH');
  const expected=e.kind==='PAID'?d.address:e.kind.startsWith('SETTLEMENT')?d.beneficiary:o.payer;
  if(e.recipient!==expected)bad(409,'EVENT_RECIPIENT_MISMATCH');
  if(e.kind==='PAID'&&(e.sequence!==1||e.timestamp>=o.expires_at||e.timestamp<Math.floor(o.created_at/1000)))bad(409,'EVENT_INTENT_EXPIRED');
}
interface LedgerLine{account:string;side:'DEBIT'|'CREDIT';amount:string}
export function transition(o:Order,e:BusinessEvent):{next:Order;lines:LedgerLine[]}{
  if(e.sequence!==o.applied_sequence+1)bad(409,'EVENT_GAP');
  const next={...o,version:o.version+1,applied_sequence:e.sequence,last_block:e.blockNumber};
  const pair=(debit:string,credit:string):LedgerLine[]=>[{account:debit,side:'DEBIT',amount:e.amountU6},{account:credit,side:'CREDIT',amount:e.amountU6}];
  let lines:LedgerLine[]=[];
  switch(e.kind){
    case 'PAID':
      if(o.payment_state!=='UNPAID'||o.funds_state!=='NONE'||e.sequence!==1)bad(409,'INVALID_TRANSITION');
      next.payment_state='CONFIRMED';next.funds_state='LOCKED';next.business_state='ACTIVE';lines=pair('ASSET_ESCROW','LIABILITY_LOCKED');break;
    case 'AVAILABLE':
      if(o.funds_state!=='LOCKED'||o.delivery_state!=='NOT_STARTED')bad(409,'INVALID_TRANSITION');next.delivery_state='AVAILABLE';break;
    case 'REFUND_CREDITED':
      if(o.funds_state!=='LOCKED')bad(409,'INVALID_TRANSITION');next.funds_state='REFUND_CREDIT';next.delivery_state='REVOKED';next.business_state='CANCELLED';lines=pair('LIABILITY_LOCKED','LIABILITY_REFUND');break;
    case 'SETTLEMENT_CREDITED':
      if(o.funds_state!=='LOCKED')bad(409,'INVALID_TRANSITION');next.funds_state='SETTLEMENT_CREDIT';next.business_state='COMPLETED';lines=pair('LIABILITY_LOCKED','LIABILITY_SETTLEMENT');break;
    case 'REFUND_WITHDRAWN':
      if(o.funds_state!=='REFUND_CREDIT')bad(409,'INVALID_TRANSITION');next.funds_state='REFUNDED';lines=pair('LIABILITY_REFUND','ASSET_ESCROW');break;
    case 'SETTLEMENT_WITHDRAWN':
      if(o.funds_state!=='SETTLEMENT_CREDIT')bad(409,'INVALID_TRANSITION');next.funds_state='SETTLED';lines=pair('LIABILITY_SETTLEMENT','ASSET_ESCROW');break;
  }
  return {next,lines};
}
export async function incident(db:D1Database,d:Deployment,eventKey:string,code:string,halt=true):Promise<void>{
  const statements=[db.prepare('INSERT OR IGNORE INTO order_sync_incidents(deployment_id,event_key,code,created_at) VALUES(?1,?2,?3,?4)').bind(d.id,eventKey,code,Date.now())];
  if(halt)statements.push(db.prepare("UPDATE order_deployments SET status='HALTED' WHERE id=?1").bind(d.id));
  await db.batch(statements);
}
async function quarantine(db:D1Database,d:Deployment,e:BusinessEvent,code:string):Promise<void>{
  await db.prepare("UPDATE order_event_outcomes SET state='QUARANTINED',reason=?1 WHERE event_key=?2 AND state='PENDING'").bind(code,e.key).run();
  await incident(db,d,e.key,code);
}
export async function reconcileOrder(db:D1Database,orderId:string,d:Deployment):Promise<number>{
  let applied=0;
  for(let iteration=0;iteration<MAX_EVENTS_PER_ORDER;iteration++){
    let committed=false;
    for(let retry=0;retry<3;retry++){
      const o=await order(db,orderId);
      const row=await db.prepare("SELECT e.* FROM order_chain_events e JOIN order_event_outcomes s ON s.event_key=e.event_key WHERE e.deployment_id=?1 AND e.chain_order_id=?2 AND e.sequence=?3 AND s.state='PENDING'").bind(d.id,o.chain_order_id,o.applied_sequence+1).first<EventRow>();
      if(!row)return applied;
      const event=JSON.parse(row.event_json) as BusinessEvent,r=await rule(db,o.rule_id);
      let result:ReturnType<typeof transition>;
      try{
        matchesOrder(event,o,r,d);
        if(o.applied_sequence>0){
          const previous=await db.prepare('SELECT block_number,transaction_index,log_index FROM order_chain_events WHERE deployment_id=?1 AND chain_order_id=?2 AND sequence=?3').bind(d.id,o.chain_order_id,o.applied_sequence).first<{block_number:number;transaction_index:number;log_index:number}>();
          if(!previous||event.blockNumber<previous.block_number||(event.blockNumber===previous.block_number&&(event.transactionIndex<previous.transaction_index||(event.transactionIndex===previous.transaction_index&&event.logIndex<=previous.log_index))))bad(409,'NON_MONOTONIC_EVENT');
        }
        result=transition(o,event);
      }catch(error){if(!(error instanceof ApiError))throw error;await quarantine(db,d,event,error.code);return applied;}
      const op=id(),now=Date.now(),n=result.next;
      const batch=[
        assertion(db,op,"EXISTS(SELECT 1 FROM orders o JOIN order_deployments d ON d.id=o.deployment_id WHERE o.id=?2 AND o.version=?3 AND o.applied_sequence=?4 AND d.status='ACTIVE') AND EXISTS(SELECT 1 FROM order_event_outcomes WHERE event_key=?5 AND state='PENDING')",[o.id,o.version,o.applied_sequence,event.key]),
        db.prepare('UPDATE orders SET payment_state=?1,funds_state=?2,delivery_state=?3,business_state=?4,applied_sequence=?5,version=?6,last_block=?7 WHERE id=?8').bind(n.payment_state,n.funds_state,n.delivery_state,n.business_state,n.applied_sequence,n.version,n.last_block,o.id),
        db.prepare("UPDATE order_event_outcomes SET state='APPLIED',reason=NULL,applied_at=?1 WHERE event_key=?2").bind(now,event.key),
        ...result.lines.map((line,i)=>db.prepare('INSERT INTO order_ledger(event_key,entry_index,order_id,account,side,amount_u6,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)').bind(event.key,i,o.id,line.account,line.side,line.amount,now)),
        db.prepare("INSERT INTO order_outbox(id,effect_key,order_id,type,payload_json,created_at) VALUES(?1,?2,?3,'ORDER_PROJECTED',?4,?5)").bind(id(),`order:${o.id}:${event.sequence}`,o.id,JSON.stringify({orderId:o.id,eventKey:event.key,sequence:event.sequence,paymentState:n.payment_state,fundsState:n.funds_state,deliveryState:n.delivery_state}),now),
        releaseAssertion(db,op),
      ];
      try{await db.batch(batch);committed=true;applied++;break;}
      catch(error){if(isConflict(error)){if(retry===2)bad(409,'PROJECTION_BUSY');continue;}throw error;}
    }
    if(!committed)return applied;
  }
  return applied;
}
export async function ingestVerifiedReceipt(db:D1Database,d:Deployment,receipt:VerifiedReceipt):Promise<{events:number;applied:number}>{
  if(receipt.status!=='success')return {events:0,applied:0};
  const orderIds=new Set<string>();let count=0;
  for(const log of receipt.logs){
    let event:BusinessEvent|null;
    try{event=decodeBusiness(log,d,receipt.block.timestamp);}catch(error){await incident(db,d,`${CHAIN_ID}:${receipt.hash}:${log.logIndex}`,'INVALID_BUSINESS_EVENT');throw error;}
    if(!event)continue;count++;
    const json=JSON.stringify(event),fingerprint=await digest(json);
    try{
      await db.batch([
        db.prepare('INSERT INTO order_chain_events(event_key,deployment_id,chain_order_id,sequence,fingerprint,event_json,block_number,transaction_index,log_index,verified_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)').bind(event.key,d.id,event.orderId,event.sequence,fingerprint,json,event.blockNumber,event.transactionIndex,event.logIndex,Date.now()),
        db.prepare('INSERT INTO order_event_outcomes(event_key) VALUES(?1)').bind(event.key),
      ]);
    }catch(error){
      if(!isConflict(error))throw error;
      const saved=await db.prepare('SELECT fingerprint FROM order_chain_events WHERE event_key=?1').bind(event.key).first<{fingerprint:string}>();
      if(!saved||saved.fingerprint!==fingerprint){await incident(db,d,event.key,saved?'EVENT_CONFLICT':'SEQUENCE_CONFLICT');return bad(503,'EVENT_CONFLICT');}
    }
    const o=await db.prepare('SELECT id FROM orders WHERE deployment_id=?1 AND chain_order_id=?2').bind(d.id,event.orderId).first<{id:string}>();
    if(o)orderIds.add(o.id);
    else{
      await db.prepare("UPDATE order_event_outcomes SET reason='UNKNOWN_ORDER' WHERE event_key=?1 AND state='PENDING'").bind(event.key).run();
      await incident(db,d,event.key,'UNKNOWN_ORDER',false);
    }
  }
  let applied=0;for(const orderId of orderIds)applied+=await reconcileOrder(db,orderId,d);
  return {events:count,applied};
}
