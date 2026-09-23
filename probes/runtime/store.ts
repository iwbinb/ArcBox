/** Local semantic probes, not public APIs or verified chain-event ingestion. */
export interface ProbeEvent { key: string; scope: string; amountU6: string }
export interface ProbeMessage { schemaVersion: 1; effectKey: string }
export interface OutboxRow { effect_key: string; payload: string }

export function message(value: unknown): ProbeMessage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const x = value as Record<string, unknown>;
  if (Object.keys(x).sort().join(',') !== 'effectKey,schemaVersion') return null;
  if (x.schemaVersion !== 1 || typeof x.effectKey !== 'string' || !/^[a-zA-Z0-9:_-]{1,160}$/.test(x.effectKey)) return null;
  return { schemaVersion: 1, effectKey: x.effectKey };
}

export async function recordEvent(db: D1Database, event: ProbeEvent): Promise<'applied' | 'duplicate'> {
  if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(event.key) || !/^[a-zA-Z0-9:_-]{1,100}$/.test(event.scope)) throw new Error('INVALID_EVENT_ID');
  if (!/^(0|[1-9][0-9]{0,77})$/.test(event.amountU6) || BigInt(event.amountU6) >= 2n ** 256n) throw new Error('INVALID_AMOUNT');
  const payload = JSON.stringify([event.scope, event.key, event.amountU6]);
  try {
    // The unique event insert is a transactional gate, not INSERT OR IGNORE.
    await db.batch([
      db.prepare('INSERT INTO probe_events VALUES (?1,?2,?3)').bind(event.key, event.scope, payload),
      db.prepare('INSERT INTO probe_entries VALUES (?1,?2)').bind(event.key, event.amountU6),
      db.prepare('INSERT INTO probe_outbox(effect_key,scope,payload) VALUES (?1,?2,?3)').bind(`event:${event.key}`, event.scope, payload),
    ]);
    return 'applied';
  } catch (error) {
    const old = await db.prepare('SELECT payload FROM probe_events WHERE event_key=?1').bind(event.key).first<{ payload: string }>();
    if (old?.payload === payload) return 'duplicate';
    if (old) throw new Error('EVENT_CONFLICT');
    throw error; // Never reinterpret another failed SQL statement as a duplicate.
  }
}

export async function updateDraft(db: D1Database, id: string, expectedVersion: number, value: string): Promise<boolean> {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error('INVALID_VERSION');
  // Internally generated token cannot be supplied/replayed by the caller.
  const operation = crypto.randomUUID();
  const result = await db.batch([
    db.prepare('UPDATE probe_drafts SET value=?1, version=version+1, operation_token=?2 WHERE id=?3 AND version=?4').bind(value, operation, id, expectedVersion),
    db.prepare('INSERT INTO probe_audit SELECT ?1,id,version FROM probe_drafts WHERE id=?2 AND operation_token=?1 AND version=?3').bind(operation, id, expectedVersion + 1),
  ]);
  return result[0]?.meta.changes === 1;
}

export async function consumeEffect(db: D1Database, job: ProbeMessage): Promise<'applied' | 'duplicate'> {
  const outbox = await db.prepare('SELECT effect_key,payload FROM probe_outbox WHERE effect_key=?1').bind(job.effectKey).first<OutboxRow>();
  if (!outbox) throw new Error('DEPENDENCY_NOT_READY');
  try {
    await db.batch([
      db.prepare('INSERT INTO probe_inbox VALUES (?1,?2)').bind(job.effectKey, outbox.payload),
      db.prepare('INSERT INTO probe_effects VALUES (?1,?2)').bind(job.effectKey, outbox.payload),
    ]);
    return 'applied';
  } catch (error) {
    const previous = await db.prepare('SELECT payload FROM probe_inbox WHERE effect_key=?1').bind(job.effectKey).first<{ payload: string }>();
    if (previous?.payload === outbox.payload) return 'duplicate';
    if (previous) throw new Error('EFFECT_CONFLICT');
    throw error;
  }
}

export async function dispatchOutbox(db: D1Database, queue: Pick<Queue<ProbeMessage>, 'send'>, now: number, scope: string, limit = 20): Promise<number> {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error('INVALID_DISPATCH_BOUND');
  const rows = await db.prepare('SELECT effect_key,payload FROM probe_outbox WHERE scope=?1 AND sent=0 AND due_at<=?2 ORDER BY due_at,effect_key LIMIT ?3').bind(scope, now, limit).all<OutboxRow>();
  let sent = 0;
  for (const row of rows.results) {
    await queue.send({ schemaVersion: 1, effectKey: row.effect_key });
    // A crash between send and this update deliberately permits redelivery.
    await db.prepare('UPDATE probe_outbox SET sent=1 WHERE effect_key=?1').bind(row.effect_key).run();
    sent++;
  }
  return sent;
}

export async function runScheduled(db: D1Database, queue: Pick<Queue<ProbeMessage>, 'send'>, now: number, scope: string): Promise<void> {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('INVALID_SCHEDULE_TIME');
  // Bounded scan. Repeated or delayed triggers only create one outbox row per job.
  await db.prepare(`INSERT INTO probe_outbox(effect_key,scope,payload,due_at)
    SELECT 'due:'||id,scope,json_object('jobId',id,'dueAt',due_at),due_at FROM probe_due
    WHERE scope=?1 AND due_at<=?2 AND NOT EXISTS(SELECT 1 FROM probe_outbox WHERE effect_key='due:'||probe_due.id)
    ORDER BY due_at,id LIMIT 20 ON CONFLICT(effect_key) DO NOTHING`).bind(scope, now).run();
  await dispatchOutbox(db, queue, now, scope);
}
