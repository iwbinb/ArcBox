import assert from 'node:assert/strict';
import { createPublicClient, custom, defineChain, http, parseAbi, toHex } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';

export const TOKEN = '0x3600000000000000000000000000000000000000';
export const SYSTEM = '0xfffffffffffffffffffffffffffffffffffffffe';
export const RPC = 'https://rpc.testnet.arc.io';
export const TESTNET_ID = 5042002;
export const SCALE = 10n ** 12n;
export const MAX_U6 = 10000n;
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const ERC20 = parseAbi(['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function transfer(address,uint256) returns (bool)', 'event Transfer(address indexed from,address indexed to,uint256 value)']);
export const ACTION_TYPES = { ProbeAction: [{ name: 'caseId', type: 'bytes32' }, { name: 'signer', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
export const READ_METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getBalance', 'eth_getCode', 'eth_call', 'eth_getLogs', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getTransactionCount', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_estimateGas']);
export function fail(code) { const error = new Error(code); error.code = code; throw error; }
export function amountU6(text) {
  if (typeof text !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(text)) fail('INVALID_AMOUNT');
  const [whole, fraction = ''] = text.split('.');
  const n = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (n <= 0n || n > MAX_U6) fail('AMOUNT_LIMIT');
  return n;
}
export function chain(id, url) { return defineChain({ id, name: id === TESTNET_ID ? 'Arc Testnet' : 'Arc local probe', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [url] } } }); }
export function assertEndpoint(mode, url) {
  const parsed = new URL(url);
  if (mode === 'testnet') { if (url !== RPC) fail('TESTNET_ENDPOINT_REQUIRED'); }
  else if (mode === 'local') { if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) fail('LOOPBACK_REQUIRED'); }
  else fail('UNKNOWN_MODE');
}
export function readonlyClient(url = RPC) {
  assertEndpoint('testnet', url);
  const base = http(url, { timeout: 12_000, retryCount: 0 })({ chain: chain(TESTNET_ID, url) });
  return createPublicClient({ chain: chain(TESTNET_ID, url), transport: custom({ async request(request) {
    if (!READ_METHODS.has(request.method)) fail('READONLY_METHOD_DENIED');
    return base.request(request);
  } }, { retryCount: 0 }) });
}
export function typedAction(chainId, verifyingContract, message) {
  return { domain: { name: 'ArcBoxCompatibilityProbe', version: '1', chainId, verifyingContract }, types: ACTION_TYPES, primaryType: 'ProbeAction', message };
}
export function guardLive(env) {
  if (env.ARCBOX_TESTNET_CONFIRM !== 'M0-D-TESTNET-ONLY') fail('TESTNET_AUTHORIZATION_REQUIRED');
  if (env.ARCBOX_TESTNET_RPC !== undefined && env.ARCBOX_TESTNET_RPC !== RPC) fail('TESTNET_ENDPOINT_REQUIRED');
  if (!/^0x[0-9a-fA-F]{64}$/.test(env.ARCBOX_TESTNET_PRIVATE_KEY ?? '')) fail('DEDICATED_TEST_KEY_REQUIRED');
  let account;
  try { account = privateKeyToAccount(env.ARCBOX_TESTNET_PRIVATE_KEY); } catch { fail('INVALID_TEST_KEY'); }
  if (account.address.toLowerCase() !== (env.ARCBOX_TESTNET_EXPECTED_ADDRESS ?? '').toLowerCase()) fail('DEDICATED_ADDRESS_MISMATCH');
  const devAddresses = Array.from({ length: 20 }, (_, addressIndex) => mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex }).address.toLowerCase());
  if (devAddresses.includes(account.address.toLowerCase()) || BigInt(env.ARCBOX_TESTNET_PRIVATE_KEY) <= 1000n) fail('PUBLIC_DEVELOPMENT_KEY_DENIED');
  return account;
}
export function assertUnusedTestnetWallet(latestNonce, pendingNonce) {
  if (BigInt(latestNonce) !== 0n || BigInt(pendingNonce) !== 0n) fail('TESTNET_WALLET_ALREADY_USED');
}
export class FeeBudget {
  constructor({ maxPerTx = 250000000000000000n, maxRun = 2000000000000000000n, maxTransactions = 12 } = {}) {
    this.maxPerTx = maxPerTx; this.maxRun = maxRun; this.maxTransactions = maxTransactions;
    this.spent = 0n; this.count = 0; this.pending = null;
  }
  reserve(gas, maxFeePerGas) {
    if (this.pending !== null) fail('UNRESOLVED_TRANSACTION');
    const cost = gas * maxFeePerGas;
    if (gas <= 0n || maxFeePerGas < 20000000000n || cost > this.maxPerTx || this.spent + cost > this.maxRun || this.count >= this.maxTransactions) fail('FEE_OR_TRANSACTION_LIMIT');
    this.pending = cost; this.count++;
  }
  confirmed(receipt) {
    const actual = receipt.gasUsed * receipt.effectiveGasPrice;
    if (this.pending === null || actual < 0n || actual > this.pending) fail('INVALID_FEE_RECEIPT');
    this.spent += actual; this.pending = null;
  }
}
export function checkReceipt(receipt, { hash, from, to, status = 'success' }) {
  assert.equal(receipt.transactionHash.toLowerCase(), hash.toLowerCase(), 'TX_HASH_MISMATCH');
  assert.equal(receipt.from.toLowerCase(), from.toLowerCase(), 'PAYER_MISMATCH');
  assert.equal(receipt.to?.toLowerCase() ?? null, to?.toLowerCase() ?? null, 'TARGET_MISMATCH');
  assert.equal(receipt.status, status, 'RECEIPT_STATUS_MISMATCH');
  assert.match(receipt.blockHash, /^0x[0-9a-fA-F]{64}$/);
  assert.ok(receipt.blockNumber >= 0n && receipt.gasUsed > 0n && receipt.effectiveGasPrice >= 0n);
  if (status === 'reverted') assert.equal(receipt.logs.length, 0, 'REVERTED_LOGS');
}
export function transferStreams(logs) {
  const streams = { token: [], system: [] };
  const seen = new Set();
  for (const log of logs) {
    const emitter = log.address.toLowerCase();
    if (emitter !== TOKEN && emitter !== SYSTEM) continue;
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    assert.equal(log.removed ?? false, false, 'REMOVED_LOG');
    assert.equal(log.topics.length, 3, 'TRANSFER_TOPICS');
    assert.match(log.data, /^0x[0-9a-fA-F]{64}$/, 'TRANSFER_DATA');
    for (const topic of log.topics.slice(1)) assert.match(topic, /^0x0{24}[0-9a-fA-F]{40}$/, 'TRANSFER_ADDRESS');
    const key = `${log.transactionHash}:${log.logIndex}`;
    assert.ok(!seen.has(key), 'DUPLICATE_LOG'); seen.add(key);
    streams[emitter === TOKEN ? 'token' : 'system'].push({ from: `0x${log.topics[1].slice(-40)}`.toLowerCase(), to: `0x${log.topics[2].slice(-40)}`.toLowerCase(), value: BigInt(log.data), logIndex: log.logIndex });
  }
  return streams;
}
export function pairedTransfers(logs) {
  const streams = transferStreams(logs);
  const remaining = [...streams.system];
  let pairs = 0;
  for (const token of streams.token) {
    if (token.value === 0n || token.from === token.to) continue;
    const index = remaining.findIndex((native) => native.from === token.from && native.to === token.to && native.value === token.value * SCALE);
    assert.ok(index >= 0, 'MISSING_SYSTEM_TRANSFER'); remaining.splice(index, 1); pairs++;
  }
  return { ...streams, pairs, unmatchedSystem: remaining.length };
}
export function safeJson(value) { return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item); }
export function caseId(n) { return toHex(BigInt(n), { size: 32 }); }
