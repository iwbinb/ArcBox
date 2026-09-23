import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

mkdirSync('reports', { recursive: true });
for (const path of ['reports/m0-d-report.json', 'reports/arc-local-scenario.json']) rmSync(path, { force: true });
const report = { schemaVersion: 1, stage: 'M0-D', scope: 'DEVELOPMENT_AND_LOCAL_VERIFICATION', sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), prHeadSha: process.env.ARCBOX_PR_HEAD_SHA || null, runId: process.env.GITHUB_RUN_ID ?? null, startedAt: new Date().toISOString(), lockSha256: createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex'), status: 'IN_PROGRESS', steps: [], tests: {}, publicTestnetWrites: 'NOT_RUN_AUTHORIZATION_REQUIRED', deployed: false };
let failed = false;
for (const [name, args] of [['compile', ['scripts/m0/compile-arc.mjs']], ['guards', ['--test', '--test-reporter=tap', 'tests/arc/guards.test.mjs']], ['local-arc', ['--test', '--test-reporter=tap', 'tests/arc/local.integration.test.mjs']]]) {
  if (failed) { report.steps.push({ name, status: 'NOT_RUN' }); continue; }
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 180000, maxBuffer: 8_000_000, env: { ...process.env, CI: 'true' } });
  const text = (result.stdout ?? '') + (result.stderr ?? '');
  console.log(`--- M0-D ${name} ---\n${text}`); writeFileSync(`reports/m0-d-${name}.log`, text);
  let ok = result.status === 0 && !result.error;
  if (name !== 'compile') {
    const count = (key) => { const matches = [...text.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))]; return matches.length ? Number(matches.at(-1)[1]) : null; };
    const counts = { total: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'), cancelled: count('cancelled') };
    report.tests[name] = counts;
    ok &&= counts.total > 0 && counts.passed === counts.total && counts.failed === 0 && counts.skipped === 0 && counts.cancelled === 0;
  }
  report.steps.push({ name, status: ok ? 'PASS' : 'FAIL', exitCode: result.status, signal: result.signal, error: result.error?.code ?? null }); failed ||= !ok;
}
if (existsSync('reports/arc-local-scenario.json')) report.localScenario = JSON.parse(readFileSync('reports/arc-local-scenario.json', 'utf8'));
if (existsSync('.toolchain/arc-foundry/verified.json')) report.runtime = JSON.parse(readFileSync('.toolchain/arc-foundry/verified.json', 'utf8'));
report.status = failed ? 'FAIL' : 'PASS_LOCAL_ONLY';
report.stageAcceptance = 'BLOCKED_PUBLIC_TESTNET_WRITE_EVIDENCE';
report.notVerified = ['Authorized dedicated-wallet public-testnet deployment/approve/transfer/transferFrom/receipts', 'Public-network EOA/ERC1271 contract verification', 'Public consensus/finality edge cases', 'Hosted Cloudflare resources', 'Browser wallet/SIWE product flows', 'Production safety/audit'];
report.completedAt = new Date().toISOString();
writeFileSync('reports/m0-d-report.json', JSON.stringify(report, null, 2) + '\n');
console.log('M0_D_REPORT ' + JSON.stringify(report));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '# M0-D local development verification\n\n```json\n' + JSON.stringify(report, null, 2) + '\n```\n');
process.exitCode = failed ? 1 : 0;
