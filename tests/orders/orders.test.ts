import { beforeAll, beforeEach, expect, test } from 'vitest';
import { keccak256, toHex, type Hex } from 'viem';
import { ApiError } from '../../workers/identity/security';
import { CHAIN_ID, UINT256_MAX, USDC, hash32, orderSummary, ordersConfiguration, parseUsdc, uint } from '../../workers/orders/domain';
import { ChainReader } from '../../workers/orders/chain-reader';
import { createIntent, freezeRule, order, registerLocalDeployment, submitAttempt, transactionPlan } from '../../workers/orders/store';
import { ingestVerifiedReceipt, reconcileOrder } from '../../workers/orders/projection';
import { refreshAttempt, replayRange, scanDeployment, syncTick } from '../../workers/orders/sync';
import { actor, addReceipt, bindings, call, context, count, join, json, newAddress, newHash, resetRpc, rpc, setup, type Context } from './helpers';

beforeAll(setup);
beforeEach(resetRpc);
async function ingest(c:Context,hash:Hex){
  const reader=new ChainReader(bindings);await reader.assertChain();
  const receipt=await reader.receipt(hash);expect(receipt).not.toBeNull();
  await reader.verifyDeployment(c.deployment,receipt!.block.number);
  return ingestVerifiedReceipt(bindings.DB,c.deployment,receipt!);
}
async function attempt(c:Context,hash:Hex,purpose:'approval'|'payment'|'business'='payment'){
  const a=await submitAttempt(bindings,c.buyer.identity,c.order.id,hash,purpose);
  return refreshAttempt(bindings,a.id);
}
async function snapshot(c:Context){return order(bindings.DB,c.order.id);}
const error=(code:string)=>expect.objectContaining({code});

test.each(['','-1','1e6','01','1.0',1,null,' 1','+1'])('MONEY-01 integer input rejects %j',value=>{expect(()=>uint(value)).toThrow();});
test.each(['0.0000001','1e-6','01.1','-0.1',0.1,'1.'])('MONEY-02 decimal input rejects %j',value=>{expect(()=>parseUsdc(value)).toThrow();});
test('MONEY-03 exact six-decimal conversion beyond floating-point safety',()=>{
  expect(parseUsdc('9007199254740993.000001')).toBe('9007199254740993000001');
  expect(parseUsdc('0.000001')).toBe('1');expect(parseUsdc('0')).toBe('0');
  expect(uint(UINT256_MAX.toString())).toBe(UINT256_MAX);
  expect(()=>uint((UINT256_MAX+1n).toString())).toThrow();
});
test('ORDER-01 participant creates an intent without a merchant workspace',async()=>{
  const c=await context();expect(await count('SELECT count(*) n FROM memberships WHERE user_id=?1',c.buyer.identity.userId)).toBe(0);
  const r=await call('/orders','POST',{ruleId:c.rule.id},c.buyer,{'Idempotency-Key':crypto.randomUUID()});
  expect(r.status).toBe(201);const result=(await json(r)).data;
  expect(result.order.payer).toBe(c.buyer.account.address.toLowerCase());expect(result.order.amount_u6).toBe('1000000');
  expect(result.order.payment_state).toBe('UNPAID');expect(result.intentSigned).toBe(false);expect(result.broadcastEnabled).toBe(false);
});
test('ORDER-02 concurrent same-key requests create exactly one order and audit',async()=>{
  const c=await context(),key=crypto.randomUUID();
  const results=await Promise.all([createIntent(bindings,c.buyer.identity,c.rule.id,key),createIntent(bindings,c.buyer.identity,c.rule.id,key)]);
  expect(results[0].order.id).toBe(results[1].order.id);
  expect(await count("SELECT count(*) n FROM audit_logs WHERE entity_id=?1 AND action='order.created'",results[0].order.id)).toBe(1);
});
test('ORDER-03 same key with changed request conflicts; different actors are isolated',async()=>{
  const c=await context(),other=await context(),key=crypto.randomUUID();
  const first=await createIntent(bindings,c.buyer.identity,c.rule.id,key);
  await expect(createIntent(bindings,c.buyer.identity,other.rule.id,key)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  const different=await createIntent(bindings,other.buyer.identity,c.rule.id,key);expect(different.order.id).not.toBe(first.order.id);
});
test('ORDER-04 API rejects client-supplied amount, payer, status and missing idempotency key',async()=>{
  const c=await context();
  for(const field of ['amountU6','payer','payment_state'])expect((await call('/orders','POST',{ruleId:c.rule.id,[field]:'spoof'},c.buyer,{'Idempotency-Key':crypto.randomUUID()})).status).toBe(422);
  expect((await call('/orders','POST',{ruleId:c.rule.id},c.buyer)).status).toBe(422);
});
test('RULE-01 freeze validates owner, version and immutable amount',async()=>{
  const c=await context(),editor=await actor();await join(c,editor,'editor');
  const body={draftId:c.draftId,deploymentId:c.deployment.id,amountU6:'1000000'};
  expect((await call(`/workspaces/${c.workspaceId}/order-rules`,'POST',body,editor,{'If-Match':'"1"'})).status).toBe(403);
  expect((await call(`/workspaces/${c.workspaceId}/order-rules`,'POST',body,c.owner,{'If-Match':'"2"'})).status).toBe(409);
  await expect(freezeRule(bindings,c.owner.identity,c.workspaceId,{draftId:c.draftId,draftVersion:1,deploymentId:c.deployment.id,amountU6:'2000000'})).rejects.toMatchObject({code:'RULE_ALREADY_FROZEN'});
});
test('RULE-02 subsequent draft edits do not alter old snapshots or existing orders',async()=>{
  const c=await context();const before=c.rule.canonical_json;
  expect((await call(`/workspaces/${c.workspaceId}/drafts/${c.draftId}`,'PATCH',{title:'New title'},c.owner,{'If-Match':'"1"'})).status).toBe(200);
  const newer=await freezeRule(bindings,c.owner.identity,c.workspaceId,{draftId:c.draftId,draftVersion:2,deploymentId:c.deployment.id,amountU6:'2000000'});
  expect(newer.rules_hash).not.toBe(c.rule.rules_hash);
  expect(await bindings.DB.prepare('SELECT canonical_json FROM order_rules WHERE id=?1').bind(c.rule.id).first('canonical_json')).toBe(before);
  expect((await snapshot(c)).amount_u6).toBe('1000000');
});
test('RULE-03 database blocks changing frozen rules and order identity fields',async()=>{
  const c=await context();
  await expect(bindings.DB.prepare('UPDATE order_rules SET amount_u6=?1 WHERE id=?2').bind('2',c.rule.id).run()).rejects.toThrow();
  await expect(bindings.DB.prepare('UPDATE orders SET payer=?1 WHERE id=?2').bind(newAddress(),c.order.id).run()).rejects.toThrow();
});
test('ACCESS-01 outsiders cannot read order detail or ledger and viewer cannot submit hints',async()=>{
  const c=await context(),outsider=await actor(),viewer=await actor();await join(c,viewer);
  expect((await call(`/orders/${c.order.id}`,'GET',undefined,outsider)).status).toBe(404);
  expect((await call(`/orders/${c.order.id}/ledger`,'GET',undefined,outsider)).status).toBe(404);
  expect((await call(`/orders/${c.order.id}`,'GET',undefined,viewer)).status).toBe(200);
  expect((await call(`/orders/${c.order.id}/transactions`,'POST',{txHash:newHash(),purpose:'payment'},viewer)).status).toBe(404);
});
test('ACCESS-02 removed member immediately loses order access',async()=>{
  const c=await context(),viewer=await actor();await join(c,viewer);
  expect((await call(`/workspaces/${c.workspaceId}/members/${encodeURIComponent(viewer.identity.userId)}`,'DELETE',{},c.owner)).status).toBe(200);
  expect((await call(`/orders/${c.order.id}`,'GET',undefined,viewer)).status).toBe(404);
});
test('ACCESS-03 my-orders contains only the authenticated payer, workspace list is scoped',async()=>{
  const c=await context(),other=await context();
  const own=(await json(await call('/me/orders','GET',undefined,c.buyer))).data.items;
  expect(own.every((o:any)=>o.payer===c.order.payer)).toBe(true);expect(own.some((o:any)=>o.id===c.order.id)).toBe(true);
  expect((await call(`/workspaces/${other.workspaceId}/orders`,'GET',undefined,c.owner)).status).toBe(404);
});
test('ACCESS-04 CSRF, cross-origin and arbitrary status setters are rejected',async()=>{
  const c=await context();
  expect((await call('/orders','POST',{ruleId:c.rule.id},c.buyer,{'Idempotency-Key':crypto.randomUUID(),'X-CSRF-Token':'bad'})).status).toBe(403);
  expect((await call('/orders','POST',{ruleId:c.rule.id},c.buyer,{Origin:'https://evil.test','Idempotency-Key':crypto.randomUUID()})).status).toBe(403);
  expect((await call(`/orders/${c.order.id}`,'PATCH',{payment_state:'CONFIRMED'},c.owner)).status).toBe(404);
  expect((await call('/orders/register-deployment','POST',{},c.owner)).status).not.toBe(200);
});
test('ACCESS-05 deployment whitelist cannot cross workspaces or ignore bytecode/chain',async()=>{
  const c=await context(),other=await context();
  await expect(freezeRule(bindings,c.owner.identity,c.workspaceId,{draftId:c.draftId,draftVersion:1,deploymentId:other.deployment.id,amountU6:'1'})).rejects.toMatchObject({code:'NOT_FOUND'});
  rpc.chainId='0x1';await expect(registerLocalDeployment(bindings,{workspaceId:c.workspaceId,address:newAddress(),codeHash:keccak256('0x60006000'),deploymentBlock:10})).rejects.toMatchObject({code:'RPC_CHAIN_MISMATCH'});
  rpc.chainId=toHex(CHAIN_ID);rpc.code='0x';await expect(registerLocalDeployment(bindings,{workspaceId:c.workspaceId,address:newAddress(),codeHash:keccak256('0x60006000'),deploymentBlock:10})).rejects.toMatchObject({code:'DEPLOYMENT_CODE_MISMATCH'});
});
test('PLAN-01 exact approval plan is not a signed payment or a broadcast',async()=>{
  const c=await context();const plan=await transactionPlan(bindings,c.buyer.identity,c.order.id,'approve');
  expect(plan.to).toBe(USDC);expect(plan.value).toBe('0');expect(plan.amountU6).toBe(c.order.amount_u6);expect(plan.broadcastEnabled).toBe(false);
  expect(plan.data.endsWith(BigInt(c.order.amount_u6).toString(16).padStart(64,'0'))).toBe(true);
  expect(rpc.calls.every(c=>!c.method.includes('send')&&!c.method.includes('sign'))).toBe(true);
});
test('PLAN-02 insufficient allowance requires approval; approved plan binds every intent field',async()=>{
  const c=await context();await expect(transactionPlan(bindings,c.buyer.identity,c.order.id,'pay')).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});
  rpc.allowance=BigInt(c.order.amount_u6);const plan=await transactionPlan(bindings,c.buyer.identity,c.order.id,'pay');
  expect(plan.to).toBe(c.deployment.address);expect(plan.data).toContain(c.order.chain_order_id.slice(2));expect(plan.data).toContain(c.rule.rules_hash.slice(2));expect(plan.data).toContain(c.order.nonce.slice(2));
  await expect(transactionPlan(bindings,c.buyer.identity,c.order.id,'approve')).rejects.toMatchObject({code:'APPROVAL_NOT_REQUIRED'});
});
test('PLAN-03 wrong payer, wrong chain, precision mismatch and exhausted gas fail closed',async()=>{
  const c=await context();await expect(transactionPlan(bindings,c.owner.identity,c.order.id,'approve')).rejects.toMatchObject({code:'PAYER_REQUIRED'});
  rpc.chainId='0x1';await expect(transactionPlan(bindings,c.buyer.identity,c.order.id,'approve')).rejects.toMatchObject({code:'RPC_CHAIN_MISMATCH'});
  rpc.chainId=toHex(CHAIN_ID);rpc.native=1n;await expect(transactionPlan(bindings,c.buyer.identity,c.order.id,'approve')).rejects.toMatchObject({code:'USDC_BALANCE_MISMATCH'});
  rpc.token=BigInt(c.order.amount_u6);rpc.native=rpc.token*10n**12n;rpc.allowance=rpc.token;
  await expect(transactionPlan(bindings,c.buyer.identity,c.order.id,'pay')).rejects.toMatchObject({code:'INSUFFICIENT_GAS'});
});
test('PLAN-04 expired intent cannot produce a new plan; idempotency does not renew it',async()=>{
  const c=await context(),key=crypto.randomUUID();const first=await createIntent(bindings,c.buyer.identity,c.rule.id,key);
  rpc.time=first.order.expires_at;
  await expect(transactionPlan(bindings,c.buyer.identity,first.order.id,'approve')).rejects.toMatchObject({code:'INTENT_EXPIRED'});
  const second=await createIntent(bindings,c.buyer.identity,c.rule.id,key);expect(second.order.nonce).toBe(first.order.nonce);expect(second.order.expires_at).toBe(first.order.expires_at);
});
test('HINT-01 hash submission only queues verification and is idempotent',async()=>{
  const c=await context(),txHash=newHash();
  const a=await submitAttempt(bindings,c.buyer.identity,c.order.id,txHash,'payment'),b=await submitAttempt(bindings,c.buyer.identity,c.order.id,txHash,'payment');
  expect(a.id).toBe(b.id);expect((await snapshot(c)).payment_state).toBe('UNPAID');
  expect(await count("SELECT count(*) n FROM order_outbox WHERE order_id=?1 AND type='VERIFY_RECEIPT'",c.order.id)).toBe(1);
});
test('HINT-02 unknown transaction stays pending and does not become a failed order',async()=>{
  const c=await context(),result=await attempt(c,newHash());
  expect(result.status).toBe('PENDING');expect(result.last_error).toBe('TRANSACTION_UNKNOWN');expect((await snapshot(c)).payment_state).toBe('UNPAID');
});
test('RECEIPT-01 mined revert records failed attempt without creating payment',async()=>{
  const c=await context(),result=await attempt(c,addReceipt(c,{reverted:true}));
  expect(result.status).toBe('REVERTED');expect((await snapshot(c)).funds_state).toBe('NONE');expect(await count('SELECT count(*) n FROM order_ledger WHERE order_id=?1',c.order.id)).toBe(0);
});
test('RECEIPT-02 confirmed approval is distinct from confirmed payment',async()=>{
  const c=await context(),result=await attempt(c,addReceipt(c,{approval:true}),'approval');
  expect(result.status).toBe('CONFIRMED');expect((await snapshot(c)).payment_state).toBe('UNPAID');
});
test('RECEIPT-03 ordinary Transfer and matching event from wrong emitter do not pay an order',async()=>{
  const c=await context(),h=addReceipt(c);rpc.receipts.get(h)!.logs[0].topics[0]=keccak256(toHex('Transfer(address,address,uint256)'));
  expect((await attempt(c,h)).status).toBe('REJECTED');
  const other=addReceipt(c,{emitter:newAddress()});expect((await attempt(c,other)).status).toBe('REJECTED');expect((await snapshot(c)).payment_state).toBe('UNPAID');
});
test('RECEIPT-04 wrong calldata or transaction payer cannot confirm an intent',async()=>{
  const c=await context(),h=addReceipt(c);rpc.transactions.get(h)!.from=newAddress();rpc.receipts.get(h)!.from=rpc.transactions.get(h)!.from;
  expect((await attempt(c,h)).status).toBe('REJECTED');
  const j=addReceipt(c);rpc.transactions.get(j)!.input='0x';expect((await attempt(c,j)).status).toBe('REJECTED');
});
test('RECEIPT-05 inconsistent receipt/block metadata remains retryable, never paid',async()=>{
  const c=await context(),h=addReceipt(c);rpc.receipts.get(h)!.blockHash=newHash();const result=await attempt(c,h);
  expect(result.status).toBe('PENDING');expect(result.last_error).toBe('RPC_RECEIPT_MISMATCH');expect((await snapshot(c)).payment_state).toBe('UNPAID');
});
test('RECEIPT-06 duplicate or removed logs are not accepted as canonical receipts',async()=>{
  const c=await context(),h=addReceipt(c);rpc.receipts.get(h)!.logs.push({...rpc.receipts.get(h)!.logs[0]});expect((await attempt(c,h)).status).toBe('PENDING');
  const j=addReceipt(c);rpc.receipts.get(j)!.logs[0].removed=true;expect((await attempt(c,j)).status).toBe('PENDING');
});
test('RECEIPT-07 real local HTTP route verifies a hint but never exposes a receipt write API',async()=>{
  const c=await context(),h=addReceipt(c);
  const create=await call(`/orders/${c.order.id}/transactions`,'POST',{txHash:h,purpose:'payment'},c.buyer);expect(create.status).toBe(202);const a=(await json(create)).data.attempt;
  expect((await snapshot(c)).payment_state).toBe('UNPAID');
  const refreshed=await call(`/orders/${c.order.id}/transactions/${a.id}/refresh`,'POST',{},c.buyer);expect(refreshed.status).toBe(200);expect((await json(refreshed)).data.status).toBe('CONFIRMED');
  expect((await snapshot(c)).payment_state).toBe('CONFIRMED');
});
test('PROJECTION-01 paid event creates balanced exact ledger and one durable outbox',async()=>{
  const c=await context();await ingest(c,addReceipt(c));
  const o=await snapshot(c);expect(o.funds_state).toBe('LOCKED');expect(o.applied_sequence).toBe(1);
  const rows=(await bindings.DB.prepare('SELECT side,amount_u6 FROM order_ledger WHERE order_id=?1').bind(o.id).all<{side:string;amount_u6:string}>()).results;
  expect(rows).toHaveLength(2);expect(rows.reduce((sum,r)=>sum+(r.side==='DEBIT'?1n:-1n)*BigInt(r.amount_u6),0n)).toBe(0n);
  expect(await count("SELECT count(*) n FROM order_outbox WHERE order_id=?1 AND type='ORDER_PROJECTED' AND state='PENDING'",o.id)).toBe(1);
});
test('PROJECTION-02 repeated and concurrent deliveries cannot duplicate ledger/outbox',async()=>{
  const c=await context(),h=addReceipt(c);await Promise.all([ingest(c,h),ingest(c,h)]);await ingest(c,h);
  expect((await snapshot(c)).version).toBe(2);expect(await count('SELECT count(*) n FROM order_ledger WHERE order_id=?1',c.order.id)).toBe(2);
  expect(await count("SELECT count(*) n FROM order_outbox WHERE order_id=?1 AND type='ORDER_PROJECTED'",c.order.id)).toBe(1);
});
test('PROJECTION-03 out-of-order delivery waits for predecessor and converges',async()=>{
  const c=await context(),later=addReceipt(c,{kind:2,sequence:2,block:12});await ingest(c,later);
  expect((await snapshot(c)).payment_state).toBe('UNPAID');expect((await snapshot(c)).applied_sequence).toBe(0);
  await ingest(c,addReceipt(c,{block:11}));expect((await snapshot(c)).applied_sequence).toBe(2);expect((await snapshot(c)).delivery_state).toBe('AVAILABLE');
});
test('PROJECTION-04 refund credit and actual withdrawal are separate, terminal settlement rejected',async()=>{
  const c=await context();await ingest(c,addReceipt(c));await ingest(c,addReceipt(c,{kind:3,sequence:2,block:12}));
  expect(orderSummary(await snapshot(c)).refundCreditU6).toBe(c.order.amount_u6);expect(orderSummary(await snapshot(c)).withdrawnU6).toBe('0');
  await ingest(c,addReceipt(c,{kind:5,sequence:3,block:13}));expect((await snapshot(c)).funds_state).toBe('REFUNDED');
  await ingest(c,addReceipt(c,{kind:4,sequence:4,block:14}));expect((await snapshot(c)).funds_state).toBe('REFUNDED');
  expect(await bindings.DB.prepare('SELECT status FROM order_deployments WHERE id=?1').bind(c.deployment.id).first('status')).toBe('HALTED');
});
test('PROJECTION-05 settlement credit cannot be reported as already received',async()=>{
  const c=await context();await ingest(c,addReceipt(c));await ingest(c,addReceipt(c,{kind:4,sequence:2,block:12}));
  expect(orderSummary(await snapshot(c)).settlementCreditU6).toBe(c.order.amount_u6);expect(orderSummary(await snapshot(c)).withdrawnU6).toBe('0');
  await ingest(c,addReceipt(c,{kind:6,sequence:3,block:13}));expect(orderSummary(await snapshot(c)).withdrawnU6).toBe(c.order.amount_u6);expect(orderSummary(await snapshot(c)).settlementCreditU6).toBe('0');
});
test.each(['amount','payer','nonce','rulesHash','recipient'])('PROJECTION-06 mismatched %s is quarantined, not applied',async field=>{
  const c=await context();const options:any={};options[field]=field==='amount'?'999':field==='payer'||field==='recipient'?newAddress():newHash();
  await ingest(c,addReceipt(c,options));expect((await snapshot(c)).payment_state).toBe('UNPAID');
  expect(await count("SELECT count(*) n FROM order_chain_events e JOIN order_event_outcomes s ON s.event_key=e.event_key WHERE e.deployment_id=?1 AND s.state='QUARANTINED'",c.deployment.id)).toBe(1);
});
test('PROJECTION-07 expired-at-inclusion payment and noncanonical ABI fail closed',async()=>{
  const c=await context();rpc.time=c.order.expires_at-11;await ingest(c,addReceipt(c));expect((await snapshot(c)).payment_state).toBe('UNPAID');
  const other=await context(),h=addReceipt(other);rpc.receipts.get(h)!.logs[0].data+='00';await expect(ingest(other,h)).rejects.toMatchObject({code:'NON_CANONICAL_EVENT'});
});
test('PROJECTION-08 unknown order is durably retained, never assigned to an equal-amount order',async()=>{
  const c=await context();await ingest(c,addReceipt(c,{orderId:newHash()}));expect((await snapshot(c)).payment_state).toBe('UNPAID');
  expect(await count("SELECT count(*) n FROM order_sync_incidents WHERE deployment_id=?1 AND code='UNKNOWN_ORDER'",c.deployment.id)).toBe(1);
});
test('PROJECTION-09 conflicting duplicate event cannot overwrite prior evidence',async()=>{
  const c=await context(),h=addReceipt(c);await ingest(c,h);const before=await bindings.DB.prepare('SELECT fingerprint FROM order_chain_events WHERE deployment_id=?1').bind(c.deployment.id).first('fingerprint');
  addReceipt(c,{txHash:h,amount:'999'});await expect(ingest(c,h)).rejects.toMatchObject({code:'EVENT_CONFLICT'});
  expect(await bindings.DB.prepare('SELECT fingerprint FROM order_chain_events WHERE deployment_id=?1').bind(c.deployment.id).first('fingerprint')).toBe(before);
});
test('PROJECTION-10 late outbox failure rolls back order, ledger and applied marker; replay recovers',async()=>{
  const c=await context(),h=addReceipt(c);
  await bindings.DB.prepare(`CREATE TRIGGER test_order_outbox_fault BEFORE INSERT ON order_outbox WHEN NEW.type='ORDER_PROJECTED' BEGIN SELECT RAISE(ABORT,'INJECTED_OUTBOX_FAILURE'); END`).run();
  try{await expect(ingest(c,h)).rejects.toThrow();}finally{await bindings.DB.prepare('DROP TRIGGER test_order_outbox_fault').run();}
  expect((await snapshot(c)).payment_state).toBe('UNPAID');expect(await count('SELECT count(*) n FROM order_ledger WHERE order_id=?1',c.order.id)).toBe(0);
  expect(await count("SELECT count(*) n FROM order_chain_events e JOIN order_event_outcomes s ON s.event_key=e.event_key WHERE e.deployment_id=?1 AND s.state='PENDING'",c.deployment.id)).toBe(1);
  await ingest(c,h);expect((await snapshot(c)).payment_state).toBe('CONFIRMED');
});
test('PROJECTION-11 raw event, ledger and outbox payload cannot be silently rewritten',async()=>{
  const c=await context();await ingest(c,addReceipt(c));
  await expect(bindings.DB.prepare('UPDATE order_chain_events SET fingerprint=?1 WHERE deployment_id=?2').bind('bad',c.deployment.id).run()).rejects.toThrow();
  await expect(bindings.DB.prepare('DELETE FROM order_ledger WHERE order_id=?1').bind(c.order.id).run()).rejects.toThrow();
  await expect(bindings.DB.prepare("UPDATE order_outbox SET payload_json='{}' WHERE order_id=?1").bind(c.order.id).run()).rejects.toThrow();
});
test('PROJECTION-12 same-block event order uses transaction/log positions, not timestamps',async()=>{
  const c=await context();await ingest(c,addReceipt(c,{block:11,txIndex:0,logIndex:0}));
  await ingest(c,addReceipt(c,{kind:2,sequence:2,block:11,txIndex:1,logIndex:1}));expect((await snapshot(c)).applied_sequence).toBe(2);
  await ingest(c,addReceipt(c,{kind:3,sequence:3,block:11,txIndex:0,logIndex:2}));expect((await snapshot(c)).applied_sequence).toBe(2);
});
test('SCAN-01 backfill starts at deployment block and advances only after persistence',async()=>{
  const c=await context();addReceipt(c);const result=await scanDeployment(bindings,c.deployment.id);
  expect(result.status).toBe('SCANNED');expect(result.fromBlock).toBe(10);expect(result.toBlock).toBe(rpc.latest);expect((await snapshot(c)).payment_state).toBe('CONFIRMED');
  expect((await scanDeployment(bindings,c.deployment.id)).status).toBe('CURRENT');
});
test('SCAN-02 empty ranges advance; bounded replay never moves the forward cursor',async()=>{
  const c=await context();await scanDeployment(bindings,c.deployment.id);
  addReceipt(c);await replayRange(bindings,c.deployment.id,10,20);expect((await snapshot(c)).payment_state).toBe('CONFIRMED');
  expect(await bindings.DB.prepare('SELECT last_complete_block FROM order_sync_cursors WHERE deployment_id=?1').bind(c.deployment.id).first('last_complete_block')).toBe(30);
});
test('SCAN-03 RPC range rejection shrinks range without losing the first payment',async()=>{
  const c=await context();rpc.latest=500;rpc.rangeLimit=4;addReceipt(c);
  const result=await scanDeployment(bindings,c.deployment.id);expect(Number(result.toBlock)-Number(result.fromBlock)+1).toBeLessThanOrEqual(4);expect((await snapshot(c)).payment_state).toBe('CONFIRMED');
});
test('SCAN-04 failure leaves cursor unchanged and releases lease for retry',async()=>{
  const c=await context();addReceipt(c);rpc.failMethod='eth_getTransactionReceipt';
  await expect(scanDeployment(bindings,c.deployment.id)).rejects.toThrow();
  const cursor=await bindings.DB.prepare('SELECT * FROM order_sync_cursors WHERE deployment_id=?1').bind(c.deployment.id).first<any>();expect(cursor.last_complete_block).toBe(9);expect(cursor.lease_token).toBeNull();
  rpc.failMethod='';await scanDeployment(bindings,c.deployment.id);expect((await snapshot(c)).payment_state).toBe('CONFIRMED');
});
test('SCAN-05 active lease excludes a second scanner',async()=>{
  const c=await context();await bindings.DB.prepare('UPDATE order_sync_cursors SET lease_token=?1,lease_until=?2 WHERE deployment_id=?3').bind('other',Date.now()+60000,c.deployment.id).run();
  expect((await scanDeployment(bindings,c.deployment.id)).status).toBe('BUSY');expect(rpc.calls.filter(c=>c.method==='eth_getLogs')).toHaveLength(0);
});
test('SCAN-06 changed anchor halts source without reverting historic ledger',async()=>{
  const c=await context();addReceipt(c);await scanDeployment(bindings,c.deployment.id);rpc.blockHashes.set(30,newHash());
  await expect(scanDeployment(bindings,c.deployment.id)).rejects.toMatchObject({code:'CURSOR_ANCHOR_MISMATCH'});
  expect((await snapshot(c)).payment_state).toBe('CONFIRMED');expect(await bindings.DB.prepare('SELECT status FROM order_deployments WHERE id=?1').bind(c.deployment.id).first('status')).toBe('HALTED');
});
test('SCAN-07 incomplete getLogs response conflicts with its receipt and cannot advance',async()=>{
  const c=await context(),h=addReceipt(c);const original=rpc.receipts.get(h)!.logs[0];rpc.receipts.get(h)!.logs.push({...original,logIndex:'0x1'});
  rpc.transform=(method,result)=>method==='eth_getLogs'?(result as any[]).slice(0,1):result;
  await expect(scanDeployment(bindings,c.deployment.id)).rejects.toMatchObject({code:'RPC_LOG_RECEIPT_MISMATCH'});
  expect(await bindings.DB.prepare('SELECT last_complete_block FROM order_sync_cursors WHERE deployment_id=?1').bind(c.deployment.id).first('last_complete_block')).toBe(9);
});
test('SCAN-08 backward replay has strict bounds and cannot scan arbitrary addresses',async()=>{
  const c=await context();await expect(replayRange(bindings,c.deployment.id,0,20)).rejects.toMatchObject({code:'INVALID_REPLAY_RANGE'});
  await expect(replayRange(bindings,c.deployment.id,10,1000)).rejects.toMatchObject({code:'INVALID_REPLAY_RANGE'});
  await expect(replayRange(bindings,crypto.randomUUID(),10,20)).rejects.toMatchObject({code:'NOT_FOUND'});
});
test('BOUNDARY-01 absent flags and hosted/mainnet configurations cannot enable probe ordering',async()=>{
  expect(()=>ordersConfiguration({...bindings,ORDERS_ENABLED:'false'})).toThrow();
  expect(()=>ordersConfiguration({...bindings,APP_ENV:'testnet'})).toThrow();
  expect(()=>ordersConfiguration({...bindings,CHAIN_ID:'5042'})).toThrow();
  expect(()=>new ChainReader({...bindings,ORDER_RPC_URL:'https://evil.test'})).toThrow();
  expect(await syncTick({...bindings,ORDER_SYNC_ENABLED:'false'})).toEqual({status:'DISABLED'});
});
