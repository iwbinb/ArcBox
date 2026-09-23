import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const tc = JSON.parse(readFileSync('toolchain.json', 'utf8'));
assert.equal(process.versions.node, tc.node);
const run = (args) => execFileSync('pnpm', args, {
  stdio: 'inherit', timeout: 120_000,
  env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
});
rmSync('dist', { recursive: true, force: true });
run(['exec', 'vite', 'build']);
run(['build:contracts']);
// --dry-run builds locally. This command never uploads or creates cloud resources.
run(['exec', 'wrangler', 'deploy', '--dry-run', '--outdir', 'dist/worker']);
const entries = [];
function walk(path) {
  for (const name of readdirSync(path).sort()) {
    const file = join(path, name);
    if (statSync(file).isDirectory()) walk(file);
    else entries.push({ path: file.replaceAll('\\', '/'), bytes: statSync(file).size, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
  }
}
walk('dist');
assert.ok(entries.some((f) => f.path === 'dist/web/index.html'));
assert.ok(entries.some((f) => f.path === 'dist/contracts/CompilerProbe.json'));
assert.ok(entries.some((f) => f.path.startsWith('dist/worker/') && f.path.endsWith('.js')));
const report = {
  schemaVersion: 1, stage: 'M0-B', deployed: false,
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  node: process.version, toolchain: tc, files: entries,
};
mkdirSync('reports', { recursive: true });
writeFileSync('reports/build-manifest.json', JSON.stringify(report, null, 2) + '\n');
console.log('BUILD_MANIFEST ' + JSON.stringify(report));
