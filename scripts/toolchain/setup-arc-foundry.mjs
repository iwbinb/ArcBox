import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, copyFileSync, chmodSync, rmSync, createWriteStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

assert.equal(process.platform, 'linux', 'The pinned CI runtime is Linux x64 only.');
assert.equal(process.arch, 'x64');
const pin = JSON.parse(readFileSync('probes/arc/runtime.json', 'utf8'));
assert.match(pin.sha256, /^[a-f0-9]{64}$/);
assert.ok(pin.url.startsWith('https://github.com/circlefin/arc-foundry/releases/download/'));
const temp = mkdtempSync(join(tmpdir(), 'arcbox-arc-runtime-'));
try {
  const archive = join(temp, 'release.tar.gz');
  const response = await fetch(pin.url, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok || !response.body) throw new Error(`RUNTIME_DOWNLOAD_${response.status}`);
  const hash = createHash('sha256');
  let bytes = 0;
  const digest = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > 125_000_000) return callback(new Error('RUNTIME_ARCHIVE_TOO_LARGE'));
    hash.update(chunk); callback(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), digest, createWriteStream(archive));
  assert.equal(hash.digest('hex'), pin.sha256, 'Archive integrity mismatch; nothing extracted.');
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', timeout: 15_000 }).trim().split('\n');
  const candidates = entries.filter((entry) => /(^|\/)(anvil|arc-anvil)$/.test(entry));
  assert.equal(candidates.length, 1, 'Expected exactly one Anvil binary.');
  const entry = candidates[0];
  assert.ok(!entry.startsWith('/') && !entry.split('/').includes('..'));
  execFileSync('tar', ['-xzf', archive, '--no-same-owner', '-C', temp, entry], { timeout: 30_000 });
  const destination = resolve('.toolchain/arc-foundry');
  mkdirSync(destination, { recursive: true });
  copyFileSync(join(temp, entry), join(destination, 'arc-anvil'));
  chmodSync(join(destination, 'arc-anvil'), 0o755);
  const version = execFileSync(join(destination, 'arc-anvil'), ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim();
  const record = { release: pin.release, archiveSha256: pin.sha256, bytes, version };
  writeFileSync(join(destination, 'verified.json'), JSON.stringify(record, null, 2) + '\n');
  console.log('ARC_RUNTIME_VERIFIED ' + JSON.stringify(record));
} finally { rmSync(temp, { recursive: true, force: true }); }
