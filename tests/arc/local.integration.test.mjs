import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { mnemonicToAccount } from 'viem/accounts';
import { encodeFunctionData, createPublicClient, createWalletClient, http, hashTypedData } from 'viem';
import { TOKEN, ERC20, SCALE, caseId, pairedTransfers, typedAction, safeJson, chain } from '../../probes/arc/lib.mjs';
import { executeScenario, artifacts } from '../../probes/arc/scenario.mjs';

let child, url, client, wallet, compiled, probe, smartWallet;
const pin = JSON.parse(readFileSync('probes/arc/runtime.json', 'utf8'));
const account = mnemonicToAccount('test test test test test test test test test test test junk');
const other = mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex: 1 });
let startupLog = '';
before(async () => {
  const listener = createServer(); await new Promise((done) => listener.listen(0, '127.0.0.1', done));
  const port = listener.address().port; await new Promise((done) => listener.close(done));
  url = `http://127.0.0.1:${port}`;
  child = spawn(resolve('.toolchain/arc-foundry/arc-anvil'), ['--network', pin.network, '--hardfork', pin.hardfork, '--chain-id', String(pin.localChainId), '--host', '127.0.0.1', '--port', String(port), '--silent'], { stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (chunk) => { startupLog = (startupLog + chunk).slice(-5000); });
  let spawnError; child.on('error', (error) => { spawnError = error.code; });
  const network = chain(31337, url);
  client = createPublicClient({ chain: network, transport: http(url, { timeout: 1000, retryCount: 0 }), pollingInterval: 100 });
  for (let i = 0; i < 100; i++) {
    if (spawnError || child.exitCode !== null) throw new Error(`ARC_RUNTIME_START_FAILED ${spawnError ?? startupLog}`);
    try { if (await client.getChainId() === 31337) break; } catch { /* local process is still starting */ }
    await delay(100);
  }
  assert.equal(await client.getChainId(), 31337);
  assert.equal((await client.request({ method: 'anvil_nodeInfo' })).network, 'arc');
  wallet = createWalletClient({ account, chain: network, transport: http(url, { retryCount: 0, timeout: 5000 }) });
  compiled = artifacts();
}, { timeout: 20000 });
after(async () => {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); for (let i = 0; i < 20 && child.exitCode === null; i++) await delay(50); if (child.exitCode === null) child.kill('SIGKILL'); }
});
async function send(address, abi, functionName, args = [], expected = 'success') {
  const hash = await wallet.writeContract({ address, abi, functionName, args, gas: 2000000n, maxFeePerGas: 50000000000n, maxPriorityFeePerGas: 1000000000n });
  const result = await client.waitForTransactionReceipt({ hash, timeout: 10000, pollingInterval: 100 });
  assert.equal(result.status, expected); return result;
}
async function deploy(artifact, args = []) {
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args, gas: 3000000n, maxFeePerGas: 50000000000n, maxPriorityFeePerGas: 1000000000n });
  const result = await client.waitForTransactionReceipt({ hash, timeout: 10000, pollingInterval: 100 });
  assert.equal(result.status, 'success'); return result.contractAddress;
}
const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });

test('EVM-01 shared local/live SDK scenario: 12 explicit checks and real local receipts', { timeout: 90000 }, async () => {
  const report = { stage: 'M0-D', scope: 'LOCAL_ARC_EXECUTION', publicWrites: false };
  mkdirSync('reports', { recursive: true });
  try {
    await executeScenario({ mode: 'local', url, account, report, save: (value) => writeFileSync('reports/arc-local-scenario.json', safeJson(value) + '\n') });
    assert.equal(report.status, 'PASS_LOCAL_ARC'); assert.equal(report.checks.length, 12);
    probe = report.contracts.probe; smartWallet = report.contracts.wallet1271;
  } finally { console.log('ARC_LOCAL_SCENARIO ' + safeJson(report)); }
});
test('EVM-02 zero/self ERC20 sends have no paired system movement', async () => {
  const zero = pairedTransfers((await send(TOKEN, ERC20, 'transfer', [other.address, 0n])).logs);
  assert.equal(zero.token.length, 1); assert.equal(zero.system.length, 0);
  const self = pairedTransfers((await send(TOKEN, ERC20, 'transfer', [account.address, 1n])).logs);
  assert.equal(self.token.length, 1); assert.equal(self.system.length, 0);
});
test('EVM-03 native sub-unit transfer keeps 18-decimal precision', async () => {
  const before = await client.getBalance({ address: other.address });
  const hash = await wallet.sendTransaction({ to: other.address, value: 1n, gas: 21000n, maxFeePerGas: 50000000000n, maxPriorityFeePerGas: 1000000000n });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 10000, pollingInterval: 100 });
  assert.equal(receipt.status, 'success');
  const after = await client.getBalance({ address: other.address });
  assert.equal(after - before, 1n);
  assert.equal(await read(TOKEN, ERC20, 'balanceOf', [other.address]), after / SCALE);
  const movement = pairedTransfers(receipt.logs); assert.equal(movement.token.length, 0); assert.equal(movement.system[0].value, 1n);
});
test('EVM-04 amount cap, foreign operator and native value calls rejected', async () => {
  for (const args of [[caseId(90), 0n], [caseId(91), 10001n]]) await assert.rejects(client.simulateContract({ account, address: probe, abi: compiled.probe.abi, functionName: 'roundTrip', args }));
  await assert.rejects(client.simulateContract({ account: other.address, address: probe, abi: compiled.probe.abi, functionName: 'roundTrip', args: [caseId(92), 1n] }));
  await assert.rejects(client.call({ account, to: probe, data: encodeFunctionData({ abi: compiled.probe.abi, functionName: 'roundTrip', args: [caseId(93), 1n] }), value: 1n }));
});
test('EVM-05 invalid domain, signer, expiry and revoked ERC1271 rejected', async () => {
  const now = (await client.getBlock()).timestamp;
  const m = { caseId: caseId(94), signer: smartWallet, nonce: 1n, deadline: now + 100n };
  const typed = typedAction(31337, probe, m);
  const signature = await account.signTypedData(typed);
  assert.equal(await read(probe, compiled.probe.abi, 'verify', [...Object.values(m), signature]), true);
  const wrong = await account.signTypedData({ ...typed, domain: { ...typed.domain, verifyingContract: other.address } });
  assert.equal(await read(probe, compiled.probe.abi, 'verify', [...Object.values(m), wrong]), false);
  assert.equal(await read(probe, compiled.probe.abi, 'verify', [...Object.values(m), await other.signTypedData(typed)]), false);
  const expired = { ...m, deadline: now };
  await assert.rejects(client.simulateContract({ account, address: probe, abi: compiled.probe.abi, functionName: 'consume', args: [...Object.values(expired), await account.signTypedData(typedAction(31337, probe, expired))] }));
  await send(smartWallet, compiled.wallet1271.abi, 'setEnabled', [false]);
  assert.equal(await read(probe, compiled.probe.abi, 'verify', [...Object.values(m), signature]), false);
  assert.equal(hashTypedData(typed).length, 66);
});
test('EVM-06 SafeERC20 false/revert/fee-token failure rolls back state and allowance', async () => {
  const asset = await deploy(compiled.fixture);
  const target = await deploy(compiled.probe, [asset]);
  for (const mode of [1, 2, 4]) {
    await send(asset, compiled.fixture.abi, 'setMode', [mode]);
    await send(asset, compiled.fixture.abi, 'approve', [target, 100n]);
    const before = await read(asset, compiled.fixture.abi, 'balanceOf', [account.address]);
    const id = caseId(100 + mode);
    await send(target, compiled.probe.abi, 'roundTrip', [id, 100n], 'reverted');
    assert.equal(await read(target, compiled.probe.abi, 'completed', [id]), false);
    assert.equal(await read(asset, compiled.fixture.abi, 'balanceOf', [account.address]), before);
    assert.equal(await read(asset, compiled.fixture.abi, 'allowance', [account.address, target]), 100n);
  }
});
test('EVM-07 SafeERC20 accepts no-return token fixture without residual custody', async () => {
  const asset = await deploy(compiled.fixture);
  const target = await deploy(compiled.probe, [asset]);
  await send(asset, compiled.fixture.abi, 'setMode', [3]);
  await send(asset, compiled.fixture.abi, 'approve', [target, 100n]);
  await send(target, compiled.probe.abi, 'roundTrip', [caseId(110), 100n]);
  assert.equal(await read(asset, compiled.fixture.abi, 'balanceOf', [target]), 0n);
  assert.equal(await read(asset, compiled.fixture.abi, 'allowance', [account.address, target]), 0n);
});
test('EVM-08 ERC1271 fixture owner cannot be spoofed by another wallet', async () => {
  await assert.rejects(client.simulateContract({ account: other.address, address: smartWallet, abi: compiled.wallet1271.abi, functionName: 'returnToken' }));
  await assert.rejects(client.simulateContract({ account: other.address, address: smartWallet, abi: compiled.wallet1271.abi, functionName: 'setEnabled', args: [true] }));
});
