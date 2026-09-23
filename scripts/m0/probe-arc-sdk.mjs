import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ERC20, TOKEN, SCALE, RPC, TESTNET_ID, readonlyClient, pairedTransfers, safeJson, TRANSFER_TOPIC } from '../../probes/arc/lib.mjs';

const report = { stage: 'M0-D', scope: 'PUBLIC_TESTNET_READONLY', sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), startedAt: new Date().toISOString(), endpoint: RPC, writes: false, checks: [], status: 'IN_PROGRESS' };
const client = readonlyClient();
const record = (id, detail) => report.checks.push({ id, status: 'PASS', detail });
try {
  assert.equal(await client.getChainId(), TESTNET_ID); record('SDK-RO-01', { chainId: TESTNET_ID });
  const block = await client.getBlock();
  assert.ok(block.number !== null && block.hash !== null);
  record('SDK-RO-02', { blockNumber: block.number, blockHash: block.hash });
  assert.equal(await client.readContract({ address: TOKEN, abi: ERC20, functionName: 'decimals', blockNumber: block.number }), 6);
  record('SDK-RO-03', { decimals: 6 });
  // Public read-only sentinel, never used as a payer or recipient by this program.
  const account = '0x0000000000000000000000000000000000000001';
  const native = await client.getBalance({ address: account, blockNumber: block.number });
  const erc20 = await client.readContract({ address: TOKEN, abi: ERC20, functionName: 'balanceOf', args: [account], blockNumber: block.number });
  assert.equal(erc20, native / SCALE);
  record('SDK-RO-04', { account, nativeU18: native, erc20U6: erc20, note: 'One address at a fixed block, not a universal transfer proof.' });
  const allowance = await client.readContract({ address: TOKEN, abi: ERC20, functionName: 'allowance', args: [account, account], blockNumber: block.number });
  record('SDK-RO-05', { allowanceU6: allowance });
  const logs = await client.request({ method: 'eth_getLogs', params: [{ address: TOKEN, topics: [TRANSFER_TOPIC], fromBlock: `0x${(block.number > 128n ? block.number - 128n : 0n).toString(16)}`, toBlock: `0x${block.number.toString(16)}` }] });
  if (logs.length > 2000) throw new Error('SAMPLE_LIMIT');
  const hashes = [...new Set(logs.map((log) => log.transactionHash))].slice(0, 3);
  const samples = [];
  for (const hash of hashes) {
    const receipt = await client.getTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success');
    const decoded = pairedTransfers(receipt.logs);
    samples.push({ hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, erc20Transfers: decoded.token.length, nativeTransfers: decoded.system.length, matchedPositivePairs: decoded.pairs });
  }
  report.checks.push({ id: 'SDK-RO-06', status: samples.length ? 'PASS' : 'INCONCLUSIVE', detail: { scannedBlocks: 129, samples, note: 'Historical public receipts; NOT transactions sent by ArcBox.' } });
  assert.equal((await client.getBlock({ blockNumber: block.number })).hash, block.hash); record('SDK-RO-07', { anchorUnchanged: true });
  report.status = samples.length ? 'PASS_READONLY' : 'INCONCLUSIVE';
} catch (error) {
  report.status = 'FAIL_OR_UNAVAILABLE'; report.errorClass = error.name;
  // Never print raw RPC error bodies, signed payloads or credential-bearing errors.
  process.exitCode = 1;
}
report.completedAt = new Date().toISOString();
report.notVerified = ['New public-testnet approvals/transfers/contract deployment', 'Public-testnet EOA/ERC-1271 contract execution', 'Browser wallet flows', 'Production safety'];
mkdirSync('reports', { recursive: true });
writeFileSync('reports/arc-sdk-readonly.json', safeJson(report) + '\n');
console.log('ARC_SDK_READONLY_REPORT ' + safeJson(report));
