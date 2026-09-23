import { consumeEffect, message, runScheduled, type ProbeMessage } from './store';

export interface ProbeEnv {
  DB: D1Database;
  FILES: R2Bucket;
  JOBS: Queue<ProbeMessage>;
  PROBE_MODE: string;
  SCHEDULE_SCOPE: string;
}

export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const privateHeaders = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
function json(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: privateHeaders });
}

// Tiny fixtures only: whole-object hashing here is not a production large-file design.
export async function download(request: Request, env: ProbeEnv, fileId: string, now: number): Promise<Response> {
  const token = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return json(401, 'AUTH_REQUIRED');
  const session = await env.DB.prepare('SELECT tenant,principal FROM probe_sessions WHERE token_hash=?1 AND expires_at>?2').bind(await sha256(token), now).first<{ tenant: string; principal: string }>();
  if (!session) return json(401, 'AUTH_REQUIRED');
  // Never accept a user-supplied tenant, principal or object key as authorization.
  const file = await env.DB.prepare(`SELECT f.object_key,f.sha256 FROM probe_files f JOIN probe_grants g ON g.file_id=f.id AND g.tenant=f.tenant
    WHERE f.id=?1 AND f.tenant=?2 AND g.principal=?3 AND g.active=1 AND f.state='available'`).bind(fileId, session.tenant, session.principal).first<{ object_key: string; sha256: string }>();
  if (!file) return json(404, 'NOT_FOUND');
  const object = await env.FILES.get(file.object_key);
  if (!object) return json(503, 'FILE_UNAVAILABLE');
  const bytes = await object.arrayBuffer();
  if (await sha256(bytes) !== file.sha256) return json(503, 'FILE_INTEGRITY_ERROR');
  return new Response(bytes, { headers: { ...privateHeaders, 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="probe.bin"' } });
}

export async function handleQueue(batch: MessageBatch<unknown>, env: ProbeEnv): Promise<void> {
  if (env.PROBE_MODE !== 'local-test') throw new Error('PROBE_DISABLED');
  if (batch.queue !== 'm0c-jobs' && batch.queue !== 'm0c-dead') throw new Error('UNKNOWN_QUEUE');
  for (const item of batch.messages) {
    const job = message(item.body);
    try {
      await env.DB.prepare('INSERT OR IGNORE INTO probe_deliveries VALUES (?1,?2,?3,?4)').bind(item.id, item.attempts, batch.queue, job?.effectKey ?? null).run();
      if (batch.queue === 'm0c-dead' || !job) {
        // Persist rejection/dead letter before ack; never log raw message contents.
        await env.DB.prepare('INSERT OR IGNORE INTO probe_dead_letters VALUES (?1,?2,?3)').bind(item.id, job?.effectKey ?? null, job ? 'RETRIES_EXHAUSTED' : 'INVALID_MESSAGE').run();
      } else {
        // Test-only fault injection is private fixture state, not a public request flag.
        const fault = await env.DB.prepare('UPDATE probe_faults SET remaining=remaining-1 WHERE effect_key=?1 AND remaining>0 RETURNING remaining').bind(job.effectKey).first();
        if (fault) throw new Error('INJECTED_STORAGE_FAILURE');
        await consumeEffect(env.DB, job);
      }
      item.ack();
    } catch {
      // Real runtime retry signal; broker limits/DLQ are configured in the test host.
      item.retry({ delaySeconds: 1 });
    }
  }
}

export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    if (env.PROBE_MODE !== 'local-test') return json(503, 'PROBE_DISABLED');
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && /^\/probe\/files\/[a-zA-Z0-9_-]+$/.test(path)) {
      try { return await download(request, env, path.slice('/probe/files/'.length), Date.now()); }
      catch { return json(503, 'STORAGE_UNAVAILABLE'); }
    }
    return json(404, 'NOT_FOUND');
  },
  async queue(batch: MessageBatch<unknown>, env: ProbeEnv): Promise<void> {
    await handleQueue(batch, env);
  },
  scheduled(controller: ScheduledController, env: ProbeEnv, context: ExecutionContext): void {
    if (env.PROBE_MODE !== 'local-test') throw new Error('PROBE_DISABLED');
    context.waitUntil(runScheduled(env.DB, env.JOBS, controller.scheduledTime, env.SCHEDULE_SCOPE));
  },
} satisfies ExportedHandler<ProbeEnv>;
