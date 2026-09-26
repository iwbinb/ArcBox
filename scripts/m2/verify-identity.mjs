import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('reports',{recursive:true});
const report={stage:'M2-A',scope:'LOCAL_WORKER_AND_BROWSER',sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),prHeadSha:process.env.ARCBOX_PR_HEAD_SHA||null,runId:process.env.GITHUB_RUN_ID||null,startedAt:new Date().toISOString(),steps:[],status:'RUNNING',hostedIdentityDeployed:false,publicChainWrites:false};
for(const [name,args] of [
  ['identity-types',['exec','tsc','-p','tsconfig.identity.json']],
  ['identity-api',['test:identity']],
  ['identity-build',['build:identity']],
  ['identity-worker-dry-run',['exec','wrangler','deploy','--config','wrangler.identity.jsonc','--dry-run','--outdir','dist/identity-worker']],
  ['identity-browser',['test:identity:browser']],
]){
  console.log(`--- M2-A ${name} ---`);
  const result=spawnSync('pnpm',args,{stdio:'inherit',timeout:150000,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  report.steps.push({name,exitCode:result.status,signal:result.signal,status:result.status===0?'PASS':'FAIL'});
  if(result.status!==0){report.status='FAIL';break;}
}
if(report.status==='RUNNING'){
  const test=JSON.parse(readFileSync('reports/identity-tests.json','utf8'));
  report.tests={total:test.numTotalTests,passed:test.numPassedTests,failed:test.numFailedTests,pending:test.numPendingTests};
  report.browser=JSON.parse(readFileSync('reports/identity-browser.json','utf8'));
  report.status=test.numFailedTests===0&&test.numPendingTests===0&&test.numTotalTests>0&&report.browser.status==='PASS'?'PASS_LOCAL':'FAIL';
}
report.completedAt=new Date().toISOString();
report.notVerified=['Hosted D1 migrations and identity deployment (M2-D/D1)','Real browser extension and deployed ERC-1271 wallet end-to-end (M2-D)','Orders, files, payments and six-tool business logic','Production security audit'];
writeFileSync('reports/m2-a.json',JSON.stringify(report,null,2));
console.log('M2_A_REPORT '+JSON.stringify(report));
if(report.status!=='PASS_LOCAL')process.exitCode=1;
