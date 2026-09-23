import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { validateManifest, validateWorkflow } from './policy.mjs';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const tc = readJson('toolchain.json');
assert.equal(process.versions.node, tc.node, 'Use the exact .node-version runtime.');
assert.equal(readFileSync('.node-version', 'utf8').trim(), tc.node);
assert.equal(readFileSync('.nvmrc', 'utf8').trim(), tc.node);
const pnpmVersion = execFileSync('pnpm', ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim();
assert.equal(pnpmVersion, tc.pnpm);
const pkg = readJson('package.json');
validateManifest(pkg, parse(readFileSync('pnpm-lock.yaml', 'utf8')), tc);
const workspace = parse(readFileSync('pnpm-workspace.yaml', 'utf8'));
assert.equal(workspace.strictPeerDependencies, true);
assert.equal(workspace.autoInstallPeers, false);
assert.deepEqual(workspace.onlyBuiltDependencies, ['esbuild', 'workerd']);
for (const [name, version] of Object.entries(tc.dependencies)) {
  assert.equal(readJson(`node_modules/${name}/package.json`).version, version, `${name} installed version drift`);
}
validateWorkflow(parse(readFileSync('.github/workflows/ci.yml', 'utf8')), tc.actions);
assert.equal(existsSync('.github/workflows/m0-bootstrap.yml'), false, 'Temporary resolver must be removed.');
const config = readJson('wrangler.jsonc');
assert.equal(config.compatibility_date, tc.compatibilityDate);
assert.equal(config.workers_dev, false);
assert.equal(config.preview_urls, false);
assert.equal(config.send_metrics, false);
for (const key of ['account_id', 'routes', 'd1_databases', 'r2_buckets', 'queues', 'triggers', 'env']) {
  assert.equal(config[key], undefined, `M0-B must not configure ${key}`);
}
const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const path of paths) {
  assert.ok(!/(^|\/)(node_modules|dist|reports|\.wrangler)\//.test(path), `Generated file tracked: ${path}`);
  assert.ok(!/(^|\/)(\.env(?:\..*)?|\.dev\.vars(?:\..*)?)$/.test(path) || /\.example$/.test(path), `Secret file tracked: ${path}`);
  if (path.endsWith('.mjs')) execFileSync(process.execPath, ['--check', path], { stdio: 'pipe', timeout: 10_000 });
}
for (const path of ['.env', '.env.production', '.dev.vars', 'workers/api/.dev.vars', 'dist/a.js', 'reports/result.json', 'node_modules/a', 'key.pem']) {
  execFileSync('git', ['check-ignore', '--quiet', '--no-index', path], { stdio: 'pipe' });
}
execFileSync('git', ['diff', '--check'], { stdio: 'pipe' });
console.log(`STATIC_CHECK_PASS node=${tc.node} pnpm=${tc.pnpm} pinnedPackages=${Object.keys(tc.dependencies).length}`);
