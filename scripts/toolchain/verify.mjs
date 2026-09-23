import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Remove only generated local reports, so an old result cannot satisfy this run.
rmSync('reports', { recursive: true, force: true });
mkdirSync('reports', { recursive: true });
const report = {
  schemaVersion: 1, stage: 'M0-B', startedAt: new Date().toISOString(),
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  event: process.env.GITHUB_EVENT_NAME ?? 'local', triggerSha: process.env.GITHUB_SHA ?? null,
  prHeadSha: process.env.ARCBOX_PR_HEAD_SHA || null, runId: process.env.GITHUB_RUN_ID ?? null,
  node: process.version, lockSha256: createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex'),
  status: 'IN_PROGRESS', steps: [], tests: {}, deployed: false,
};
let failed = false;
const commands = [['static-and-types', 'check'], ['unit-and-negative-controls', 'test:unit'], ['builds', 'build'], ['workerd-smoke', 'test:runtime']];
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
    if (command === 'test:unit') {
      const count = (key) => { const matches = [...text.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))]; return matches.length ? Number(matches.at(-1)[1]) : null; };
      report.tests.node = { total: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped') };
      if (ok && !(report.tests.node.total > 0 && report.tests.node.passed === report.tests.node.total && report.tests.node.failed === 0 && report.tests.node.skipped === 0)) throw new Error('INVALID_NODE_TEST_TOTALS');
    }
    if (command === 'test:runtime') {
      if (!existsSync('reports/runtime-tests.json')) throw new Error('MISSING_RUNTIME_REPORT');
      const runtime = JSON.parse(readFileSync('reports/runtime-tests.json', 'utf8'));
      report.tests.workerd = { total: runtime.numTotalTests, passed: runtime.numPassedTests, failed: runtime.numFailedTests, pending: runtime.numPendingTests };
      if (ok && !(runtime.numTotalTests > 0 && runtime.numPassedTests === runtime.numTotalTests && runtime.numFailedTests === 0 && runtime.numPendingTests === 0)) throw new Error('INVALID_RUNTIME_TEST_TOTALS');
    }
  } catch (error) { ok = false; reportError = error.message; }
  report.steps.push({ name, status: ok ? 'PASS' : 'FAIL', exitCode: result.status, signal: result.signal, error: result.error?.code ?? reportError, durationMs: Date.now() - started });
  failed ||= !ok;
}
report.status = failed ? 'FAIL' : 'PASS';
report.completedAt = new Date().toISOString();
report.notVerified = ['M0-C D1/R2/Queues semantics', 'M0-D signed transactions and EVM execution', 'Cloudflare cloud resources', 'Production readiness or contract security'];
writeFileSync('reports/m0-b-report.json', JSON.stringify(report, null, 2) + '\n');
console.log('M0_B_REPORT ' + JSON.stringify(report));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '# M0-B required verification\n\n```json\n' + JSON.stringify(report, null, 2) + '\n```\n');
process.exitCode = failed ? 1 : 0;
