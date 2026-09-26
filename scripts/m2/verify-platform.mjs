import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
mkdirSync('reports',{recursive:true});for(const name of ['platform-tests','platform-browser'])rmSync(`reports/${name}.json`,{force:true});
const report={stage:'M2-C',scope:'LOCAL_WORKER_D1_R2_QUEUE_BROKER_AND_BROWSER',sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),prHeadSha:process.env.ARCBOX_PR_HEAD_SHA||null,runId:process.env.GITHUB_RUN_ID||null,lockSha256:createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex'),startedAt:new Date().toISOString(),status:'RUNNING',steps:[],hostedPlatformDeployed:false,publicChainWrites:false};
try{
  for(const [name,command,args] of [
    ['platform-types','pnpm',['exec','tsc','-p','tsconfig.platform.json']],
    ['platform-runtime','pnpm',['test:platform']],
    ['platform-ui-build','pnpm',['build:identity']],
    ['platform-worker-build','pnpm',['exec','wrangler','deploy','--config','wrangler.platform.jsonc','--dry-run','--outdir','dist/platform']],
    ['platform-browser','node',['scripts/m2/browser-platform.mjs']],
  ]){
    console.log('--- M2-C '+name+' ---');const result=spawnSync(command,args,{stdio:'inherit',timeout:180000,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    report.steps.push({name,exitCode:result.status,signal:result.signal,status:result.status===0?'PASS':'FAIL'});if(result.status!==0)throw new Error(name+' failed');
  }
  const tests=JSON.parse(readFileSync('reports/platform-tests.json','utf8'));
  report.tests={total:tests.numTotalTests,passed:tests.numPassedTests,failed:tests.numFailedTests,pending:tests.numPendingTests};
  report.cases=tests.testResults.flatMap(f=>f.assertionResults.map(t=>({name:t.fullName,status:t.status})));
  if(!tests.success||tests.numTotalTests<58||tests.numFailedTests||tests.numPendingTests||report.cases.some(t=>t.status!=='passed'))throw new Error('Incomplete platform tests');
  for(const prefix of ['FILE-','RULE-','ACCESS-','QUEUE-05 real broker','RECOVERY-','RACE-','EXPIRY-','RECOVERY-CONTRACT','PAGINATION-','RECOVERY-CRASH','SOURCE-'])if(!report.cases.some(t=>t.name.startsWith(prefix)))throw new Error('Missing mandatory coverage');
  report.browser=JSON.parse(readFileSync('reports/platform-browser.json','utf8'));
  if(report.browser.sourceSha!==report.sourceSha||report.browser.status!=='PASS'||report.browser.publicChainWrites!==false||report.browser.checks.length!==11||report.browser.checks.some(c=>c.status!=='PASS')||report.browser.consoleErrors.length||report.browser.screenshots.length<8)throw new Error('Incomplete browser evidence');
  for(const prefix of ['UI-08 delayed audit','UI-08b stale audit','UI-09 viewer','UI-10 language'])if(!report.browser.checks.some(c=>c.name.startsWith(prefix)))throw new Error('Missing browser race or isolation coverage');
  if(!Number.isSafeInteger(report.browser.auditRowsVerified)||report.browser.auditRowsVerified<=25)throw new Error('Audit pagination was not verified');
  for(const image of report.browser.screenshots)if(createHash('sha256').update(readFileSync(image.file)).digest('hex')!==image.sha256)throw new Error('Screenshot digest mismatch');
  report.status='PASS_LOCAL';
}catch(error){report.status='FAIL';report.failure=String(error.message);process.exitCode=1;}
finally{report.notVerified=['Hosted D1/R2/Queues/Cron, capacity and recovery in Cloudflare (M2-D)','Real wallet extension and production Deliver contract/file proof (M2-D/M4)','Arbitrary file uploads, malware scanner, external email/webhooks, independent audit'];report.completedAt=new Date().toISOString();writeFileSync('reports/m2-c.json',JSON.stringify(report,null,2)+'\n');console.log('M2_C_REPORT '+JSON.stringify(report));}
