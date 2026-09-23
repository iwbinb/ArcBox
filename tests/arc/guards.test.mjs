import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { toHex, padHex } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { amountU6, assertEndpoint, assertUnusedTestnetWallet, FeeBudget, guardLive, checkReceipt, pairedTransfers, TOKEN, SYSTEM, SCALE, TRANSFER_TOPIC, caseId, readonlyClient } from '../../probes/arc/lib.mjs';

for (const value of ['', '-1', '0', '0.0000001', '0.010001', '1e-3', ' 0.001', '01.0', 0.001]) test(`GUARD amount rejects ${JSON.stringify(value)}`, () => assert.throws(() => amountU6(value)));
test('GUARD six-decimal amounts are integer-exact', () => { assert.equal(amountU6('0.000001'), 1n); assert.equal(amountU6('0.01'), 10000n); });
test('GUARD missing explicit authorization fails before key parsing', () => assert.throws(() => guardLive({ ARCBOX_TESTNET_PRIVATE_KEY: 'never-read' }), /TESTNET_AUTHORIZATION_REQUIRED/));
test('GUARD no mainnet or arbitrary endpoint mode', () => { assert.throws(() => assertEndpoint('mainnet', 'https://rpc.mainnet.arc.io')); assert.throws(() => assertEndpoint('testnet', 'https://example.com')); });
for (const url of ['https://127.0.0.1:8545', 'http://localhost:8545', 'http://127.0.0.1:8545/path', 'http://user:secret@127.0.0.1:8545', 'http://example.com:8545']) test(`GUARD local endpoint rejects ${url.replace('secret', 'redacted')}`, () => assert.throws(() => assertEndpoint('local', url)));
test('GUARD localhost HTTP accepted without public network fallback', () => assertEndpoint('local', 'http://127.0.0.1:8545'));
test('GUARD public development wallet cannot be used on testnet', () => {
  const account = mnemonicToAccount('test test test test test test test test test test test junk');
  const key = toHex(account.getHdKey().privateKey);
  assert.throws(() => guardLive({ ARCBOX_TESTNET_CONFIRM: 'M0-D-TESTNET-ONLY', ARCBOX_TESTNET_PRIVATE_KEY: key, ARCBOX_TESTNET_EXPECTED_ADDRESS: account.address }), /PUBLIC_DEVELOPMENT_KEY_DENIED/);
});
test('GUARD dedicated expected address is mandatory', () => assert.throws(() => guardLive({ ARCBOX_TESTNET_CONFIRM: 'M0-D-TESTNET-ONLY', ARCBOX_TESTNET_PRIVATE_KEY: toHex(12345n, { size: 32 }), ARCBOX_TESTNET_EXPECTED_ADDRESS: '0x0000000000000000000000000000000000000001' }), /DEDICATED_ADDRESS_MISMATCH/));
test('GUARD low-entropy fixture key rejected even when address matches', () => {
  const key = toHex(1n, { size: 32 });
  assert.throws(() => guardLive({ ARCBOX_TESTNET_CONFIRM: 'M0-D-TESTNET-ONLY', ARCBOX_TESTNET_PRIVATE_KEY: key, ARCBOX_TESTNET_EXPECTED_ADDRESS: privateKeyToAccount(key).address }), /PUBLIC_DEVELOPMENT_KEY_DENIED/);
});
test('GUARD public testnet probe wallet can only start from unused nonce', () => {
  assertUnusedTestnetWallet(0, 0);
  assert.throws(() => assertUnusedTestnetWallet(9, 9), /TESTNET_WALLET_ALREADY_USED/);
  assert.throws(() => assertUnusedTestnetWallet(0, 1), /TESTNET_WALLET_ALREADY_USED/);
});
test('GUARD readonly transport blocks broadcast before network', async () => { await assert.rejects(readonlyClient().request({ method: 'eth_sendRawTransaction', params: ['0x'] }), /READONLY_METHOD_DENIED/); });
test('GUARD fee reservation includes unresolved transaction and exact caps', () => {
  const budget = new FeeBudget({ maxPerTx: 1000000000000000n, maxRun: 1000000000000000n, maxTransactions: 1 });
  budget.reserve(50000n, 20000000000n);
  assert.throws(() => budget.reserve(1n, 20000000000n), /UNRESOLVED/);
  budget.confirmed({ gasUsed: 50000n, effectiveGasPrice: 20000000000n });
  assert.equal(budget.spent, 1000000000000000n);
  assert.throws(() => budget.reserve(1n, 20000000000n), /LIMIT/);
});
test('GUARD under-minimum fee and over-budget transaction rejected', () => {
  assert.throws(() => new FeeBudget().reserve(21000n, 19999999999n));
  assert.throws(() => new FeeBudget().reserve(100000000n, 40000000000n));
});
const from = '0x1111111111111111111111111111111111111111';
const to = '0x2222222222222222222222222222222222222222';
function log(emitter, value, index, sender = from, recipient = to) { return { address: emitter, topics: [TRANSFER_TOPIC, padHex(sender, { size: 32 }), padHex(recipient, { size: 32 })], data: toHex(value, { size: 32 }), transactionHash: caseId(123), logIndex: index, removed: false }; }
test('LOG streams match integer scales regardless of log order', () => { const result = pairedTransfers([log(SYSTEM, 1001n * SCALE, 0), log(TOKEN, 1001n, 1)]); assert.equal(result.pairs, 1); assert.equal(result.token[0].value, 1001n); });
test('LOG repeated equal transfers require separate native counterparts', () => assert.throws(() => pairedTransfers([log(TOKEN, 2n, 0), log(TOKEN, 2n, 1), log(SYSTEM, 2n * SCALE, 2)]), /MISSING_SYSTEM/));
test('LOG zero and self transfers do not require system events', () => { assert.equal(pairedTransfers([log(TOKEN, 0n, 0), log(TOKEN, 1n, 1, from, from)]).pairs, 0); });
test('LOG wrong precision and duplicate log keys fail closed', () => { assert.throws(() => pairedTransfers([log(TOKEN, 1n, 0), log(SYSTEM, 1n, 1)])); const x = log(TOKEN, 0n, 0); assert.throws(() => pairedTransfers([x, x]), /DUPLICATE/); });
test('LOG removed or malformed logs cannot become payment evidence', () => { assert.throws(() => pairedTransfers([{ ...log(TOKEN, 0n, 0), removed: true }])); assert.throws(() => pairedTransfers([{ ...log(TOKEN, 0n, 0), data: '0x01' }])); });
const receipt = { transactionHash: caseId(123), from, to, status: 'success', blockHash: caseId(124), blockNumber: 1n, gasUsed: 21000n, effectiveGasPrice: 20000000000n, logs: [] };
test('RECEIPT matching receipt accepted, wrong payer/status/hash refused', () => {
  checkReceipt(receipt, { hash: caseId(123), from, to });
  for (const changed of [{ from: to }, { status: 'reverted' }, { transactionHash: caseId(9) }]) assert.throws(() => checkReceipt({ ...receipt, ...changed }, { hash: caseId(123), from, to }));
});
test('RECEIPT unknown or reverted transaction cannot be success', () => assert.throws(() => checkReceipt({ ...receipt, status: undefined }, { hash: caseId(123), from, to })));
test('CLI no-authorization exits BLOCKED without exposing an injected secret', () => {
  const env = { ...process.env, ARCBOX_TESTNET_CONFIRM: '', ARCBOX_TESTNET_PRIVATE_KEY: 'DO_NOT_LEAK_TEST_SENTINEL' }; delete env.NODE_TEST_CONTEXT;
  try { execFileSync(process.execPath, ['scripts/m0/arc-testnet-write.mjs'], { env, encoding: 'utf8', timeout: 15000 }); assert.fail('Must fail closed'); }
  catch (error) { assert.equal(error.status, 2); const text = String(error.stdout) + String(error.stderr); assert.match(text, /TESTNET_AUTHORIZATION_REQUIRED/); assert.ok(!text.includes('DO_NOT_LEAK_TEST_SENTINEL')); }
});
