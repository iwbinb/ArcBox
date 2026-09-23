#!/usr/bin/env node
/** M0 read-only probe. No private keys, signing, deployments or broadcast methods. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const NETWORKS = Object.freeze({
  testnet: Object.freeze({ chainId: 5042002n, rpc: 'https://rpc.testnet.arc.io' }),
  mainnet: Object.freeze({ chainId: 5042n, rpc: 'https://rpc.mainnet.arc.io' }),
});
export const USDC = '0x3600000000000000000000000000000000000000';
// Public synthetic address: queried only. Never send funds to it.
export const SAMPLE = '0x0000000000000000000000000000000000000001';
const READ_METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_call', 'eth_getBalance']);
const SAFE_TRANSPORT_CODES = new Set(['EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED']);

export class ProbeError extends Error {
  constructor(code, status = 'FAIL') {
    super(code);
    this.name = 'ProbeError';
    this.code = code;
    this.status = status;
  }
}

export function parseQuantity(value) {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new ProbeError('INVALID_RPC_QUANTITY');
  }
  return BigInt(value);
}

export function parseWord(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ProbeError('INVALID_ABI_UINT256');
  }
  return BigInt(value);
}

export function createReadOnlyRpc(endpoint, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  let url;
  try { url = new URL(endpoint); } catch { throw new ProbeError('INVALID_RPC_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new ProbeError('UNSAFE_RPC_URL');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new ProbeError('INVALID_TIMEOUT');
  }
  let nextId = 0;
  return async function rpc(method, params = []) {
    if (!READ_METHODS.has(method)) throw new ProbeError('METHOD_NOT_READ_ONLY');
    const id = ++nextId;
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const cause = SAFE_TRANSPORT_CODES.has(error?.cause?.code) ? error.cause.code : 'UNAVAILABLE';
      const timeout = ['TimeoutError', 'AbortError'].includes(error?.name);
      throw new ProbeError(timeout ? 'RPC_TIMEOUT' : `RPC_NETWORK_${cause}`, 'BLOCKED');
    }
    if (!response.ok) throw new ProbeError(`RPC_HTTP_${response.status}`, 'BLOCKED');
    let body;
    try { body = await response.json(); } catch { throw new ProbeError('INVALID_RPC_JSON'); }
    if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || body.id !== id) {
      throw new ProbeError('INVALID_RPC_ENVELOPE');
    }
    // Do not log provider error messages: they may echo a credential-bearing URL.
    if (Object.hasOwn(body, 'error')) throw new ProbeError('RPC_RESPONSE_ERROR', 'BLOCKED');
    if (!Object.hasOwn(body, 'result')) throw new ProbeError('MISSING_RPC_RESULT');
    return body.result;
  };
}

export async function probeArc({ network = 'testnet', endpoint, fetchImpl, now = () => new Date().toISOString() } = {}) {
  const config = Object.hasOwn(NETWORKS, network) ? NETWORKS[network] : null;
  if (!config) throw new ProbeError('UNKNOWN_NETWORK');
  const report = {
    schemaVersion: 1, suite: 'arcbox-m0-readonly', observedAt: now(), network,
    expectedChainId: config.chainId.toString(), nodeVersion: process.version,
    endpoint: endpoint === undefined ? config.rpc : '<custom endpoint redacted>',
    readOnly: true, status: 'NOT_RUN', checks: [],
    notVerified: [
      'ERC-20 transfers, approvals, SafeERC20 behavior and failure cases',
      'transaction receipts, USDC dual logs and finality behavior',
      'wallet UI, EOA/SIWE/ERC-1271 signatures and contract compatibility',
      'Cloudflare cloud resources, D1, R2, Queues and Workers builds',
      'production readiness, audits or complete M0 acceptance',
    ],
  };
  let current = 'rpc.configuration';
  const check = (id, condition, detail) => {
    report.checks.push({ id, status: condition ? 'PASS' : 'FAIL', detail });
    if (!condition) throw new ProbeError(id.toUpperCase().replaceAll('.', '_'));
  };
  try {
    const rpc = createReadOnlyRpc(endpoint ?? config.rpc, { fetchImpl });
    current = 'arc.chain_id';
    const chainId = parseQuantity(await rpc('eth_chainId'));
    check(current, chainId === config.chainId, { observed: chainId.toString(), expected: config.chainId.toString() });
    current = 'arc.block_anchor';
    const block = await rpc('eth_getBlockByNumber', ['latest', false]);
    if (!block || !/^0x[0-9a-fA-F]{64}$/.test(block.hash ?? '')) throw new ProbeError('INVALID_BLOCK_HEADER');
    const number = parseQuantity(block.number);
    report.block = { number: number.toString(), hash: block.hash };
    check(current, true, report.block);
    current = 'usdc.decimals';
    const decimals = parseWord(await rpc('eth_call', [{ to: USDC, data: '0x313ce567' }, block.number]));
    check(current, decimals === 6n, { observed: decimals.toString(), expected: '6' });
    current = 'usdc.balance_relation';
    const addressWord = SAMPLE.slice(2).padStart(64, '0');
    const native = parseQuantity(await rpc('eth_getBalance', [SAMPLE, block.number]));
    const erc20 = parseWord(await rpc('eth_call', [{ to: USDC, data: `0x70a08231${addressWord}` }, block.number]));
    check(current, native / 1000000000000n === erc20, {
      account: SAMPLE, nativeU18: native.toString(), erc20U6: erc20.toString(),
      interpretation: 'One address at one block; not a transfer or universal equivalence proof.',
    });
    current = 'usdc.allowance_read';
    const spenderWord = USDC.slice(2).padStart(64, '0');
    const allowance = parseWord(await rpc('eth_call', [{ to: USDC, data: `0xdd62ed3e${addressWord}${spenderWord}` }, block.number]));
    check(current, true, { allowanceU6: allowance.toString(), interpretation: 'Read only; no approval executed.' });
    current = 'arc.block_anchor_consistency';
    const again = await rpc('eth_getBlockByNumber', [block.number, false]);
    check(current, again?.hash === block.hash && again?.number === block.number, { blockHash: again?.hash ?? null });
    report.status = 'PASS';
  } catch (error) {
    const known = error instanceof ProbeError;
    report.status = known ? error.status : 'FAIL';
    report.error = { code: known ? error.code : 'UNEXPECTED_PROBE_FAILURE', check: current };
    if (!report.checks.some((item) => item.id === current && item.status === 'FAIL')) {
      report.checks.push({ id: current, status: report.status, detail: { code: report.error.code } });
    }
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--network' || !Object.hasOwn(NETWORKS, args[1])) {
    console.error('Usage: node scripts/m0/probe-arc.mjs --network testnet|mainnet');
    process.exitCode = 2;
    return;
  }
  const network = args[1];
  const report = await probeArc({ network, endpoint: process.env[`ARCBOX_${network.toUpperCase()}_RPC_URL`] });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
