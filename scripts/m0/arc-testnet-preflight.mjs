import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recoverMessageAddress } from 'viem';
import { ERC20, RPC, SCALE, TESTNET_ID, TOKEN, guardLive, readonlyClient, safeJson } from '../../probes/arc/lib.mjs';

const phase = process.env.ARCBOX_TESTNET_PHASE;
if (!['preflight', 'execute'].includes(phase)) throw new Error('INVALID_TESTNET_PHASE');

// Verify the signer before making even a read-only RPC request.
const account = guardLive(process.env);
const message = `ArcBox M0-D testnet preflight: ${process.env.GITHUB_SHA ?? 'local'}`;
const signature = await account.signMessage({ message });
assert.equal((await recoverMessageAddress({ message, signature })).toLowerCase(), account.address.toLowerCase());

const client = readonlyClient(RPC);
assert.equal(await client.getChainId(), TESTNET_ID);
const block = await client.getBlock();
const [native, erc20, decimals, latestNonce, pendingNonce] = await Promise.all([
  client.getBalance({ address: account.address, blockNumber: block.number }),
  client.readContract({ address: TOKEN, abi: ERC20, functionName: 'balanceOf', args: [account.address], blockNumber: block.number }),
  client.readContract({ address: TOKEN, abi: ERC20, functionName: 'decimals', blockNumber: block.number }),
  client.getTransactionCount({ address: account.address, blockNumber: block.number }),
  client.getTransactionCount({ address: account.address, blockTag: 'pending' }),
]);
assert.equal(decimals, 6);
assert.equal(native / SCALE, erc20);
assert.equal(latestNonce, pendingNonce, 'UNRESOLVED_WALLET_TRANSACTION');
assert.equal((await client.getBlock({ blockNumber: block.number })).hash, block.hash, 'BLOCK_CHANGED');

const funded = native >= 2_100_000_000_000_000_000n;
const report = {
  stage: 'M0-D', scope: 'PROTECTED_TESTNET_PREFLIGHT', phase,
  status: funded ? 'READY' : 'UNFUNDED',
  address: account.address, signerVerified: true, publicWrites: false,
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  runId: process.env.GITHUB_RUN_ID ?? null,
  chainId: TESTNET_ID, blockNumber: block.number, blockHash: block.hash,
  nativeU18: native, erc20U6: erc20, latestNonce, pendingNonce,
};
console.log('ARC_TESTNET_PREFLIGHT ' + safeJson(report));
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, '# Arc testnet wallet preflight\n\n```json\n' + safeJson(report) + '\n```\n');
}
if (phase === 'execute' && !funded) throw new Error('TEST_FUNDS_AND_GAS_RESERVE_REQUIRED');
