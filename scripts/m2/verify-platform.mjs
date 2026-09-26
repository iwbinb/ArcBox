import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
mkdirSync('reports',{recursive:true});rmSync('reports/platform-tests.json',{force:true});
const report={stage:'M2-C',scope:'LOCAL_WORKER_D1_R2_AND_QUEUE_BROKER',sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),prHeadSha:process.env.ARCBOX_PR_HEAD_SHA||null,runId:process.env.GITHUB_RUN_ID||null,lockSha256:createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex'),startedAt:new Date().toISOString(),status:'RUNNING',steps:[],hostedPlatformDeployed:false,publicChainWrites:false};
try{
  for(const [name,args] of [['platform-types',['exec','tsc','-p','tsconfig.platform.json']],['platform-runtime',['test:platform']]]){
    console.log('--- M2-C '+name+' ---');const result=spawnSync('pnpm',args,{stdio:'inherit',timeout:180000,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    report.steps.push({name,exitCode:result.status,signal:result.signal,status:result.status===0?'PASS':'FAIL'});if(result.status!==0)throw new Error(name+' failed');
  }
  const tests=JSON.parse(readFileSync('reports/platform-tests.json','utf8'));
  report.tests={total:tests.numTotalTests,passed:tests.numPassedTests,failed:tests.numFailedTests,pending:tests.numPendingTests};
  report.cases=tests.testResults.flatMap(f=>f.assertionResults.map(t=>({name:t.fullName,status:t.status})));
  if(!tests.success||tests.numTotalTests<40||tests.numFailedTests||tests.numPendingTests||report.cases.some(t=>t.status!=='passed'))throw new Error('Incomplete platform tests');
  for(const prefix of ['FILE-','RULE-','ACCESS-','QUEUE-05 real broker','RECOVERY-'])if(!report.cases.some(t=>t.name.startsWith(prefix)))throw new Error('Missing mandatory coverage');
  report.status='PASS_LOCAL';
}catch(error){report.status='FAIL';report.failure=String(error.message);process.exitCode=1;}
finally{report.notVerified=['Hosted D1/R2/Queues/Cron, capacity and recovery in Cloudflare (M2-D)','Real wallet extension and production Deliver contract/file proof (M2-D/M4)','Arbitrary file uploads, malware scanner, external email/webhooks, independent audit'];report.completedAt=new Date().toISOString();writeFileSync('reports/m2-c.json',JSON.stringify(report,null,2)+'\n');console.log('M2_C_REPORT '+JSON.stringify(report));}
