import test from 'node:test';
import assert from 'node:assert/strict';
import { preflight } from '../../scripts/m2/cloud-preflight.mjs';
const accountId = 'a'.repeat(32), token = 'synthetic-test-token', sourceSha = 'b'.repeat(40);
const options = { accountId, token, sourceSha };
const ok = result => new Response(JSON.stringify({ success: true, result }));
test('CLOUD-01 missing configuration never sends a request', async () => {
  const r = await preflight({ fetcher: () => assert.fail('No credentials, no request') });
  assert.equal(r.status, 'BLOCKED'); assert.equal(r.cloudMutations, false);
});
test('CLOUD-02 only fixed Cloudflare GET endpoints, no redirect credential forwarding', async () => {
  const calls = [];
  const r = await preflight({ ...options, fetcher: async (url, init) => {
    calls.push(url); assert.equal(new URL(url).origin, 'https://api.cloudflare.com');
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.ok(init.signal);
    assert.equal(init.headers.Authorization, `Bearer ${token}`); assert.equal(init.body, undefined);
    return ok(url.includes('/workers/subdomain') ? { subdomain: 'synthetic' } : url.includes('/r2/') ? { buckets: [] } : []);
  }});
  assert.equal(calls.length, 5); assert.equal(r.status, 'PASS_READ_ONLY');
  assert.equal(r.sourceSha, sourceSha); assert.equal(r.publicChainWrites, false);
  assert.ok(!JSON.stringify(r).includes(token)); assert.ok(!JSON.stringify(r).includes(accountId));
});
test('CLOUD-03 permission failures retain only status and numeric codes', async () => {
  const r = await preflight({ ...options, fetcher: async () => new Response(JSON.stringify({
    success: false, errors: [{ code: 10000, message: token }, { code: token }], result: { accountId },
  }), { status: 403 }) });
  assert.equal(r.status, 'BLOCKED'); assert.equal(r.checks.length, 5);
  assert.deepEqual(r.checks[0].codes, [10000]); assert.ok(!JSON.stringify(r).includes(token));
});
test('CLOUD-04 inventory exposes only safe ArcBox names and labels pagination limits', async () => {
  const rows = [{ id: 'arcbox-web-demo', name: 'arcbox-testnet-db', queue_name: 'arcbox-jobs-testnet' },
    { id: token, name: 'unrelated-project', queue_name: '<unsafe>' }];
  const r = await preflight({ ...options, fetcher: async url => ok(url.includes('/r2/') ? { buckets: rows } : rows) });
  assert.deepEqual(r.checks.find(c => c.name === 'r2').arcboxResources, ['arcbox-testnet-db']);
  assert.ok(!JSON.stringify(r).includes('unrelated-project')); assert.ok(!JSON.stringify(r).includes(token));
  assert.equal(r.checks[1].inventory, 'FIRST_PAGE_ONLY_NOT_PROOF_OF_ABSENCE');
});
test('CLOUD-05 transport errors and non-JSON bodies cannot leak credentials', async () => {
  const r = await preflight({ ...options, fetcher: async () => { throw new Error(token); } });
  assert.equal(r.status, 'BLOCKED'); assert.ok(!JSON.stringify(r).includes(token));
  const malformed = await preflight({ ...options, fetcher: async () => new Response(token) });
  assert.equal(malformed.status, 'BLOCKED'); assert.ok(!JSON.stringify(malformed).includes(token));
});
test('CLOUD-06 HTTP 200 with API failure is not success', async () => {
  const r = await preflight({ ...options, fetcher: async () => new Response('{"success":false}') });
  assert.equal(r.status, 'BLOCKED'); assert.equal(r.checks[0].httpStatus, 200);
});

test('CLOUD-07 malformed inventory cannot be called a successful read', async () => {
  const r = await preflight({ ...options, fetcher: async () => ok(null) });
  assert.equal(r.status, 'BLOCKED');
});
