import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import solc from 'solc';

export function compileProbe(source, settings) {
  const input = {
    language: 'Solidity',
    sources: { 'CompilerProbe.sol': { content: source } },
    settings: {
      evmVersion: settings.evmVersion,
      optimizer: settings.optimizer,
      viaIR: settings.viaIR,
      metadata: { bytecodeHash: 'none' },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((item) => item.severity === 'error');
  if (errors.length) throw new Error(`SOLIDITY_COMPILE_FAILED: ${errors.map((e) => e.formattedMessage).join('\n')}`);
  const contract = output.contracts?.['CompilerProbe.sol']?.CompilerProbe;
  if (!contract?.evm?.bytecode?.object) throw new Error('EMPTY_COMPILER_OUTPUT');
  return { compiler: solc.version(), settings: input.settings, ...contract };
}

export function main(args = process.argv.slice(2)) {
  if (args.length !== 0) throw new Error('This probe takes no arguments and never deploys.');
  const tc = JSON.parse(readFileSync('toolchain.json', 'utf8'));
  if (!solc.version().startsWith(`${tc.solidity.packageVersion}+commit.`)) throw new Error('SOLC_VERSION_MISMATCH');
  const result = compileProbe(readFileSync('contracts/probes/CompilerProbe.sol', 'utf8'), tc.solidity);
  mkdirSync('dist/contracts', { recursive: true });
  writeFileSync('dist/contracts/CompilerProbe.json', JSON.stringify(result, null, 2) + '\n');
  console.log(`SOLIDITY_COMPILE_PASS ${result.compiler} evm=${tc.solidity.evmVersion}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
