import assert from 'node:assert/strict';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {keccak256,toHex} from 'viem';

mkdirSync('reports',{recursive:true});
const report={stage:'M2-C',status:'RUNNING',scope:'LOCAL_WORKER_D1_R2_QUEUE_AND_CHROME',sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checks:[],screenshots:[],consoleErrors:[],publicChainWrites:false,orderFixture:'Seeded local paid-order projection for browser download UI only; chain-to-entitlement validation is covered separately by platform runtime tests.'};
const temp=mkdtempSync(join(tmpdir(),'arcbox-platform-browser-')),state=join(temp,'state'),origin='http://127.0.0.1:8790';
let browser,server,logs='',selected=0,rejectSignature=false;
const signers=[privateKeyToAccount(generatePrivateKey()),privateKeyToAccount(generatePrivateKey())],methods=[];
const sha=s=>createHash('sha256').update(s).digest('hex');
function command(args){const p=spawnSync('pnpm',args,{encoding:'utf8',timeout:90000,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});if(p.status!==0)throw new Error('LOCAL_COMMAND_FAILED '+p.stderr.slice(-1000));return p.stdout;}
function sql(text){const path=join(temp,'fixture.sql');writeFileSync(path,text);return command(['exec','wrangler','d1','execute','arcbox-platform-local','--local','--config','wrangler.platform.jsonc','--persist-to',state,'--file',path,'--json']);}
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
async function waitUntil(fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error('BROWSER_WAIT_TIMEOUT');}
async function step(name,fn){await fn();report.checks.push({name,status:'PASS'});console.log('M2C_BROWSER_CHECK '+name);}
async function screenshot(page,name,width){await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');const path=`reports/m2-c-${name}-${width}.png`;await page.screenshot({path,fullPage:true});report.screenshots.push({file:path,width,sha256:sha(readFileSync(path))});}
async function api(page,path,method='GET',data){return page.evaluate(async({path,method,data})=>{const s=(await(await fetch('/api/v1/session')).json()).data;const r=await fetch('/api/v1'+path,{method,headers:{'Content-Type':'application/json',...(method!=='GET'?{'X-CSRF-Token':s.csrfToken}:{})},...(method!=='GET'?{body:JSON.stringify(data??{})}:{})});const v=await r.json();if(!r.ok)throw new Error('API_'+r.status+'_'+v.error?.code);return v.data;},{path,method,data});}
try{
  const installed=spawnSync('npm',['ci','--prefix','tests/identity/browser','--ignore-scripts','--no-audit','--no-fund'],{encoding:'utf8',timeout:90000});if(installed.status!==0)throw new Error('PINNED_BROWSER_INSTALL_FAILED');
  const {chromium}=await import(pathToFileURL(resolve('tests/identity/browser/node_modules/playwright-core/index.mjs')).href);
  assert.equal(JSON.parse(readFileSync('tests/identity/browser/node_modules/playwright-core/package.json')).version,'1.55.1');
  command(['exec','wrangler','d1','migrations','apply','arcbox-platform-local','--local','--config','wrangler.platform.jsonc','--persist-to',state]);
  server=spawn('pnpm',['exec','wrangler','dev','--config','wrangler.platform.jsonc','--ip','127.0.0.1','--port','8790','--persist-to',state],{detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  server.stdout.on('data',v=>{logs=(logs+v).slice(-5000);});server.stderr.on('data',v=>{logs=(logs+v).slice(-5000);});
  await waitUntil(async()=>{try{return(await fetch(origin+'/api/health')).ok;}catch{return false;}},30000);
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-dev-shm-usage']});report.browserVersion=browser.version();
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror',e=>report.consoleErrors.push(e.message));
  await page.exposeBinding('__platformRequest',async(_source,{method,params=[]})=>{
    methods.push(method);if(method==='eth_accounts'||method==='eth_requestAccounts')return [signers[selected].address];if(method==='eth_chainId')return '0x4cef52';
    if(method==='personal_sign'){if(rejectSignature){rejectSignature=false;return {rejected:true};}return signers[selected].signMessage({message:{raw:params[0]}});}throw new Error('UNEXPECTED_WALLET_METHOD');
  });
  await page.addInitScript(()=>{const callbacks=new Map();window.ethereum={request:async arg=>{const v=await window.__platformRequest(arg);if(v?.rejected){const e=new Error('Signature cancelled');e.code=4001;throw e;}return v;},on:(name,fn)=>{if(!callbacks.has(name))callbacks.set(name,new Set());callbacks.get(name).add(fn);},removeListener:(name,fn)=>callbacks.get(name)?.delete(fn)};window.__platformWalletChanged=()=>{for(const fn of callbacks.get('accountsChanged')??[])fn();};});
  let workspaceId,otherWorkspaceId,fileId,orderId,draftId;
  await step('UI-01 identified nonblank Operations page and recoverable signature rejection',async()=>{
    await page.goto(origin+'/app/operations');await page.getByRole('heading',{name:'文件、任务与后台',exact:true}).waitFor();assert.equal(await page.locator('vite-error-overlay').count(),0);
    rejectSignature=true;await page.getByRole('button',{name:'签名登录',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(async()=> (await fetch('/api/v1/session')).status),401);
    await page.getByRole('button',{name:'签名登录',exact:true}).click();await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();
    workspaceId=(await api(page,'/workspaces','POST',{name:'Platform acceptance workspace'})).id;
    otherWorkspaceId=(await api(page,'/workspaces','POST',{name:'Empty second workspace'})).id;
    draftId=(await api(page,`/workspaces/${workspaceId}/drafts`,'POST',{toolType:'deliver',title:'Browser controlled file',description:'Local acceptance fixture'})).id;
    await page.reload();await page.getByLabel('当前工作区',{exact:true}).selectOption(workspaceId);await page.getByLabel('受控样本',{exact:true}).waitFor();
  });
  await step('UI-02 real controlled upload, queue dispatch and READY file',async()=>{
    await page.getByRole('button',{name:'导入受控样本',exact:true}).click();await page.getByText('文件已接收，等待任务校验。',{exact:true}).waitFor();
    await page.getByRole('button',{name:'任务与故障',exact:true}).click();await page.getByRole('button',{name:'运行待办任务',exact:true}).click();
    await waitUntil(async()=> (await api(page,`/workspaces/${workspaceId}/files`)).items.some(f=>f.state==='READY'));
    await page.getByRole('button',{name:'文件版本',exact:true}).click();await page.getByText('可用',{exact:true}).waitFor();
    fileId=(await api(page,`/workspaces/${workspaceId}/files`)).items[0].id;
    await screenshot(page,'files',1440);await screenshot(page,'files',375);await page.setViewportSize({width:1440,height:1000});
  });
  await step('UI-03 second immutable version leaves prior file unchanged',async()=>{
    const before=(await api(page,`/workspaces/${workspaceId}/files`)).items[0];await page.getByLabel('受控样本',{exact:true}).selectOption('sample-v2');await page.getByLabel('版本系列',{exact:true}).selectOption(before.seriesId);
    await page.getByRole('button',{name:'导入受控样本',exact:true}).click();await page.getByText('文件已接收，等待任务校验。',{exact:true}).waitFor();
    await page.getByRole('button',{name:'任务与故障',exact:true}).click();await page.getByRole('button',{name:'运行待办任务',exact:true}).click();
    await waitUntil(async()=> (await api(page,`/workspaces/${workspaceId}/files`)).items.filter(f=>f.state==='READY').length===2);
    const old=(await api(page,`/workspaces/${workspaceId}/files`)).items.find(f=>f.id===fileId);assert.equal(old.sha256,before.sha256);assert.equal(old.version,1);
    await page.getByRole('button',{name:'刷新状态',exact:true}).click();await screenshot(page,'tasks',375);await page.setViewportSize({width:1440,height:1000});
  });
  // A labelled seeded projection isolates browser download behavior from chain tests.
  // No deployment, RPC override, signing or payment endpoint is exposed by this fixture.
  const f=(await api(page,`/workspaces/${workspaceId}/files`)).items.find(f=>f.id===fileId),owner=signers[0].address.toLowerCase(),userId=`5042002:${owner}`,deploymentId=randomUUID(),ruleId=randomUUID(),chainOrderId=keccak256(toHex(randomUUID())),jobId=randomUUID(),outboxId=randomUUID(),now=Date.now(),eventKey='browser-local:'+randomUUID(),contract='0x'+randomUUID().replaceAll('-','').padEnd(40,'a');
  orderId=randomUUID();const canonical=JSON.stringify({schema:'arcbox.order-rule.file.v1',scope:'LOCAL_BROWSER_FIXTURE',workspaceId,file:{id:f.id,sha256:f.sha256,retentionMs:2592000000}}),rulesHash=keccak256(toHex(canonical)),event=JSON.stringify({kind:'PAID',timestamp:Math.floor(now/1000)});
  sql(`INSERT INTO order_deployments(id,workspace_id,chain_id,address,asset,beneficiary,adapter,code_hash,deployment_block,created_at) VALUES(${quote(deploymentId)},${quote(workspaceId)},5042002,${quote(contract)},'0x3600000000000000000000000000000000000000',${quote(owner)},'m2b-probe-v1',${quote('0x'+'1'.repeat(64))},1,${now});
INSERT INTO order_rules(id,workspace_id,deployment_id,draft_id,draft_version,rules_hash,canonical_json,amount_u6,title,tool_type,created_by,created_at) VALUES(${quote(ruleId)},${quote(workspaceId)},${quote(deploymentId)},${quote(draftId)},1,${quote(rulesHash)},${quote(canonical)},'1000000','Browser controlled file','deliver',${quote(userId)},${now});
INSERT INTO file_rule_bindings(rule_id,file_id,retention_ms) VALUES(${quote(ruleId)},${quote(fileId)},2592000000);
INSERT INTO orders(id,workspace_id,rule_id,deployment_id,chain_order_id,payer,amount_u6,nonce,expires_at,created_at,payment_state,funds_state,applied_sequence) VALUES(${quote(orderId)},${quote(workspaceId)},${quote(ruleId)},${quote(deploymentId)},${quote(chainOrderId)},${quote(owner)},'1000000','1',${Math.floor(now/1000)+600},${now},'CONFIRMED','LOCKED',1);
INSERT INTO order_chain_events(event_key,deployment_id,chain_order_id,sequence,fingerprint,event_json,block_number,transaction_index,log_index,verified_at) VALUES(${quote(eventKey)},${quote(deploymentId)},${quote(chainOrderId)},1,${quote(sha(event))},${quote(event)},1,0,0,${now});
INSERT INTO order_event_outcomes(event_key,state,applied_at) VALUES(${quote(eventKey)},'APPLIED',${now});
INSERT INTO file_entitlements(order_id,file_id,wallet,state,retention_until,source_event,created_at) VALUES(${quote(orderId)},${quote(fileId)},${quote(owner)},'ACTIVE',${now+2592000000},${quote(eventKey)},${now});
INSERT INTO order_outbox(id,effect_key,order_id,type,payload_json,state,created_at,sent_at) VALUES(${quote(outboxId)},${quote('browser:'+orderId)},${quote(orderId)},'ORDER_PROJECTED','{}','SENT',${now},${now});
INSERT INTO platform_jobs(id,effect_key,workspace_id,type,source_id,state,available_at,created_at,updated_at) VALUES(${quote(jobId)},${quote('outbox:'+outboxId)},${quote(workspaceId)},'ORDER_PROJECTED',${quote(outboxId)},'SUCCEEDED',${now},${now},${now});
INSERT INTO platform_notifications(id,job_id,user_id,workspace_id,order_id,code,created_at) VALUES(${quote(jobId+':'+userId)},${quote(jobId)},${quote(userId)},${quote(workspaceId)},${quote(orderId)},'PAID',${now});`);
  await step('UI-04 actual notification read, recovery query and downloaded R2 bytes',async()=>{
    await page.getByRole('button',{name:'我的通知',exact:true}).click();await page.getByRole('button',{name:'标为已读',exact:true}).click();await page.getByText('已读',{exact:true}).waitFor();
    await page.getByRole('button',{name:'查看订单恢复',exact:true}).click();await page.getByRole('button',{name:'核验并恢复',exact:true}).click();await page.getByRole('button',{name:'安全下载文件',exact:true}).waitFor();
    await screenshot(page,'recovery',1440);await screenshot(page,'recovery',375);
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'安全下载文件',exact:true}).click()]);assert.equal(download.suggestedFilename(),'arcbox-sample-v1.txt');const path=await download.path();assert.equal(sha(readFileSync(path)),f.sha256);
  });
  await step('UI-05 server refund denies stale download and preserves recovery input',async()=>{
    sql(`UPDATE orders SET funds_state='REFUND_CREDIT',delivery_state='REVOKED',version=version+1 WHERE id=${quote(orderId)};`);
    await page.getByRole('button',{name:'安全下载文件',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('订单 ID',{exact:true}).inputValue(),orderId);
    await page.getByRole('button',{name:'核验并恢复',exact:true}).click();await page.getByText('当前没有可用下载权限。退款、文件故障或保留期届满都可能阻止下载。',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'安全下载文件',exact:true}).count(),0);
  });
  await step('UI-06 workspace switch does not display previous workspace files',async()=>{
    await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'文件版本',exact:true}).click();await page.getByLabel('当前工作区',{exact:true}).selectOption(otherWorkspaceId);
    await page.getByText('暂无记录。仅显示当前权限范围内的真实后台记录。',{exact:true}).waitFor();assert.equal(await page.locator('.op-record').count(),0);
    await page.getByLabel('当前工作区',{exact:true}).selectOption(workspaceId);
  });
  await step('UI-07 viewer permission, wallet change and real API denial',async()=>{
    const invite=await api(page,`/workspaces/${workspaceId}/invitations`,'POST',{address:signers[1].address,role:'viewer'});
    selected=1;await page.evaluate(()=>window.__platformWalletChanged());await page.getByRole('button',{name:'签名登录',exact:true}).waitFor();assert.equal(await page.locator('.op-record').count(),0);
    await page.getByRole('button',{name:'签名登录',exact:true}).click();await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();
    const invitations=await api(page,'/invitations');assert.ok(invitations.length);await api(page,`/invitations/${invitations[0].id}/accept`,'POST',{});await page.reload();
    await page.getByText('当前角色只可查看文件。上传需 owner 或 editor。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'导入受控样本',exact:true}).count(),0);
    await page.getByRole('button',{name:'任务与故障',exact:true}).click();assert.equal(await page.getByRole('button',{name:'运行待办任务',exact:true}).count(),0);
    await screenshot(page,'viewer',375);
  });
  await step('UI-08 language, session refresh and logout clear private records',async()=>{
    await page.getByRole('button',{name:'EN',exact:true}).click();await page.getByRole('heading',{name:'Files, tasks & operations',exact:true}).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    await api(page,'/auth/logout','POST',{});await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();assert.equal(await page.locator('.op-record').count(),0);
    assert.equal(await page.evaluate(async()=> (await fetch('/api/v1/session')).status),401);assert.deepEqual(report.consoleErrors,[]);assert.ok(methods.every(m=>['eth_accounts','eth_requestAccounts','eth_chainId','personal_sign'].includes(m)));
  });
  report.walletMethods=[...new Set(methods)];report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1;console.error('M2C_BROWSER_FAILURE '+error.message);}
finally{if(browser)await browser.close();if(server?.pid){try{process.kill(-server.pid,'SIGTERM');}catch{server.kill();}}rmSync(temp,{recursive:true,force:true});writeFileSync('reports/platform-browser.json',JSON.stringify(report,null,2)+'\n');console.log('M2C_BROWSER_REPORT '+JSON.stringify(report));}
