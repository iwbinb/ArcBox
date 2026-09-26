import { expect, test, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { toHex } from 'viem';
import type { Identity } from '../../workers/identity/auth';
import { CHAIN_ID, type OrderEnv } from '../../workers/orders/domain';
import { freezeRule, order, registerLocalDeployment, submitAttempt } from '../../workers/orders/store';
import { ChainReader } from '../../workers/orders/chain-reader';
import { ingestVerifiedReceipt } from '../../workers/orders/projection';
import { refreshAttempt, scanDeployment } from '../../workers/orders/sync';
import { context, call, json, newHash, addReceipt } from './helpers';

type Raw=Record<string,any>;
export function registerLocalEvmReplay():void{
  test('API-CONTRACT strict amount and purpose types are rejected before database writes',async()=>{
    const c=await context();
    for(const amountU6 of [' 1000000','1000000 ',1000000]){
      const result=await call(`/workspaces/${c.workspaceId}/order-rules`,'POST',{draftId:c.draftId,deploymentId:c.deployment.id,amountU6},c.owner,{'If-Match':'"1"'});
      expect(result.status).toBe(422);
    }
    expect((await call(`/orders/${c.order.id}/transactions`,'POST',{txHash:newHash(),purpose:['payment']},c.buyer)).status).toBe(422);
  });
  test('API-CONTRACT repeated confirmed hint does not report payment=false',async()=>{
    const c=await context(),txHash=addReceipt(c),path=`/orders/${c.order.id}/transactions`;
    const initial=await call(path,'POST',{txHash,purpose:'payment'},c.buyer);expect(initial.status).toBe(202);
    const attempt=(await json(initial)).data.attempt;
    expect((await call(`${path}/${attempt.id}/refresh`,'POST',{},c.buyer)).status).toBe(200);
    const repeated=await json(await call(path,'POST',{txHash,purpose:'payment'},c.buyer));
    expect(repeated.data.attempt.status).toBe('CONFIRMED');
    expect(repeated.data.confirmationNotInferredFromSubmission).toBe(true);
    expect(repeated.data.paymentConfirmed).toBeUndefined();
  });
  test('EVM-REPLAY actual loopback Arc approve/pay/refund/settlement receipts produce one exact projection',async()=>{
    const capture=JSON.parse((env as unknown as {ORDER_EVM_CAPTURE:string}).ORDER_EVM_CAPTURE) as Raw;
    expect(capture.scope).toBe('REAL_LOCAL_ARC_RECEIPTS_NOT_PUBLIC_TESTNET');expect(capture.status).toBe('PASS');expect(capture.chainId).toBe(CHAIN_ID);expect(capture.publicChainWrites).toBe(false);
    const bindings=env as unknown as OrderEnv,m=capture.metadata;
    // Transport responses are captured from the actual loopback chain. The real
    // parser, cross-checks, projection and D1 transactions execute during replay.
    vi.stubGlobal('fetch',async(input:unknown,options?:{body?:unknown})=>{
      const target=input instanceof Request?input.url:String(input);
      if(target.replace(/\/$/,'')!=='https://rpc.testnet.arc.io')throw new Error('Unexpected replay target');
      const query=input instanceof Request?await input.json() as Raw:JSON.parse(String(options?.body)) as Raw;
      const p=query.params??[];let result:unknown;
      switch(query.method){
        case 'eth_chainId':result=toHex(CHAIN_ID);break;
        case 'eth_getCode':result=m.runtimeCode;break;
        case 'eth_getBlockByNumber':result=capture.blocks[p[0]==='latest'?capture.latest:Number(BigInt(p[0]))];break;
        case 'eth_getTransactionByHash':result=capture.transactions[p[0]]??null;break;
        case 'eth_getTransactionReceipt':result=capture.receipts[p[0]]??null;break;
        case 'eth_getLogs':{
          const f=p[0],from=BigInt(f.fromBlock),to=BigInt(f.toBlock);
          result=Object.values(capture.receipts as Record<string,Raw>).flatMap(r=>r.logs).filter(l=>l.address.toLowerCase()===String(f.address).toLowerCase()&&BigInt(l.blockNumber)>=from&&BigInt(l.blockNumber)<=to);break;
        }
        default:throw new Error('Unexpected replay RPC method');
      }
      if(result===undefined)throw new Error('Missing captured chain data');
      return Response.json({jsonrpc:'2.0',id:query.id,result});
    });
    const ownerId=`${CHAIN_ID}:${m.owner}`,buyerId=`${CHAIN_ID}:${m.payer}`;
    const owner:Identity={userId:ownerId,address:m.owner,expiresAt:Date.now()+60000,token:'',tokenHash:'',csrf:''};
    const buyer:Identity={...owner,userId:buyerId,address:m.payer};
    await bindings.DB.batch([
      bindings.DB.prepare('INSERT INTO users(id,address,chain_id,created_at) VALUES(?1,?2,?3,?4)').bind(ownerId,m.owner,CHAIN_ID,m.createdAt),
      bindings.DB.prepare('INSERT INTO users(id,address,chain_id,created_at) VALUES(?1,?2,?3,?4)').bind(buyerId,m.payer,CHAIN_ID,m.createdAt),
      bindings.DB.prepare('INSERT INTO workspaces(id,name,owner_id,created_at,updated_at,updated_by) VALUES(?1,?2,?3,?4,?4,?3)').bind(m.workspaceId,'Recorded local EVM flow',ownerId,m.createdAt),
      bindings.DB.prepare("INSERT INTO drafts(id,workspace_id,tool_type,title,description,created_at,updated_at,updated_by) VALUES(?1,?2,'deliver',?3,?4,?5,?5,?6)").bind(m.draftId,m.workspaceId,'Local EVM replay fixture','Receipt replay only; not a production business contract.',m.createdAt,ownerId),
    ]);
    const d=await registerLocalDeployment(bindings,{workspaceId:m.workspaceId,address:m.contract,codeHash:m.codeHash,deploymentBlock:m.deploymentBlock});
    const r=await freezeRule(bindings,owner,m.workspaceId,{draftId:m.draftId,draftVersion:1,deploymentId:d.id,amountU6:m.amountU6});
    expect(r.canonical_json).toBe(m.canonical);expect(r.rules_hash).toBe(m.rulesHash);
    for(const c of capture.cases){
      await bindings.DB.prepare('INSERT INTO orders(id,workspace_id,rule_id,deployment_id,chain_order_id,payer,amount_u6,nonce,expires_at,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)').bind(c.orderId,m.workspaceId,r.id,d.id,c.chainOrderId,m.payer,m.amountU6,c.nonce,c.expiresAt,c.createdAt).run();
      const a=await submitAttempt(bindings,buyer,c.orderId,c.hashes[0],'payment');expect((await refreshAttempt(bindings,a.id)).status).toBe('CONFIRMED');
      const reader=new ChainReader(bindings);
      for(const hash of [...c.hashes.slice(1)].reverse()){
        const receipt=await reader.receipt(hash);expect(receipt).not.toBeNull();await reader.verifyDeployment(d,receipt!.block.number);await ingestVerifiedReceipt(bindings.DB,d,receipt!);
      }
      const final=await order(bindings.DB,c.orderId);expect(final.funds_state).toBe(c.expectedFundsState);expect(final.applied_sequence).toBe(4);
      expect(await bindings.DB.prepare('SELECT count(*) n FROM order_ledger WHERE order_id=?1').bind(c.orderId).first('n')).toBe(6);
      expect(await bindings.DB.prepare("SELECT count(*) n FROM order_outbox WHERE order_id=?1 AND type='ORDER_PROJECTED'").bind(c.orderId).first('n')).toBe(4);
    }
    await scanDeployment(bindings,d.id);
    for(const c of capture.cases)expect((await order(bindings.DB,c.orderId)).version).toBe(5);
    expect(capture.probeBalanceU6).toBe('0');expect(capture.allowanceU6).toBe('0');
    expect(await bindings.DB.prepare('SELECT count(*) n FROM order_chain_events WHERE deployment_id=?1').bind(d.id).first('n')).toBe(8);
  });
}
