import assert from 'node:assert/strict';

export function validateManifest(pkg, lock, tc) {
  assert.equal(pkg.private, true, 'Repository must not be published as an npm package.');
  assert.equal(pkg.packageManager, `pnpm@${tc.pnpm}`);
  assert.equal(pkg.engines?.node, tc.node);
  assert.equal(pkg.engines?.pnpm, tc.pnpm);
  assert.equal(lock.lockfileVersion, '9.0');
  assert.equal(lock.settings?.autoInstallPeers, false);
  assert.deepEqual(pkg.dependencies ?? {}, {}, 'M0 probes have no product dependencies.');
  assert.deepEqual(pkg.devDependencies, tc.dependencies);
  const importer = lock.importers?.['.']?.devDependencies;
  assert.deepEqual(Object.keys(importer ?? {}).sort(), Object.keys(tc.dependencies).sort());
  for (const [name, version] of Object.entries(tc.dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must use an exact version`);
    assert.equal(importer[name].specifier, version, `${name}: manifest/lock mismatch`);
    assert.ok(lock.packages[`${name}@${version}`], `${name}: package entry missing`);
  }
  for (const [name, entry] of Object.entries(lock.packages ?? {})) {
    assert.match(entry.resolution?.integrity ?? '', /^sha512-[A-Za-z0-9+/]+={0,2}$/, `${name}: missing integrity`);
    assert.equal(entry.resolution?.tarball, undefined, `${name}: unexpected custom source`);
  }
  assert.ok(Object.keys(lock.packages ?? {}).length > 0, 'Lock must not be empty.');
}

export function validateWorkflow(workflow, pins) {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.pull_request.branches, ['main']);
  assert.deepEqual(workflow.on.push.branches, ['main', 'feat/m0-b-toolchain', 'feat/m0-c-runtime']);
  assert.equal(workflow.concurrency?.['cancel-in-progress'], true);
  assert.ok(workflow.jobs.required && workflow.jobs['arc-readonly']);
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 15);
    assert.equal(job.permissions, undefined, 'Job cannot elevate permissions.');
    assert.equal(job.environment, undefined, 'M0 local checks cannot bind a deployment environment.');
    assert.equal(job['continue-on-error'], undefined);
    assert.equal(job.needs, undefined, 'Required and network jobs must be independent.');
    for (const step of job.steps) {
      assert.equal(step['continue-on-error'], undefined);
      if (step.uses) {
        const [name, sha] = step.uses.split('@');
        assert.equal(sha, pins[name], 'External actions must match recorded full SHAs.');
        assert.match(sha, /^[0-9a-f]{40}$/);
        if (name === 'actions/checkout') assert.equal(step.with?.['persist-credentials'], false);
      }
    }
  }
  const text = JSON.stringify(workflow);
  assert.ok(!text.includes('secrets.'), 'No production/custom secrets in this workflow.');
  assert.ok(!text.includes('pull_request_target'));
  // Regression guard, not a proof that arbitrary future shell code is safe.
}
