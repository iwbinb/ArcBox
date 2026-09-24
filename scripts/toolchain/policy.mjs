import assert from 'node:assert/strict';

export function validateManifest(pkg, lock, tc) {
  assert.equal(pkg.private, true, 'Repository must not be published as an npm package.');
  assert.equal(pkg.packageManager, `pnpm@${tc.pnpm}`);
  assert.equal(pkg.engines?.node, tc.node);
  assert.equal(pkg.engines?.pnpm, tc.pnpm);
  assert.equal(lock.lockfileVersion, '9.0');
  assert.equal(lock.settings?.autoInstallPeers, false);
  const productDependencies = {
    '@phosphor-icons/react': '2.1.10',
    react: '19.2.0',
    'react-dom': '19.2.0',
  };
  assert.deepEqual(pkg.dependencies, productDependencies, 'M1 website dependencies must stay pinned.');
  assert.deepEqual(pkg.devDependencies, tc.dependencies);
  const runtimeImporter = lock.importers?.['.']?.dependencies;
  assert.deepEqual(Object.keys(runtimeImporter ?? {}).sort(), Object.keys(productDependencies).sort());
  for (const [name, version] of Object.entries(productDependencies)) {
    assert.equal(runtimeImporter[name].specifier, version, `${name}: manifest/lock mismatch`);
    assert.ok(lock.packages[`${name}@${version}`], `${name}: package entry missing`);
  }
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
  assert.deepEqual(workflow.on.pull_request.branches, ['main', 'dev']);
  assert.deepEqual(workflow.on.push.branches, ['main', 'dev']);
  assert.equal(workflow.on.workflow_dispatch?.inputs?.deploy_demo?.type, 'boolean');
  assert.equal(workflow.on.workflow_dispatch?.inputs?.deploy_demo?.default, false);
  assert.equal(workflow.concurrency?.['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
  assert.ok(workflow.jobs.required && workflow.jobs['arc-readonly']);
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ['required', 'arc-readonly', 'm1a-visual', 'm1c-demo', 'demo-deploy'].sort());
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (name === 'demo-deploy') continue;
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
    assert.ok(!JSON.stringify(job).includes('secrets.'), 'Read-only checks cannot access deployment secrets.');
  }
  const deploy = workflow.jobs['demo-deploy'];
  assert.equal(deploy['runs-on'], 'ubuntu-24.04');
  assert.ok(deploy['timeout-minutes'] > 0 && deploy['timeout-minutes'] <= 15);
  assert.equal(deploy.permissions, undefined);
  assert.equal(deploy['continue-on-error'], undefined);
  assert.equal(deploy.environment, 'arcbox_demo');
  assert.deepEqual(deploy.needs, ['required', 'arc-readonly', 'm1a-visual', 'm1c-demo']);
  assert.equal(deploy.concurrency?.group, 'arcbox-demo');
  assert.equal(deploy.concurrency?.['cancel-in-progress'], false);
  assert.equal(deploy.if, "${{ success() && vars.ARCBOX_DEMO_DEPLOY_ENABLED == 'true' && github.ref == 'refs/heads/dev' && (github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.deploy_demo == true)) }}");
  for (const step of deploy.steps) {
    assert.equal(step['continue-on-error'], undefined);
    if (step.uses) {
      const [name, sha] = step.uses.split('@');
      assert.equal(sha, pins[name], 'Deployment actions must match recorded full SHAs.');
      assert.match(sha, /^[0-9a-f]{40}$/);
      if (name === 'actions/checkout') {
        assert.equal(step.with?.['persist-credentials'], false);
        assert.equal(step.with?.ref, '${{ github.sha }}');
      }
    }
  }
  const secretSteps = deploy.steps.filter((step) => JSON.stringify(step).includes('secrets.'));
  assert.equal(secretSteps.length, 1, 'Only the Wrangler upload step may receive Cloudflare secrets.');
  assert.match(secretSteps[0].run, /wrangler deploy --config wrangler\.demo\.jsonc --strict/);
  assert.equal(secretSteps[0].if, "steps.freshness.outputs.current == 'true'");
  const freshness = deploy.steps.find((step) => step.id === 'freshness');
  assert.ok(freshness?.run?.includes('git/ref/heads/dev'), 'Deployment must recheck the dev branch tip.');
  assert.ok(freshness.run.includes('current=false'), 'Stale commits must skip deployment.');
  assert.ok(deploy.steps.some((step) => step.run?.includes('verify-demo-live.mjs') && step.if === "steps.freshness.outputs.current == 'true'"));
  assert.deepEqual(
    [...new Set([...JSON.stringify(deploy).matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]))].sort(),
    ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  );
  const text = JSON.stringify(workflow);
  assert.ok(!text.includes('pull_request_target'));
  assert.ok(!text.includes('arc-testnet-write') && !text.includes('probe:arc:write'), 'Live writes are not part of automatic CI.');
  // Regression guard, not a proof that arbitrary future shell code is safe.
}
