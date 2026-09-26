import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.cloudflare.com/client/v4';
const SHA = /^[a-f0-9]{40}$/;
const NAME = /^arcbox[-_][a-z0-9_-]{1,100}$/;

// Metadata only. Credentials go only to the fixed Cloudflare API, never to reports.
export async function preflight({ accountId = '', token = '', sourceSha = '', fetcher = fetch } = {}) {
  const report = {
    schemaVersion: 1, stage: 'M2-D', scope: 'CLOUDFLARE_READ_ONLY_PREFLIGHT',
    sourceSha: SHA.test(sourceSha) ? sourceSha : null,
    checkedAt: new Date().toISOString(), status: 'BLOCKED',
    credentialsPresent: Boolean(accountId && token), accountFingerprint: null,
    cloudMutations: false, publicChainWrites: false, checks: [],
    note: 'Successful reads do not prove write permission, available quota, billing approval or completed deployment.',
  };
  if (!/^[a-f0-9]{32}$/i.test(accountId) || !token.trim()) {
    report.checks.push({ name: 'credentials', status: 'BLOCKED', code: 'MISSING_OR_INVALID_CLOUDFLARE_CONFIGURATION' });
    return report;
  }
  report.accountFingerprint = createHash('sha256').update(accountId).digest('hex').slice(0, 12);
  const base = `/accounts/${accountId}`;
  const routes = [
    { name: 'workers-subdomain', path: `${base}/workers/subdomain`, pick: data => subdomain(data) },
    { name: 'workers', path: `${base}/workers/scripts`, pick: data => ({ arcboxResources: resources(data, 'id') }) },
    { name: 'd1', path: `${base}/d1/database?per_page=100`, pick: data => ({ arcboxResources: resources(data, 'name') }) },
    { name: 'r2', path: `${base}/r2/buckets?per_page=100`, pick: data => ({ arcboxResources: resources(data?.buckets, 'name') }) },
    { name: 'queues', path: `${base}/queues?per_page=100`, pick: data => ({ arcboxResources: resources(data, 'queue_name') }) },
  ];
  for (const route of routes) {
    try {
      const response = await fetcher(API + route.path, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      // Do not print error bodies, resource IDs, token identifiers or request headers.
      const raw = await response.text();
      if (raw.length > 2_000_000) throw new Error('BODY_TOO_LARGE');
      let data;
      try { data = JSON.parse(raw); } catch { data = null; }
      const codes = Array.isArray(data?.errors)
        ? data.errors.filter(e => Number.isSafeInteger(e?.code)).map(e => e.code).slice(0, 5) : [];
      if (!response.ok || data?.success !== true) {
        report.checks.push({ name: route.name, status: 'BLOCKED', httpStatus: response.status, codes });
        continue;
      }
      report.checks.push({ name: route.name, status: 'PASS', httpStatus: response.status,
        inventory: 'FIRST_PAGE_ONLY_NOT_PROOF_OF_ABSENCE', ...route.pick(data.result) });
    } catch {
      report.checks.push({ name: route.name, status: 'BLOCKED', code: 'READ_TRANSPORT_OR_RESPONSE_FAILURE' });
    }
  }
  if (report.checks.every(check => check.status === 'PASS')) report.status = 'PASS_READ_ONLY';
  return report;
}
function subdomain(data) {
  if (typeof data?.subdomain !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(data.subdomain)) {
    throw new Error('INVALID_SUBDOMAIN');
  }
  return { configured: true };
}
function resources(rows, field) {
  if (!Array.isArray(rows)) throw new Error('INVALID_INVENTORY');
  return [...new Set(rows.map(row => row?.[field]).filter(value => typeof value === 'string' && NAME.test(value)))].slice(0, 100);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await preflight({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN, sourceSha: process.env.GITHUB_SHA });
  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/m2-d-preflight.json', JSON.stringify(report, null, 2) + '\n');
  console.log('M2D_PREFLIGHT ' + JSON.stringify(report));
  if (report.status !== 'PASS_READ_ONLY') process.exitCode = 2;
}
