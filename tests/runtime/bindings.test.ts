import { beforeAll, expect, test } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { createExecutionContext, createMessageBatch, createScheduledController, getQueueResult, waitOnExecutionContext } from 'cloudflare:test';
import worker, { download, sha256, type ProbeEnv } from '../../probes/runtime/worker';
import { initializeSchema } from '../../probes/runtime/schema';
import { recordEvent, updateDraft, consumeEffect, dispatchOutbox, runScheduled, type ProbeEvent } from '../../probes/runtime/store';

declare module 'cloudflare:workers' { interface ProvidedEnv extends ProbeEnv {} }

// Storage is isolated per FILE, not per test. Every fixture gets unique IDs.
// No test.concurrent: broker and scheduled work is awaited before assertions.
beforeAll(async () => { await initializeSchema(env.DB); });
const id = () => crypto.randomUUID();
const event = (): ProbeEvent => ({ key: id(), scope: id(), amountU6: '9007199254740993000001' });
const n = async (sql: string, ...values: (string | number)[]) => Number(await env.DB.prepare(sql).bind(...values).first('n'));
const exists = (key: string) => n('SELECT count(*) AS n FROM probe_effects WHERE effect_key=?1', key);
const waitEffect = async (key: string) => { await expect.poll(() => exists(key), { timeout: 12_000, interval: 25 }).toBe(1); };
async function sizes(e: ProbeEvent) {
  return {
    events: await n('SELECT count(*) AS n FROM probe_events WHERE event_key=?1', e.key),
    entries: await n('SELECT count(*) AS n FROM probe_entries WHERE event_key=?1', e.key),
    outbox: await n('SELECT count(*) AS n FROM probe_outbox WHERE effect_key=?1', `event:${e.key}`),
  };
}
async function batchFor(body: unknown, name = 'm0c-jobs') {
  const messageId = id();
  const batch = createMessageBatch(name, [{ id: messageId, timestamp: new Date(), body }]);
  const context = createExecutionContext();
  await worker.queue(batch, env);
  return { messageId, result: await getQueueResult(batch, context) };
}

// D1: actual prepared statements and batch calls through the workerd binding.
test('D1-01 schema initialization is repeatable', async () => {
  await initializeSchema(env.DB);
  expect(await n("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='probe_events'")).toBe(1);
});
test('D1-02 event, exact TEXT amount and outbox commit together', async () => {
  const e = event();
  expect(await recordEvent(env.DB, e)).toBe('applied');
  expect(await sizes(e)).toEqual({ events: 1, entries: 1, outbox: 1 });
  expect(await env.DB.prepare('SELECT amount_u6 FROM probe_entries WHERE event_key=?1').bind(e.key).first('amount_u6')).toBe(e.amountU6);
  expect(BigInt(e.amountU6)).toBe(9007199254740993000001n);
});
test('D1-03 a late UNIQUE failure rolls back earlier event and entry writes', async () => {
  const e = event();
  await env.DB.prepare('INSERT INTO probe_outbox(effect_key,scope,payload) VALUES (?1,?2,?3)').bind(`event:${e.key}`, e.scope, 'conflicting-fixture').run();
  await expect(recordEvent(env.DB, e)).rejects.toThrow();
  expect(await sizes(e)).toEqual({ events: 0, entries: 0, outbox: 1 });
  await env.DB.prepare('DELETE FROM probe_outbox WHERE effect_key=?1').bind(`event:${e.key}`).run();
  expect(await recordEvent(env.DB, e)).toBe('applied');
});
test('D1-04 repeated event is a no-op, not another ledger/outbox write', async () => {
  const e = event();
  await recordEvent(env.DB, e);
  expect(await recordEvent(env.DB, e)).toBe('duplicate');
  expect(await sizes(e)).toEqual({ events: 1, entries: 1, outbox: 1 });
});
test('D1-05 concurrent duplicate events commit once', async () => {
  const e = event();
  const results = await Promise.all(Array.from({ length: 8 }, () => recordEvent(env.DB, e)));
  expect(results.filter((x) => x === 'applied')).toHaveLength(1);
  expect(results.filter((x) => x === 'duplicate')).toHaveLength(7);
  expect(await sizes(e)).toEqual({ events: 1, entries: 1, outbox: 1 });
});
test('D1-06 reused event key with altered amount or scope fails closed', async () => {
  const e = event();
  await recordEvent(env.DB, e);
  await expect(recordEvent(env.DB, { ...e, amountU6: '1' })).rejects.toThrow('EVENT_CONFLICT');
  await expect(recordEvent(env.DB, { ...e, scope: id() })).rejects.toThrow('EVENT_CONFLICT');
  expect(await sizes(e)).toEqual({ events: 1, entries: 1, outbox: 1 });
});
test('D1-07 negative control: zero affected rows does NOT roll back an unconditional later insert', async () => {
  const token = id();
  const result = await env.DB.batch([
    env.DB.prepare('UPDATE probe_drafts SET version=version+1 WHERE id=?1').bind(id()),
    env.DB.prepare('INSERT INTO probe_audit VALUES (?1,?2,1)').bind(token, 'negative-control'),
  ]);
  expect(result[0]?.meta.changes).toBe(0);
  expect(await n('SELECT count(*) AS n FROM probe_audit WHERE operation_token=?1', token)).toBe(1);
});
test('D1-08 guarded CAS miss cannot create an audit side effect', async () => {
  const key = id();
  await env.DB.prepare("INSERT INTO probe_drafts(id,version,value) VALUES (?1,0,'old')").bind(key).run();
  expect(await updateDraft(env.DB, key, 9, 'bad')).toBe(false);
  expect(await n('SELECT count(*) AS n FROM probe_audit WHERE draft_id=?1', key)).toBe(0);
  expect(await env.DB.prepare('SELECT value FROM probe_drafts WHERE id=?1').bind(key).first('value')).toBe('old');
  expect(await updateDraft(env.DB, key, 0, 'new')).toBe(true);
  expect(await updateDraft(env.DB, key, 0, 'replay')).toBe(false);
  expect(await n('SELECT count(*) AS n FROM probe_audit WHERE draft_id=?1', key)).toBe(1);
});
test('D1-09 concurrent stale-version updates have exactly one winner', async () => {
  const key = id();
  await env.DB.prepare("INSERT INTO probe_drafts(id,version,value) VALUES (?1,0,'old')").bind(key).run();
  const results = await Promise.all(['a', 'b', 'c', 'd'].map((v) => updateDraft(env.DB, key, 0, v)));
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await n('SELECT count(*) AS n FROM probe_audit WHERE draft_id=?1', key)).toBe(1);
  expect(await env.DB.prepare('SELECT version FROM probe_drafts WHERE id=?1').bind(key).first('version')).toBe(1);
});
test('D1-10 late audit error rolls back the draft CAS', async () => {
  const key = id();
  await env.DB.prepare("INSERT INTO probe_drafts(id,version,value) VALUES (?1,0,'old')").bind(key).run();
  await env.DB.prepare(`CREATE TRIGGER probe_fail_audit BEFORE INSERT ON probe_audit WHEN NEW.draft_id='${key}' BEGIN SELECT RAISE(ABORT,'TEST_FAILURE'); END`).run();
  try { await expect(updateDraft(env.DB, key, 0, 'new')).rejects.toThrow(); }
  finally { await env.DB.prepare('DROP TRIGGER probe_fail_audit').run(); }
  expect(await env.DB.prepare('SELECT version FROM probe_drafts WHERE id=?1').bind(key).first('version')).toBe(0);
  expect(await updateDraft(env.DB, key, 0, 'recovered')).toBe(true);
});
test('D1-11 malformed amount is rejected before persistence', async () => {
  const e = event();
  for (const amountU6 of ['-1', '1.5', '1e6', '01', (2n ** 256n).toString()]) {
    await expect(recordEvent(env.DB, { ...e, amountU6 })).rejects.toThrow('INVALID_AMOUNT');
  }
  expect(await sizes(e)).toEqual({ events: 0, entries: 0, outbox: 0 });
});

async function fileFixture() {
  const key = id(), tenant = id(), principal = id(), token = id() + id();
  const body = 'private M0-C fixture ' + id();
  const objectKey = `private/${tenant}/${key}/v1`;
  const expires = Date.now() + 60_000;
  await env.FILES.put(objectKey, body, { httpMetadata: { contentType: 'text/plain' }, customMetadata: { version: '1' } });
  await env.DB.batch([
    env.DB.prepare('INSERT INTO probe_sessions VALUES (?1,?2,?3,?4)').bind(await sha256(token), tenant, principal, expires),
    env.DB.prepare("INSERT INTO probe_files VALUES (?1,?2,?3,?4,'available')").bind(key, tenant, objectKey, await sha256(body)),
    env.DB.prepare('INSERT INTO probe_grants VALUES (?1,?2,?3,1)').bind(key, tenant, principal),
  ]);
  const request = () => new Request(`https://arcbox.invalid/probe/files/${key}`, { headers: { authorization: `Bearer ${token}` } });
  return { key, tenant, principal, token, body, objectKey, expires, request };
}
test('R2-01 actual put/get/head preserve bytes, metadata and SHA-256', async () => {
  const f = await fileFixture();
  expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect((await env.FILES.head(f.objectKey))?.customMetadata).toEqual({ version: '1' });
  expect(await (await env.FILES.get(f.objectKey))?.text()).toBe(f.body);
});
test('R2-02 authorized fetch streams only its private fixture, never public cache', async () => {
  const f = await fileFixture();
  const response = await exports.default.fetch(f.request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toBe('application/octet-stream');
  expect(await response.text()).toBe(f.body);
});
test('R2-03 absent, forged and exactly-expired sessions cannot read objects', async () => {
  const f = await fileFixture();
  expect((await exports.default.fetch(`https://arcbox.invalid/probe/files/${f.key}`)).status).toBe(401);
  const forged = new Request(f.request(), { headers: { authorization: `Bearer ${id() + id()}` } });
  expect((await exports.default.fetch(forged)).status).toBe(401);
  expect((await download(f.request(), env, f.key, f.expires)).status).toBe(401);
});
test('R2-04 another tenant cannot spoof principal or object key in headers/query', async () => {
  const f = await fileFixture(), token = id() + id();
  await env.DB.prepare('INSERT INTO probe_sessions VALUES (?1,?2,?3,?4)').bind(await sha256(token), id(), f.principal, f.expires).run();
  const request = new Request(`https://arcbox.invalid/probe/files/${f.key}?tenant=${f.tenant}&key=${f.objectKey}`, { headers: { authorization: `Bearer ${token}`, 'x-tenant': f.tenant, 'x-principal': f.principal } });
  const response = await exports.default.fetch(request);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'NOT_FOUND' });
});
test('R2-05 revoked entitlement prevents subsequent download despite existing R2 object', async () => {
  const f = await fileFixture();
  await env.DB.prepare('UPDATE probe_grants SET active=0 WHERE file_id=?1').bind(f.key).run();
  expect((await exports.default.fetch(f.request())).status).toBe(404);
  expect(await env.FILES.head(f.objectKey)).not.toBeNull();
});
test('R2-06 quarantined or unknown file is inaccessible', async () => {
  const f = await fileFixture();
  await env.DB.prepare("UPDATE probe_files SET state='quarantine' WHERE id=?1").bind(f.key).run();
  expect((await exports.default.fetch(f.request())).status).toBe(404);
  expect((await download(f.request(), env, id(), Date.now())).status).toBe(404);
});
test('R2-07 missing object is an explicit unavailable response, not empty success', async () => {
  const f = await fileFixture();
  await env.FILES.delete(f.objectKey);
  const response = await exports.default.fetch(f.request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'FILE_UNAVAILABLE' });
});
test('R2-08 changed content fails integrity verification without leaking bytes', async () => {
  const f = await fileFixture();
  await env.FILES.put(f.objectKey, 'tampered-content');
  const response = await exports.default.fetch(f.request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'FILE_INTEGRITY_ERROR' });
});
test('R2-09 probe disabled without explicit test-host flag', async () => {
  const response = await worker.fetch(new Request('https://arcbox.invalid/probe/files/a'), { ...env, PROBE_MODE: '' });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'PROBE_DISABLED' });
});

// Helpers assert ack/retry decisions; separate tests below use the actual broker.
test('QUE-01 valid message acks after durable effect, duplicate delivery stays once', async () => {
  const e = event(); await recordEvent(env.DB, e);
  const body = { schemaVersion: 1, effectKey: `event:${e.key}` };
  for (let i = 0; i < 2; i++) {
    const { messageId, result } = await batchFor(body);
    expect(result.explicitAcks).toContain(messageId);
    expect(result.retryMessages).toEqual([]);
  }
  expect(await exists(body.effectKey)).toBe(1);
});
test('QUE-02 unresolved dependency requests retry and never acks success', async () => {
  const { messageId, result } = await batchFor({ schemaVersion: 1, effectKey: `event:${id()}` });
  expect(result.explicitAcks).not.toContain(messageId);
  expect(result.retryMessages).toHaveLength(1);
  expect(result.retryMessages[0]).toMatchObject({ msgId: messageId, delaySeconds: 1 });
});
test('QUE-03 malformed message is durably rejected without raw body logging', async () => {
  const { messageId, result } = await batchFor({ schemaVersion: 1, effectKey: 'bad', amount: 'forged' });
  expect(result.explicitAcks).toContain(messageId);
  expect(await env.DB.prepare('SELECT reason FROM probe_dead_letters WHERE message_id=?1').bind(messageId).first('reason')).toBe('INVALID_MESSAGE');
  expect(await exists('bad')).toBe(0);
});
test('QUE-04 effect write failure rolls back inbox; retry can recover', async () => {
  const e = event(); await recordEvent(env.DB, e);
  const key = `event:${e.key}`, job = { schemaVersion: 1 as const, effectKey: key };
  await env.DB.prepare(`CREATE TRIGGER probe_fail_effect BEFORE INSERT ON probe_effects WHEN NEW.effect_key='${key}' BEGIN SELECT RAISE(ABORT,'TEST_FAILURE'); END`).run();
  try { await expect(consumeEffect(env.DB, job)).rejects.toThrow(); }
  finally { await env.DB.prepare('DROP TRIGGER probe_fail_effect').run(); }
  expect(await n('SELECT count(*) AS n FROM probe_inbox WHERE effect_key=?1', key)).toBe(0);
  expect(await consumeEffect(env.DB, job)).toBe('applied');
});
test('QUE-05 real producer binding reaches consumer and duplicate sends are idempotent', async () => {
  const e = event(); await recordEvent(env.DB, e);
  const key = `event:${e.key}`, body = { schemaVersion: 1 as const, effectKey: key };
  await env.JOBS.send(body); await env.JOBS.send(body);
  await waitEffect(key);
  await expect.poll(() => n("SELECT count(*) AS n FROM probe_deliveries WHERE effect_key=?1 AND queue_name='m0c-jobs'", key), { timeout: 12_000 }).toBe(2);
  expect(await exists(key)).toBe(1);
});
test('QUE-06 real broker retries a transient failure before effect and ack', async () => {
  const e = event(); await recordEvent(env.DB, e);
  const key = `event:${e.key}`;
  await env.DB.prepare('INSERT INTO probe_faults VALUES (?1,1)').bind(key).run();
  await env.JOBS.send({ schemaVersion: 1, effectKey: key });
  await waitEffect(key);
  expect(await n("SELECT max(attempt) AS n FROM probe_deliveries WHERE effect_key=?1 AND queue_name='m0c-jobs'", key)).toBe(2);
  expect(await n('SELECT count(*) AS n FROM probe_inbox WHERE effect_key=?1', key)).toBe(1);
});
test('QUE-07 actual broker routes exhausted retries to its dead-letter consumer', async () => {
  const e = event(); await recordEvent(env.DB, e);
  const key = `event:${e.key}`;
  await env.DB.prepare('INSERT INTO probe_faults VALUES (?1,10)').bind(key).run();
  await env.JOBS.send({ schemaVersion: 1, effectKey: key });
  await expect.poll(() => n("SELECT count(*) AS n FROM probe_dead_letters WHERE effect_key=?1 AND reason='RETRIES_EXHAUSTED'", key), { timeout: 12_000 }).toBe(1);
  expect(await n("SELECT max(attempt) AS n FROM probe_deliveries WHERE effect_key=?1 AND queue_name='m0c-jobs'", key)).toBe(3);
  expect(await exists(key)).toBe(0);
});
test('QUE-08 send failure leaves outbox pending; recovery dispatches it', async () => {
  const e = event(); await recordEvent(env.DB, e);
  await expect(dispatchOutbox(env.DB, { send: async () => { throw new Error('INJECTED_SEND_FAILURE'); } }, Date.now(), e.scope)).rejects.toThrow('INJECTED_SEND_FAILURE');
  expect(await env.DB.prepare('SELECT sent FROM probe_outbox WHERE effect_key=?1').bind(`event:${e.key}`).first('sent')).toBe(0);
  expect(await dispatchOutbox(env.DB, env.JOBS, Date.now(), e.scope)).toBe(1);
  await waitEffect(`event:${e.key}`);
});
test('QUE-09 crash after send but before sent marker safely causes redelivery', async () => {
  const e = event(); await recordEvent(env.DB, e);
  const key = `event:${e.key}`;
  await env.JOBS.send({ schemaVersion: 1, effectKey: key }); // simulate lost send acknowledgement
  await waitEffect(key);
  expect(await dispatchOutbox(env.DB, env.JOBS, Date.now(), e.scope)).toBe(1);
  await expect.poll(() => n("SELECT count(*) AS n FROM probe_deliveries WHERE effect_key=?1 AND queue_name='m0c-jobs'", key), { timeout: 12_000 }).toBe(2);
  expect(await exists(key)).toBe(1);
});
test('QUE-10 dispatch bounds and due time prevent unbounded/early sends', async () => {
  const scope = id(), now = Date.now(), keys = [id(), id(), id()];
  for (const key of keys) await env.DB.prepare('INSERT INTO probe_outbox(effect_key,scope,payload,due_at) VALUES (?1,?2,?3,?4)').bind(key, scope, key, now).run();
  expect(await dispatchOutbox(env.DB, env.JOBS, now - 1, scope, 2)).toBe(0);
  expect(await dispatchOutbox(env.DB, env.JOBS, now, scope, 2)).toBe(2);
  expect(await n('SELECT count(*) AS n FROM probe_outbox WHERE scope=?1 AND sent=0', scope)).toBe(1);
  expect(await dispatchOutbox(env.DB, env.JOBS, now, scope, 2)).toBe(1);
  for (const key of keys) await waitEffect(key);
  await expect(dispatchOutbox(env.DB, env.JOBS, now, scope, 21)).rejects.toThrow('INVALID_DISPATCH_BOUND');
});

async function scheduled(time: number) {
  const context = createExecutionContext();
  worker.scheduled(createScheduledController({ scheduledTime: new Date(time), cron: '* * * * *' }), env, context);
  await waitOnExecutionContext(context);
}
test('SCH-01 scheduled handler honors exact due time and waits for outbox dispatch', async () => {
  const key = id();
  await env.DB.prepare('INSERT INTO probe_due VALUES (?1,?2,2000)').bind(key, env.SCHEDULE_SCOPE).run();
  await scheduled(1999);
  expect(await n('SELECT count(*) AS n FROM probe_outbox WHERE effect_key=?1', `due:${key}`)).toBe(0);
  await scheduled(2000);
  await waitEffect(`due:${key}`);
});
test('SCH-02 repeated and delayed scheduled events produce one durable effect', async () => {
  const key = id();
  await env.DB.prepare('INSERT INTO probe_due VALUES (?1,?2,3000)').bind(key, env.SCHEDULE_SCOPE).run();
  await scheduled(30_000); await scheduled(30_000); await scheduled(40_000);
  await waitEffect(`due:${key}`);
  expect(await n('SELECT count(*) AS n FROM probe_outbox WHERE effect_key=?1', `due:${key}`)).toBe(1);
  expect(await n('SELECT count(*) AS n FROM probe_inbox WHERE effect_key=?1', `due:${key}`)).toBe(1);
});
test('SCH-03 failed scheduling send can be replayed without losing the due item', async () => {
  const key = id(), scope = id();
  await env.DB.prepare('INSERT INTO probe_due VALUES (?1,?2,1000)').bind(key, scope).run();
  await expect(runScheduled(env.DB, { send: async () => { throw new Error('SEND_UNAVAILABLE'); } }, 2000, scope)).rejects.toThrow('SEND_UNAVAILABLE');
  expect(await env.DB.prepare('SELECT sent FROM probe_outbox WHERE effect_key=?1').bind(`due:${key}`).first('sent')).toBe(0);
  await runScheduled(env.DB, env.JOBS, 3000, scope);
  await waitEffect(`due:${key}`);
});
