import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

mkdirSync('reports',{recursive:true});
for(const file of ['orders-tests.json','order-evm-summary.json','order-evm-capture.json'])rmSync(`reports/${file}`,{force:true});
const sha256=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const report={
  schemaVersion:1,stage:'M2-B',scope:'LOCAL_WORKER_D1_FIXTURES_AND_REAL_LOCAL_ARC_RECEIPT_REPLAY',
  sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  prHeadSha:process.env.ARCBOX_PR_HEAD_SHA||null,runId:process.env.GITHUB_RUN_ID||null,
  lockSha256:sha256('pnpm-lock.yaml'),startedAt:new Date().toISOString(),status:'RUNNING',steps:[],
  hostedOrdersDeployed:false,publicChainWrites:false,
};
try{
  for(const [name,args] of [
    ['order-types',['exec','tsc','-p','tsconfig.orders.json']],
    ['order-runtime',['test:orders']],
  ]){
    console.log(`--- M2-B ${name} ---`);
    const result=spawnSync('pnpm',args,{stdio:'inherit',timeout:180000,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    report.steps.push({name,status:result.status===0?'PASS':'FAIL',exitCode:result.status,signal:result.signal});
    if(result.status!==0)throw new Error(`${name} did not pass`);
  }
  const result=JSON.parse(readFileSync('reports/orders-tests.json','utf8'));
  report.tests={total:result.numTotalTests,passed:result.numPassedTests,failed:result.numFailedTests,pending:result.numPendingTests};
  report.cases=result.testResults.flatMap(file=>file.assertionResults.map(test=>({name:test.fullName,status:test.status})));
  if(!result.success||result.numTotalTests<1||result.numFailedTests||result.numPendingTests||report.cases.some(test=>test.status!=='passed'))throw new Error('Order test report is incomplete');
  assert.ok(report.cases.some(test=>test.name.startsWith('EVM-REPLAY ')&&test.status==='passed'),'Actual local receipt replay must execute, not only compile or capture.');
  const evm=JSON.parse(readFileSync('reports/order-evm-summary.json','utf8'));
  assert.equal(evm.sourceSha,report.sourceSha);
  assert.equal(evm.scope,'REAL_LOCAL_ARC_RECEIPTS_NOT_PUBLIC_TESTNET');
  assert.equal(evm.status,'PASS');assert.equal(evm.publicChainWrites,false);
  assert.equal(evm.flows,2);assert.equal(evm.businessEvents,8);assert.equal(evm.localTransactions,11);
  assert.equal(evm.probeBalanceU6,'0');assert.equal(evm.allowanceU6,'0');
  assert.equal(evm.captureSha256,sha256('reports/order-evm-capture.json'));
  report.localEvm=evm;report.status='PASS_LOCAL';
}catch(error){
  report.status='FAIL';report.failure=error instanceof Error?error.message:'Verification failed';process.exitCode=1;
}finally{
  report.notVerified=[
    'Hosted D1/Jobs/Cron/Queues deployment and live RPC indexing (M2-D)',
    'Production tool ABIs, quote signatures, contract rules and payment flows (M3 onward)',
    'Queue dispatch and external notification delivery (M2-C)',
    'Mainnet payments, real browser wallet order UI, independent security audit',
  ];
  report.completedAt=new Date().toISOString();
  writeFileSync('reports/m2-b.json',JSON.stringify(report,null,2)+'\n');
  console.log('M2_B_REPORT '+JSON.stringify(report));
}
