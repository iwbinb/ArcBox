import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createPublicClient, createWalletClient, http, keccak256, toHex, parseAbi, parseEventLogs } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import solc from 'solc';
import { assertEndpoint, chain, TOKEN, ERC20 } from '../../probes/arc/lib.mjs';

// This script accepts no RPC URL or key input. Both signers are the existing
// PUBLIC Anvil fixtures, used exclusively on a newly started loopback process.
const tc=JSON.parse(readFileSync('toolchain.json','utf8'));
const pin=JSON.parse(readFileSync('probes/arc/runtime.json','utf8'));
const source=readFileSync('probes/orders/OrderEventsProbe.sol','utf8');
assert.equal(solc.version().split('+')[0],tc.solidity.packageVersion);
const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'OrderEventsProbe.sol':{content:source}},settings:{optimizer:tc.solidity.optimizer,evmVersion:pin.evmVersion,outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
const errors=(output.errors??[]).filter(e=>e.severity==='error');
assert.equal(errors.length,0,errors.map(e=>e.formattedMessage).join('\n'));
const compiled=output.contracts['OrderEventsProbe.sol'].OrderEventsProbe;
const owner=mnemonicToAccount('test test test test test test test test test test test junk');
const buyer=mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:1});
const beneficiary=owner.address.toLowerCase();
const sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const capture={schemaVersion:1,scope:'REAL_LOCAL_ARC_RECEIPTS_NOT_PUBLIC_TESTNET',sourceSha,chainId:5042002,transactions:{},receipts:{},blocks:{},cases:[],deployments:[],checks:[],publicChainWrites:false};
let child;
mkdirSync('reports',{recursive:true});
rmSync('reports/order-evm-capture.json',{force:true});
try{
  const listener=createServer();await new Promise(done=>listener.listen(0,'127.0.0.1',done));
  const port=listener.address().port;await new Promise(done=>listener.close(done));
  const url=`http://127.0.0.1:${port}`;assertEndpoint('local',url);
  // The loopback chain uses the target chain ID so replay requires no mutation
  // of transaction/domain metadata. This does not make it a public network.
  child=spawn(resolve('.toolchain/arc-foundry/arc-anvil'),['--network',pin.network,'--hardfork',pin.hardfork,'--chain-id','5042002','--host','127.0.0.1','--port',String(port),'--silent'],{stdio:['ignore','ignore','ignore']});
  let failed=false;child.on('error',()=>{failed=true;});
  const network=chain(5042002,url),client=createPublicClient({chain:network,transport:http(url,{timeout:1000,retryCount:0}),pollingInterval:50});
  for(let n=0;n<100;n++){
    if(failed||child.exitCode!==null)throw new Error('LOCAL_ARC_START_FAILED');
    try{if(await client.getChainId()===5042002)break;}catch{}
    await delay(100);
  }
  assert.equal(await client.getChainId(),5042002);
  assert.equal((await client.request({method:'anvil_nodeInfo'})).network,'arc');
  const wallets=[owner,buyer].map(account=>createWalletClient({chain:network,account,transport:http(url,{timeout:5000,retryCount:0})}));
  const fee={gas:2_000_000n,maxFeePerGas:50_000_000_000n,maxPriorityFeePerGas:1_000_000_000n};
  async function record(hash,label){
    const receipt=await client.waitForTransactionReceipt({hash,timeout:10000,pollingInterval:50});assert.equal(receipt.status,'success',label);
    capture.transactions[hash]=await client.request({method:'eth_getTransactionByHash',params:[hash]});
    capture.receipts[hash]=await client.request({method:'eth_getTransactionReceipt',params:[hash]});
    capture.checks.push({label,hash,status:receipt.status,blockNumber:receipt.blockNumber.toString()});return receipt;
  }
  const deployHash=await wallets[0].deployContract({abi:compiled.abi,bytecode:`0x${compiled.evm.bytecode.object}`,args:[owner.address],...fee});
  const deployed=await record(deployHash,'deploy-local-order-probe'),contract=deployed.contractAddress.toLowerCase();
  const runtimeCode=await client.getCode({address:contract});assert.ok(runtimeCode&&runtimeCode!=='0x');
  const createdAt=Date.now(),workspaceId=randomUUID(),draftId=randomUUID(),deploymentId=randomUUID(),ruleId=randomUUID(),amountU6='1000';
  await client.request({method:'evm_setNextBlockTimestamp',params:[Math.floor(createdAt/1000)+1]});
  const canonical=JSON.stringify({schema:'arcbox.order-rule.v1',adapter:'m2b-probe-v1',chainId:5042002,contract,asset:TOKEN,assetDecimals:6,beneficiary,workspaceId,draftId,draftVersion:1,toolType:'deliver',title:'Local EVM replay fixture',description:'Receipt replay only; not a production business contract.',amountU6,scope:'LOCAL_PROBE_ONLY'});
  const rulesHash=keccak256(toHex(canonical));
  capture.metadata={workspaceId,draftId,deploymentId,ruleId,owner:owner.address.toLowerCase(),payer:buyer.address.toLowerCase(),beneficiary,contract,codeHash:keccak256(runtimeCode),runtimeCode,deploymentBlock:Number(deployed.blockNumber),createdAt,amountU6,canonical,rulesHash};
  const eventAbi=parseAbi(['event OrderTransition(bytes32 indexed orderId,address indexed payer,bytes32 indexed rulesHash,uint32 sequence,uint8 kind,uint256 amountU6,address recipient,bytes32 nonce)']);
  for(const terminal of ['refund','settlement']){
    const orderId=randomUUID(),chainOrderId=`0x${randomBytes(32).toString('hex')}`,nonce=`0x${randomBytes(32).toString('hex')}`,expiresAt=Math.floor(createdAt/1000)+600;
    const hashes=[],kinds=[1,2,terminal==='refund'?3:4,terminal==='refund'?5:6];
    await record(await wallets[1].writeContract({address:TOKEN,abi:ERC20,functionName:'approve',args:[contract,BigInt(amountU6)],...fee}),`${terminal}-exact-approval`);
    for(const kind of kinds){
      const hash=kind===1
        ? await wallets[1].writeContract({address:contract,abi:compiled.abi,functionName:'pay',args:[chainOrderId,rulesHash,nonce,BigInt(amountU6),BigInt(expiresAt)],...fee})
        : await wallets[kind>=5?1:0].writeContract({address:contract,abi:compiled.abi,functionName:'advance',args:[chainOrderId,kind],...fee});
      const receipt=await record(hash,`${terminal}-kind-${kind}`),events=parseEventLogs({abi:eventAbi,logs:receipt.logs});
      assert.equal(events.length,1);assert.equal(events[0].args.sequence,hashes.length+1);assert.equal(events[0].args.orderId,chainOrderId);assert.equal(events[0].args.kind,kind);
      hashes.push(hash);
    }
    capture.cases.push({orderId,chainOrderId,nonce,expiresAt,createdAt,hashes,terminal,expectedFundsState:terminal==='refund'?'REFUNDED':'SETTLED'});
  }
  const probeBalance=await client.readContract({address:TOKEN,abi:ERC20,functionName:'balanceOf',args:[contract]});
  const allowance=await client.readContract({address:TOKEN,abi:ERC20,functionName:'allowance',args:[buyer.address,contract]});
  assert.equal(probeBalance,0n);assert.equal(allowance,0n);
  const head=await client.getBlock();
  for(let n=Number(deployed.blockNumber);n<=Number(head.number);n++)capture.blocks[n]=await client.request({method:'eth_getBlockByNumber',params:[toHex(n),false]});
  capture.latest=Number(head.number);capture.status='PASS';capture.probeBalanceU6=probeBalance.toString();capture.allowanceU6=allowance.toString();
  writeFileSync('reports/order-evm-capture.json',JSON.stringify(capture,null,2)+'\n');
  const summary={schemaVersion:1,scope:capture.scope,sourceSha,chainId:5042002,status:'PASS',localTransactions:capture.checks.length,businessEvents:8,flows:2,probeBalanceU6:'0',allowanceU6:'0',publicChainWrites:false,probeSourceSha256:createHash('sha256').update(source).digest('hex'),captureSha256:createHash('sha256').update(readFileSync('reports/order-evm-capture.json')).digest('hex')};
  writeFileSync('reports/order-evm-summary.json',JSON.stringify(summary,null,2)+'\n');
  console.log('M2B_LOCAL_EVM '+JSON.stringify(summary));
}finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');for(let n=0;n<20&&child.exitCode===null;n++)await delay(50);if(child.exitCode===null)child.kill('SIGKILL');}
}
