import test from 'node:test';
import assert from 'node:assert/strict';
import { NETWORKS, SAMPLE, USDC, ProbeError, createReadOnlyRpc, parseQuantity, parseWord, probeArc } from './probe-arc.mjs';

const word = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const hash = `0x${'ab'.repeat(32)}`;
const block = { number: '0x123', hash };
const fixedNow = () => '2026-09-23T00:00:00.000Z'; // Fixture, not a live observation.
function fixture(overrides = {}) {
  const calls = [];
  const values = { chain: NETWORKS.testnet.chainId, decimals: 6n, native: 15000000123456789000n, ...overrides };
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request);
    let result;
    switch (request.method) {
      case 'eth_chainId': result = `0x${values.chain.toString(16)}`; break;
      case 'eth_getBlockByNumber': result = block; break;
      case 'eth_getBalance': result = `0x${values.native.toString(16)}`; break;
      case 'eth_call': {
        const data = request.params[0].data;
        result = data.startsWith('0x313ce567') ? word(values.decimals)
          : data.startsWith('0x70a08231') ? word(values.erc20 ?? values.native / 1000000000000n)
          : word(0n);
        break;
      }
      default: assert.fail(`Unexpected method: ${request.method}`);
    }
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: request.id, result }) };
  };
  return { calls, fetchImpl };
}

for (const invalid of ['', '0x', '0x00', '-1', 42, null, '0xGG']) {
  test(`quantity rejects ${JSON.stringify(invalid)}`, () => assert.throws(() => parseQuantity(invalid), ProbeError));
}
test('uint values remain exact above Number.MAX_SAFE_INTEGER', () => {
  assert.equal(parseQuantity('0x20000000000001'), 9007199254740993n);
  assert.equal(parseWord(word(9007199254740993n)), 9007199254740993n);
});
test('ABI uint requires exactly 32 bytes', () => assert.throws(() => parseWord('0x06'), ProbeError));
test('valid fixture passes; all state reads use one block', async () => {
  const { calls, fetchImpl } = fixture();
  const report = await probeArc({ fetchImpl, now: fixedNow });
  assert.equal(report.status, 'PASS');
  assert.equal(report.checks.length, 6);
  assert.equal(calls.length, 7);
  for (const call of calls.filter((item) => ['eth_call', 'eth_getBalance'].includes(item.method))) {
    assert.equal(call.params[1], block.number);
  }
  assert.ok(report.notVerified.length >= 5);
  assert.equal(report.readOnly, true);
});
test('wrong chain fails before token or balance calls', async () => {
  const { calls, fetchImpl } = fixture({ chain: 1n });
  const report = await probeArc({ fetchImpl });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.error.check, 'arc.chain_id');
  assert.equal(calls.length, 1);
});
test('wrong token decimals fail closed', async () => {
  const { calls, fetchImpl } = fixture({ decimals: 18n });
  assert.equal((await probeArc({ fetchImpl })).status, 'FAIL');
  assert.equal(calls.length, 3);
});
test('inconsistent native/ERC20 balances fail closed', async () => {
  const { fetchImpl } = fixture({ erc20: 1n });
  assert.equal((await probeArc({ fetchImpl })).error.check, 'usdc.balance_relation');
});
test('network DNS error is BLOCKED, not a chain compatibility failure', async () => {
  const fetchImpl = async () => { throw new TypeError('secret URL', { cause: { code: 'EAI_AGAIN' } }); };
  const report = await probeArc({ fetchImpl, endpoint: 'https://rpc.example.com/private-token?key=secret' });
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.error.code, 'RPC_NETWORK_EAI_AGAIN');
  assert.ok(!JSON.stringify(report).includes('secret'));
});
test('timeout is BLOCKED', async () => {
  const fetchImpl = async () => { throw new DOMException('timeout', 'TimeoutError'); };
  assert.equal((await probeArc({ fetchImpl })).error.code, 'RPC_TIMEOUT');
});
test('HTTP failure does not echo provider body', async () => {
  const report = await probeArc({ fetchImpl: async () => ({ ok: false, status: 429 }) });
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.error.code, 'RPC_HTTP_429');
});
test('write and arbitrary RPC methods are blocked before fetch', async () => {
  let count = 0;
  const rpc = createReadOnlyRpc(NETWORKS.testnet.rpc, { fetchImpl: async () => { count++; } });
  for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'debug_traceCall']) {
    await assert.rejects(() => rpc(method), /METHOD_NOT_READ_ONLY/);
  }
  assert.equal(count, 0);
});
test('insecure URLs and credential-bearing URLs are rejected', () => {
  for (const url of ['http://rpc.example.com', 'https://user:pass@rpc.example.com', 'not a url', 'https://rpc.example.com/#secret']) {
    assert.throws(() => createReadOnlyRpc(url), ProbeError);
  }
});
test('unsupported environment never falls back to mainnet', async () => {
  for (const network of ['production', 'invalid', '__proto__', 'toString']) {
    await assert.rejects(() => probeArc({ network }), /UNKNOWN_NETWORK/);
  }
});
for (const bad of [null, [], { jsonrpc: '2.0', id: 999, result: '0x1' }, { jsonrpc: '1.0', id: 1, result: '0x1' }]) {
  test(`invalid RPC envelope ${JSON.stringify(bad)}`, async () => {
    const rpc = createReadOnlyRpc(NETWORKS.testnet.rpc, { fetchImpl: async () => ({ ok: true, json: async () => bad }) });
    await assert.rejects(() => rpc('eth_chainId'), /INVALID_RPC_ENVELOPE/);
  });
}
test('RPC error and missing result never pass', async () => {
  for (const body of [{ jsonrpc: '2.0', id: 1, error: { message: 'secret' } }, { jsonrpc: '2.0', id: 1 }]) {
    const rpc = createReadOnlyRpc(NETWORKS.testnet.rpc, { fetchImpl: async () => ({ ok: true, json: async () => body }) });
    await assert.rejects(() => rpc('eth_chainId'), ProbeError);
  }
});
test('malformed JSON is a probe failure', async () => {
  const report = await probeArc({ fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('bad'); } }) });
  assert.equal(report.error.code, 'INVALID_RPC_JSON');
});
test('block header change fails anchor check', async () => {
  const source = fixture();
  const fetchImpl = async (...args) => {
    const response = await source.fetchImpl(...args);
    const request = JSON.parse(args[1].body);
    if (request.method === 'eth_getBlockByNumber' && request.params[0] !== 'latest') {
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: request.id, result: { ...block, hash: `0x${'cd'.repeat(32)}` } }) };
    }
    return response;
  };
  const report = await probeArc({ fetchImpl });
  assert.equal(report.status, 'FAIL');
  assert.equal(report.error.check, 'arc.block_anchor_consistency');
});
test('mainnet is explicitly selected and still strictly read-only', async () => {
  const { calls, fetchImpl } = fixture({ chain: NETWORKS.mainnet.chainId });
  const report = await probeArc({ network: 'mainnet', fetchImpl });
  assert.equal(report.status, 'PASS');
  assert.equal(report.expectedChainId, '5042');
  assert.ok(calls.every((call) => !call.method.includes('send')));
  assert.equal(SAMPLE.length, 42);
  assert.equal(USDC.length, 42);
});
