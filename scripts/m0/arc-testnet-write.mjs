import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { guardLive, RPC, safeJson } from '../../probes/arc/lib.mjs';

// NO default/fallback key, NO mainnet mode, NO arbitrary RPC/recipient/amount CLI.
try {
  if (process.argv.length !== 2) throw new Error('UNSUPPORTED_ARGUMENTS');
  const account = guardLive(process.env); // Authorization and address checks precede any RPC.
  mkdirSync('.toolchain/live-runs', { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(resolve('.toolchain/live-runs/run-'));
  const report = { schemaVersion: 1, stage: 'M0-D', scope: 'PUBLIC_TESTNET_WRITE', startedAt: new Date().toISOString(), sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() };
  const save = (state) => writeFileSync(join(directory, 'report.json'), safeJson(state) + '\n', { mode: 0o600 });
  console.log('TESTNET_REPORT_PATH ' + join(directory, 'report.json'));
  const { executeScenario } = await import('../../probes/arc/scenario.mjs');
  try {
    await executeScenario({ mode: 'testnet', url: RPC, account, report, save });
    console.log('ARC_PUBLIC_TESTNET_REPORT ' + safeJson(report));
  } catch {
    console.log('ARC_PUBLIC_TESTNET_REPORT ' + safeJson(report));
    process.exitCode = 1;
  }
} catch (error) {
  console.error(safeJson({ stage: 'M0-D', status: 'BLOCKED', code: ['TESTNET_AUTHORIZATION_REQUIRED', 'DEDICATED_TEST_KEY_REQUIRED', 'DEDICATED_ADDRESS_MISMATCH', 'PUBLIC_DEVELOPMENT_KEY_DENIED', 'TESTNET_ENDPOINT_REQUIRED', 'INVALID_TEST_KEY', 'UNSUPPORTED_ARGUMENTS'].includes(error.message) ? error.message : 'PREFLIGHT_FAILED', publicWrites: false }));
  process.exitCode = 2;
}
