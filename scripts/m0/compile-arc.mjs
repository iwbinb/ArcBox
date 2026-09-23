import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import solc from 'solc';

const tc = JSON.parse(readFileSync('toolchain.json', 'utf8'));
const runtime = JSON.parse(readFileSync('probes/arc/runtime.json', 'utf8'));
assert.equal(solc.version().split('+')[0], tc.solidity.packageVersion);
const sources = Object.fromEntries(['ArcCompatibilityProbe.sol', 'TokenFixtures.sol'].map((name) => [name, { content: readFileSync(`probes/arc/${name}`, 'utf8') }]));
const root = realpathSync('node_modules/@openzeppelin/contracts');
const imported = {};
const settings = { optimizer: tc.solidity.optimizer, viaIR: false, evmVersion: runtime.evmVersion, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } } };
const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings }), { import(path) {
  try {
    assert.ok(path.startsWith('@openzeppelin/contracts/') && !path.split('/').includes('..'));
    const full = realpathSync(resolve(root, path.slice('@openzeppelin/contracts/'.length)));
    assert.ok(full.startsWith(root + sep));
    const content = readFileSync(full, 'utf8');
    imported[path] = createHash('sha256').update(content).digest('hex');
    return { contents: content };
  } catch { return { error: 'IMPORT_NOT_ALLOWED' }; }
} }));
const errors = (output.errors ?? []).filter((error) => error.severity === 'error');
if (errors.length) { for (const error of errors) console.error(error.formattedMessage); process.exit(1); }
mkdirSync('dist/arc', { recursive: true });
for (const [file, name] of [['ArcCompatibilityProbe.sol', 'ArcCompatibilityProbe'], ['ArcCompatibilityProbe.sol', 'Probe1271Wallet'], ['TokenFixtures.sol', 'TokenFixture']]) {
  const item = output.contracts[file][name];
  assert.ok(item.evm.bytecode.object.length > 0);
  writeFileSync(`dist/arc/${name}.json`, JSON.stringify({ abi: item.abi, bytecode: `0x${item.evm.bytecode.object}`, deployedBytecode: `0x${item.evm.deployedBytecode.object}`, immutableReferences: item.evm.deployedBytecode.immutableReferences }, null, 2) + '\n');
}
const manifest = { schemaVersion: 1, compiler: solc.version(), openzeppelin: tc.dependencies['@openzeppelin/contracts'], evmVersion: runtime.evmVersion, sourceHash: createHash('sha256').update(JSON.stringify({ sources, imported, settings })).digest('hex'), imported };
writeFileSync('dist/arc/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('ARC_COMPILE_PASS ' + JSON.stringify(manifest));
