import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { validateManifest, validateWorkflow } from '../scripts/toolchain/policy.mjs';
import { compileProbe } from '../scripts/toolchain/compile-contract.mjs';

const tc = JSON.parse(readFileSync('toolchain.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = parse(readFileSync('pnpm-lock.yaml', 'utf8'));
const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const clone = (x) => structuredClone(x);

test('manifest, exact dependency set and committed lock agree', () => validateManifest(pkg, lock, tc));
test('floating dependency ranges are rejected', () => {
  const p = clone(pkg); p.devDependencies.vite = '^7.3.6';
  assert.throws(() => validateManifest(p, lock, tc));
});
test('lock specifier drift is rejected', () => {
  const l = clone(lock); l.importers['.'].devDependencies.vite.specifier = '7.0.0';
  assert.throws(() => validateManifest(pkg, l, tc));
});
test('missing registry integrity is rejected', () => {
  const l = clone(lock); l.packages['vite@7.3.6'].resolution.integrity = '';
  assert.throws(() => validateManifest(pkg, l, tc));
});
test('runtime drift is rejected', () => {
  const p = clone(pkg); p.engines.node = '>=22';
  assert.throws(() => validateManifest(p, lock, tc));
});
test('workflow has bounded independent read-only jobs and SHA-pinned actions', () => validateWorkflow(workflow, tc.actions));
test('repository write permission is rejected', () => {
  const w = clone(workflow); w.permissions.contents = 'write';
  assert.throws(() => validateWorkflow(w, tc.actions));
});
test('floating external action tag is rejected', () => {
  const w = clone(workflow); w.jobs.required.steps[0].uses = 'actions/checkout@v6';
  assert.throws(() => validateWorkflow(w, tc.actions));
});
test('persisted checkout credentials are rejected', () => {
  const w = clone(workflow); w.jobs.required.steps[0].with['persist-credentials'] = true;
  assert.throws(() => validateWorkflow(w, tc.actions));
});
test('network job cannot gate required checks', () => {
  const w = clone(workflow); w.jobs.required.needs = 'arc-readonly';
  assert.throws(() => validateWorkflow(w, tc.actions));
});
test('swallowed CI failures are rejected', () => {
  const w = clone(workflow); w.jobs.required['continue-on-error'] = true;
  assert.throws(() => validateWorkflow(w, tc.actions));
});
test('production secrets and deployment environment are rejected', () => {
  const w = clone(workflow); w.jobs.required.environment = 'production';
  assert.throws(() => validateWorkflow(w, tc.actions));
});
test('scheduled / privileged PR triggers are rejected', () => {
  const w = clone(workflow); w.on.pull_request_target = {};
  assert.throws(() => validateWorkflow(w, tc.actions));
});
test('excessive job timeout is rejected', () => {
  const w = clone(workflow); w.jobs.required['timeout-minutes'] = 360;
  assert.throws(() => validateWorkflow(w, tc.actions));
});
test('pinned Solidity compiler produces ABI and bytecode', () => {
  const result = compileProbe(readFileSync('contracts/probes/CompilerProbe.sol', 'utf8'), tc.solidity);
  assert.match(result.compiler, /^0\.8\.37\+commit\./);
  assert.ok(result.abi.some((entry) => entry.name === 'schemaVersion'));
  assert.ok(result.evm.bytecode.object.length > 0);
});
test('Solidity compiler errors do not masquerade as successful JSON output', () => {
  assert.throws(() => compileProbe('pragma solidity 0.8.37; contract CompilerProbe { invalid syntax }', tc.solidity), /SOLIDITY_COMPILE_FAILED/);
});

function temporary(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'arcbox-negative-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function failure(command, args, options = {}) {
  const env = { ...process.env, ...options.env };
  // A separate node --test process must not inherit the parent's child-v8 context.
  // Otherwise Node skips recursive test discovery and can return zero without tests.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000, ...options, env });
  assert.equal(result.error, undefined, 'Must fail for the intended reason, not a timeout or missing tool.');
  assert.notEqual(result.status, 0);
  assert.notEqual(result.status, null);
  return result.stdout + result.stderr;
}
test('negative control: TypeScript type error returns nonzero', () => temporary((dir) => {
  const path = join(dir, 'bad.ts'); writeFileSync(path, 'const value: number = "wrong"; export { value };\n');
  const out = failure(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--noEmit', '--skipLibCheck', '--strict', path]);
  assert.match(out, /TS2322/);
}));
test('negative control: a failing Node assertion returns nonzero', () => temporary((dir) => {
  const path = join(dir, 'bad.test.mjs');
  writeFileSync(path, "import test from 'node:test'; import assert from 'node:assert/strict'; test('intentional',()=>assert.equal(1,2));\n");
  const out = failure(process.execPath, ['--test', '--test-reporter=tap', path]);
  assert.match(out, /# tests 1/);
  assert.match(out, /# fail 1/);
  assert.match(out, /# skipped 0/);
}));
test('negative control: stale lockfile fails frozen offline installation', () => temporary((dir) => {
  const stale = clone(pkg); stale.devDependencies.vite = '0.0.0';
  writeFileSync(join(dir, 'package.json'), JSON.stringify(stale));
  writeFileSync(join(dir, 'pnpm-lock.yaml'), readFileSync('pnpm-lock.yaml'));
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), readFileSync('pnpm-workspace.yaml'));
  const out = failure('pnpm', ['install', '--frozen-lockfile', '--offline', '--ignore-scripts', '--lockfile-only'], { cwd: dir, env: { ...process.env, CI: 'true' } });
  assert.match(out, /ERR_PNPM_OUTDATED_LOCKFILE/);
}));
