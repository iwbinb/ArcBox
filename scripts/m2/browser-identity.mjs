import assert from 'node:assert/strict';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';

// The session has no Browser plugin. Use regular Playwright, an isolated local
// Worker and a test EIP-1193 provider. This is NOT a real wallet extension test.
const root='tests/identity/browser';
if(!existsSync(root+'/package-lock.json')){
  // One-time read-only bootstrap: record registry integrity before committing
  // the isolated test lock. No unverified package is installed or executed.
  const metadata=await(await fetch('https://registry.npmjs.org/playwright-core/1.55.1',{signal:AbortSignal.timeout(15000)})).json();
  console.log('M2A_BROWSER_LOCK_METADATA '+JSON.stringify({version:metadata.version,dist:metadata.dist,bin:metadata.bin,engines:metadata.engines,license:metadata.license}));
  throw new Error('BROWSER_LOCK_REQUIRED');
}
execFileSync('npm',['ci','--prefix',root,'--ignore-scripts','--no-audit','--no-fund'],{stdio:'inherit',timeout:60000});
const {chromium}=await import('../../tests/identity/browser/node_modules/playwright-core/index.mjs');
const temp=mkdtempSync(join(tmpdir(),'arcbox-identity-'));
mkdirSync('reports',{recursive:true});
const report={status:'RUNNING',browserPath:'Playwright (Browser plugin not available)',scope:'Local Worker/D1 with injected test EIP-1193 signer; no extension or public-chain transactions',sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checks:[],screenshots:[],consoleErrors:[],expectedHttpErrors:0};
let server,browser,logs='';
const signers=[privateKeyToAccount(generatePrivateKey()),privateKeyToAccount(generatePrivateKey())];
let selected=0,deny=false;const methods=[];
async function step(name,fn){await fn();report.checks.push({name,status:'PASS'});console.log('M2A_BROWSER_CHECK '+name);}
async function waitUntil(fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){try{if(await fn())return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('WAIT_TIMEOUT');}
try{
  const migrate=spawnSync('pnpm',['exec','wrangler','d1','migrations','apply','arcbox-identity-local','--local','--config','wrangler.identity.jsonc','--persist-to',join(temp,'state')],{stdio:'inherit',timeout:45000,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'}});
  assert.equal(migrate.status,0,'Local migration must succeed.');
  server=spawn('pnpm',['exec','wrangler','dev','--config','wrangler.identity.jsonc','--ip','127.0.0.1','--port','8789','--persist-to',join(temp,'state')],{detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  for(const stream of [server.stdout,server.stderr])stream.on('data',b=>{logs=(logs+b.toString()).slice(-12000);});
  await waitUntil(async()=>{const r=await fetch('http://127.0.0.1:8789/api/health');return r.ok;},30000);
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-dev-shm-usage']});report.browserVersion=browser.version();
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.exposeBinding('__identityWallet',async(_source,args)=>{
    methods.push(args.method);
    if(args.method==='eth_accounts'||args.method==='eth_requestAccounts')return [signers[selected].address];
    if(args.method==='eth_chainId')return '0x4cef52';
    if(args.method==='wallet_switchEthereumChain')return null;
    if(args.method==='personal_sign'){
      if(deny){deny=false;return {denied:true};}
      assert.equal(args.params[1].toLowerCase(),signers[selected].address.toLowerCase());
      return signers[selected].signMessage({message:{raw:args.params[0]}});
    }
    throw new Error('Unexpected wallet method: '+args.method);
  });
  await context.addInitScript(()=>{
    const listeners=new Map();
    window.ethereum={request:async args=>{const result=await window.__identityWallet(args);if(result?.denied){const error=new Error('User rejected');error.code=4001;throw error;}return result;},on:(name,fn)=>{const list=listeners.get(name)??[];list.push(fn);listeners.set(name,list);},removeListener:(name,fn)=>listeners.set(name,(listeners.get(name)??[]).filter(f=>f!==fn))};
    window.__changeIdentityWallet=()=>{for(const fn of listeners.get('accountsChanged')??[])fn();};
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror',e=>report.consoleErrors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'){if(/Failed to load resource/.test(m.text())&&/api\/v1\//.test(m.location().url))report.expectedHttpErrors++;else if(!m.location().url.endsWith('/favicon.ico'))report.consoleErrors.push(m.text());}});
  const visible=async text=>await page.getByText(text,{exact:true}).first().isVisible();
  await step('BROWSER-01 page identity, nonblank, no framework overlay',async()=>{
    await page.goto('http://127.0.0.1:8789/app');await page.getByRole('button',{name:'签名登录',exact:true}).waitFor();
    assert.equal(await page.title(),'ArcBox | Workspace');assert.equal(page.url(),'http://127.0.0.1:8789/app');assert.equal(await page.locator('vite-error-overlay').count(),0);
  });
  await step('BROWSER-02 rejected signature is recoverable and does not authenticate',async()=>{
    deny=true;await page.getByRole('button',{name:'签名登录',exact:true}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/取消签名/);
    const status=await page.evaluate(async()=> (await fetch('/api/v1/session')).status);assert.equal(status,401);
  });
  let workspaceId;
  await step('BROWSER-03 real API login, create workspace and persisted draft',async()=>{
    await page.getByRole('button',{name:'签名登录',exact:true}).click();await page.getByLabel('新工作区名称',{exact:true}).fill('Browser workspace');await page.getByRole('button',{name:'创建工作区',exact:true}).click();
    await page.getByLabel('草稿名称',{exact:true}).fill('Persisted identity draft');await page.getByLabel('说明',{exact:true}).fill('Saved through local Worker and D1, not localStorage.');await page.getByRole('button',{name:'保存草稿',exact:true}).click();
    await waitUntil(()=>visible('草稿已保存到当前后台'));
    workspaceId=await page.getByLabel('当前工作区',{exact:true}).inputValue();assert.ok(workspaceId);
    await page.reload();await page.getByText('Persisted identity draft',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>localStorage.length),0);
  });
  await step('BROWSER-04 draft conflict preserves unsaved input',async()=>{
    await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByLabel('草稿名称',{exact:true}).fill('Unsaved local title');
    const changed=await page.evaluate(async w=>{
      const s=(await(await fetch('/api/v1/session')).json()).data;
      const d=(await(await fetch(`/api/v1/workspaces/${w}/drafts`)).json()).data.items[0];
      return (await fetch(`/api/v1/workspaces/${w}/drafts/${d.id}`,{method:'PATCH',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrfToken,'If-Match':`"${d.version}"`},body:JSON.stringify({title:'Saved in another tab'})})).status;
    },workspaceId);assert.equal(changed,200);
    await page.getByRole('button',{name:/^保存草稿/}).click();await waitUntil(async()=> (await page.getByRole('alert').innerText()).includes('其他人修改'));
    assert.equal(await page.getByLabel('草稿名称',{exact:true}).inputValue(),'Unsaved local title');
    await page.getByRole('button',{name:'加载最新版本',exact:true}).click();await waitUntil(async()=>await page.getByLabel('草稿名称',{exact:true}).inputValue()==='Saved in another tab');
  });
  await step('BROWSER-05 wallet change, address-bound invitation and viewer permission',async()=>{
    await page.getByLabel('邀请钱包地址',{exact:true}).fill(signers[1].address);await page.getByRole('button',{name:'创建邀请',exact:true}).click();await waitUntil(()=>visible('邀请已创建，需目标钱包登录接受'));
    selected=1;await page.evaluate(()=>window.__changeIdentityWallet());await page.getByRole('button',{name:'签名登录',exact:true}).waitFor();await page.getByRole('button',{name:'签名登录',exact:true}).click();
    await page.getByRole('button',{name:'接受邀请',exact:true}).click();await page.getByText('当前角色只有只读权限。',{exact:true}).waitFor();
    const status=await page.evaluate(async w=>{const s=(await(await fetch('/api/v1/session')).json()).data;return(await fetch(`/api/v1/workspaces/${w}/drafts`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrfToken},body:JSON.stringify({toolType:'deliver',title:'Denied',description:''})})).status;},workspaceId);assert.equal(status,403);
    assert.equal(await page.getByRole('button',{name:/^保存草稿/}).count(),0);
  });
  await step('BROWSER-06 responsive screenshots, bilingual UI and no overflow',async()=>{
    for(const width of [1440,375]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const file=`reports/m2-a-workspace-${width}.png`;await page.screenshot({path:file,fullPage:true});
      report.screenshots.push({file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),width});
    }
    await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('heading',{name:'Workspace',exact:true}).waitFor();
  });
  await step('BROWSER-07 logout revokes session, no unexpected wallet methods or exceptions',async()=>{
    await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Sign in with wallet',exact:true}).waitFor();
    assert.equal(await page.evaluate(async()=> (await fetch('/api/v1/session')).status),401);
    assert.deepEqual(report.consoleErrors,[]);assert.ok(!methods.some(method=>/sendTransaction|sendRawTransaction|signTransaction/.test(method)));
  });
  report.walletMethods=[...new Set(methods)];report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.message;console.error('M2A_BROWSER_FAILURE '+error.message);console.log('M2A_LOCAL_WORKER_TAIL '+logs.slice(-2000));process.exitCode=1;}
finally{
  if(browser)await browser.close();if(server?.pid){try{process.kill(-server.pid,'SIGTERM');}catch{server.kill();}}
  rmSync(temp,{recursive:true,force:true});writeFileSync('reports/identity-browser.json',JSON.stringify(report,null,2));console.log('M2A_BROWSER_REPORT '+JSON.stringify(report));
}
