import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

rmSync('reports', { recursive: true, force: true });
mkdirSync('reports', { recursive: true });
const report = {
  schemaVersion: 2, stage: 'M0-C', startedAt: new Date().toISOString(),
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  event: process.env.GITHUB_EVENT_NAME ?? 'local', triggerSha: process.env.GITHUB_SHA ?? null,
  prHeadSha: process.env.ARCBOX_PR_HEAD_SHA || null, runId: process.env.GITHUB_RUN_ID ?? null,
  node: process.version, lockSha256: createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex'),
  status: 'IN_PROGRESS', steps: [], tests: {}, deployed: false,
};
let failed = false;
const commands = [
  ['static-and-types', 'check'], ['unit-and-negative-controls', 'test:unit'],
  ['builds', 'build'], ['workerd-smoke', 'test:runtime'],
  ['workerd-bindings', 'test:bindings'], ['assets-routing', 'test:assets'],
];
for (const [name, command] of commands) {
  if (failed) { report.steps.push({ name, status: 'NOT_RUN', reason: 'earlier required step failed' }); continue; }
  const started = Date.now();
  const result = spawnSync('pnpm', [command], { encoding: 'utf8', timeout: 180_000, maxBuffer: 8_000_000, env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } });
  const text = (result.stdout ?? '') + (result.stderr ?? '');
  console.log(`\n--- ${name} ---\n${text}`);
  writeFileSync(`reports/${name}.log`, text);
  let ok = result.status === 0 && !result.error;
  let reportError = null;
  try {
    if (command === 'test:unit' || command === 'test:assets') {
      const count = (key) => { const matches = [...text.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))]; return matches.length ? Number(matches.at(-1)[1]) : null; };
      const counts = { total: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped') };
      report.tests[command === 'test:unit' ? 'node' : 'assets'] = counts;
      if (ok && !(counts.total > 0 && counts.passed === counts.total && counts.failed === 0 && counts.skipped === 0)) throw new Error('INVALID_NODE_TEST_TOTALS');
    }
    if (command === 'test:runtime' || command === 'test:bindings') {
      const filename = command === 'test:runtime' ? 'reports/runtime-tests.json' : 'reports/bindings-tests.json';
      if (!existsSync(filename)) throw new Error('MISSING_RUNTIME_REPORT');
      const runtime = JSON.parse(readFileSync(filename, 'utf8'));
      const counts = { total: runtime.numTotalTests, passed: runtime.numPassedTests, failed: runtime.numFailedTests, pending: runtime.numPendingTests };
      report.tests[command === 'test:runtime' ? 'workerd' : 'bindings'] = counts;
      if (command === 'test:bindings') {
        report.bindingCases = (runtime.testResults ?? []).flatMap((file) => (file.assertionResults ?? []).map((test) => ({ name: test.fullName, status: test.status })));
      }
      if (ok && !(runtime.numTotalTests > 0 && runtime.numPassedTests === runtime.numTotalTests && runtime.numFailedTests === 0 && runtime.numPendingTests === 0)) throw new Error('INVALID_RUNTIME_TEST_TOTALS');
    }
  } catch (error) { ok = false; reportError = error.message; }
  report.steps.push({ name, status: ok ? 'PASS' : 'FAIL', exitCode: result.status, signal: result.signal, error: result.error?.code ?? reportError, durationMs: Date.now() - started });
  failed ||= !ok;
}
report.status = failed ? 'FAIL' : 'PASS';
report.completedAt = new Date().toISOString();
report.notVerified = ['Cloudflare hosted D1/R2/Queues, quotas and S3 presigned URLs', 'Production SIWE/RBAC/file security and chain event validation', 'M0-D signed transactions and EVM execution', 'Production readiness or contract security'];
writeFileSync('reports/m0-c-report.json', JSON.stringify(report, null, 2) + '\n');
console.log('M0_C_REPORT ' + JSON.stringify(report));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '# M0-C local runtime verification\n\n```json\n' + JSON.stringify(report, null, 2) + '\n```\n');
process.exitCode = failed ? 1 : 0;
