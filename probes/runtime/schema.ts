/** Synthetic M0-C storage only. Not a production migration or payment ledger. */
export const schema = [
  `CREATE TABLE IF NOT EXISTS probe_events (event_key TEXT PRIMARY KEY, scope TEXT NOT NULL, payload TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS probe_entries (event_key TEXT PRIMARY KEY REFERENCES probe_events(event_key), amount_u6 TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS probe_outbox (effect_key TEXT PRIMARY KEY, scope TEXT NOT NULL, payload TEXT NOT NULL, due_at INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0 CHECK(sent IN (0,1)))`,
  `CREATE INDEX IF NOT EXISTS probe_outbox_pending ON probe_outbox(scope,sent,due_at,effect_key)`,
  `CREATE TABLE IF NOT EXISTS probe_drafts (id TEXT PRIMARY KEY, version INTEGER NOT NULL, value TEXT NOT NULL, operation_token TEXT)`,
  `CREATE TABLE IF NOT EXISTS probe_audit (operation_token TEXT PRIMARY KEY, draft_id TEXT NOT NULL, version INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS probe_inbox (effect_key TEXT PRIMARY KEY, payload TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS probe_effects (effect_key TEXT PRIMARY KEY REFERENCES probe_inbox(effect_key), value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS probe_faults (effect_key TEXT PRIMARY KEY, remaining INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS probe_deliveries (message_id TEXT NOT NULL, attempt INTEGER NOT NULL, queue_name TEXT NOT NULL, effect_key TEXT, PRIMARY KEY(message_id,attempt,queue_name))`,
  `CREATE TABLE IF NOT EXISTS probe_dead_letters (message_id TEXT PRIMARY KEY, effect_key TEXT, reason TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS probe_due (id TEXT PRIMARY KEY, scope TEXT NOT NULL, due_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS probe_sessions (token_hash TEXT PRIMARY KEY, tenant TEXT NOT NULL, principal TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS probe_files (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, object_key TEXT NOT NULL, sha256 TEXT NOT NULL, state TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS probe_grants (file_id TEXT NOT NULL, tenant TEXT NOT NULL, principal TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)), PRIMARY KEY(file_id,tenant,principal))`,
] as const;

export async function initializeSchema(db: D1Database): Promise<void> {
  await db.batch(schema.map((sql) => db.prepare(sql)));
}
