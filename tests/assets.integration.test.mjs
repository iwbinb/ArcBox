import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createTestHarness } from 'wrangler';

// Test the built application and real Assets routing, not a mocked Fetcher.
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const server = createTestHarness({ workers: [{ config: {
  ...config,
  main: resolve('dist/worker/index.js'),
  no_bundle: true,
  assets: { ...config.assets, directory: resolve('dist/web') },
} }] });
before(async () => { await server.listen(); }, { timeout: 30_000 });
after(async () => { await server.close(); });
const navigation = { headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate' } };

async function missingApi(path, init) {
  const response = await server.fetch(path, init);
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'NOT_FOUND' });
}

test('HTTP-01 built homepage is served through the Assets binding', async () => {
  const response = await server.fetch('/', navigation);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await response.text(), /ArcBox/);
});
test('HTTP-02 non-API client navigation falls back to the SPA', async () => {
  const response = await server.fetch('/an-unmatched-client-route', navigation);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /ArcBox/);
});
test('HTTP-03 unknown API is JSON 404', async () => {
  await missingApi('/api/missing', { headers: { accept: 'application/json' } });
});
test('HTTP-04 browser navigation cannot turn an API error into HTML 200', async () => {
  await missingApi('/api/missing', navigation);
});
test('HTTP-05 bare API prefix also bypasses SPA fallback', async () => {
  await missingApi('/api', navigation);
});
test('HTTP-06 rejected API methods remain JSON 404', async () => {
  await missingApi('/api/health', { method: 'POST' });
});
test('HTTP-07 original no-funds health endpoint and probe isolation are preserved', async () => {
  const response = await server.fetch('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stage: 'M0-B', paymentsEnabled: false });
  await missingApi('/api/probe/files/secret', navigation);
  assert.doesNotMatch(readFileSync('dist/worker/index.js', 'utf8'), /probe_sessions|probe_outbox|PROBE_MODE/);
});
test('HTTP-08 built hashed JavaScript bytes match the file on disk', async () => {
  const html = readFileSync('dist/web/index.html', 'utf8');
  const path = /src="(\/assets\/[^"\s]+\.js)"/.exec(html)?.[1];
  assert.ok(path, 'Vite output must reference a hashed JS asset');
  const response = await server.fetch(path);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /javascript/);
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(readFileSync(`dist/web${path}`)));
});
