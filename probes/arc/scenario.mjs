import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseEventLogs, hashTypedData, verifyMessage } from 'viem';
import { TOKEN, RPC, TESTNET_ID, SCALE, ERC20, chain, assertEndpoint, assertUnusedTestnetWallet, FeeBudget, checkReceipt, pairedTransfers, typedAction, caseId, safeJson, fail } from './lib.mjs';

const load = (name) => JSON.parse(readFileSync(`dist/arc/${name}.json`, 'utf8'));
export function artifacts() { return { probe: load('ArcCompatibilityProbe'), wallet1271: load('Probe1271Wallet'), fixture: load('TokenFixture') }; }
export async function executeScenario({ mode, url, account, report, save = () => {} }) {
  assertEndpoint(mode, url);
  const chainId = mode === 'local' ? 31337 : TESTNET_ID;
  const network = chain(chainId, url);
  const client = createPublicClient({ chain: network, transport: http(url, { retryCount: 0, timeout: 12_000 }), pollingInterval: 200 });
  const wallet = createWalletClient({ account, chain: network, transport: http(url, { retryCount: 0, timeout: 12_000 }) });
  assert.equal(await client.getChainId(), chainId, 'WRONG_CHAIN');
  if (mode === 'local') {
    const info = await client.request({ method: 'anvil_nodeInfo' });
    assert.equal(info.network, 'arc', 'ARC_EXECUTION_ENGINE_REQUIRED');
    report.runtime = info;
  } else assert.equal(url, RPC);
  const compiled = artifacts();
  const budget = new FeeBudget();
  const allowed = new Set([TOKEN]);
  report.checks = []; report.transactions = []; report.contracts = {}; report.account = account.address;
  report.chainId = chainId; report.mode = mode; report.status = 'IN_PROGRESS'; save(report);
  const pass = (id, detail = {}) => { report.checks.push({ id, status: 'PASS', detail }); save(report); };
  const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });
  let currentAction = 'preflight';
  async function submit(label, { artifact, args = [], address, abi, functionName, expected = 'success' }) {
    currentAction = label;
    assert.equal(await client.getChainId(), chainId, 'CHAIN_CHANGED');
    if (address && !allowed.has(address.toLowerCase())) fail('TARGET_NOT_ALLOWLISTED');
    const [latestNonce, pendingNonce, block] = await Promise.all([client.getTransactionCount({ address: account.address, blockTag: 'latest' }), client.getTransactionCount({ address: account.address, blockTag: 'pending' }), client.getBlock()]);
    assert.equal(latestNonce, pendingNonce, 'UNRESOLVED_WALLET_TRANSACTION');
    const data = artifact ? undefined : encodeFunctionData({ abi, functionName, args });
    let gas;
    if (artifact) {
      const { encodeDeployData } = await import('viem');
      gas = await client.estimateGas({ account, data: encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args }), value: 0n });
    } else if (expected === 'success') {
      await client.simulateContract({ account, address, abi, functionName, args, value: 0n });
      gas = await client.estimateGas({ account, to: address, data, value: 0n });
    } else {
      // One known pure-revert call; never send arbitrary failing calldata.
      assert.equal(functionName, 'expectedFailure');
      await assert.rejects(client.simulateContract({ account, address, abi, functionName, args }));
      gas = 65000n;
    }
    gas = gas * 125n / 100n + 10000n;
    const proposedFee = (block.baseFeePerGas ?? 20000000000n) * 2n + 1000000000n;
    const maxFeePerGas = proposedFee < 40000000000n ? 40000000000n : proposedFee;
    budget.reserve(gas, maxFeePerGas);
    const pending = { label, status: 'SIGNING_OR_BROADCASTING', nonce: pendingNonce, to: address ?? null, maxFeeU18: gas * maxFeePerGas };
    report.transactions.push(pending); save(report);
    const common = { account, chain: network, value: 0n, gas, nonce: pendingNonce, type: 'eip1559', maxFeePerGas, maxPriorityFeePerGas: 1000000000n };
    let hash;
    try {
      hash = artifact ? await wallet.deployContract({ ...common, abi: artifact.abi, bytecode: artifact.bytecode, args }) : await wallet.writeContract({ ...common, address, abi, functionName, args });
    } catch { pending.status = 'UNKNOWN_BROADCAST_OUTCOME'; save(report); fail('BROADCAST_OUTCOME_UNCERTAIN_STOP'); }
    pending.hash = hash; pending.status = 'SUBMITTED'; save(report);
    let receipt;
    try { receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 45_000, pollingInterval: 250, retryCount: 0 }); }
    catch { pending.status = 'UNKNOWN_RECEIPT'; save(report); fail('RECEIPT_UNKNOWN_STOP_NO_RESEND'); }
    checkReceipt(receipt, { hash, from: account.address, to: address ?? null, status: expected });
    budget.confirmed(receipt);
    pending.status = receipt.status; pending.blockNumber = receipt.blockNumber; pending.blockHash = receipt.blockHash;
    pending.gasUsed = receipt.gasUsed; pending.effectiveGasPrice = receipt.effectiveGasPrice; pending.feeU18 = receipt.gasUsed * receipt.effectiveGasPrice;
    if (artifact) {
      assert.ok(receipt.contractAddress, 'NO_DEPLOYED_ADDRESS');
      const code = await client.getCode({ address: receipt.contractAddress });
      const normalize = (hex) => {
        const bytes = Buffer.from(hex.slice(2), 'hex');
        for (const refs of Object.values(artifact.immutableReferences)) for (const ref of refs) bytes.fill(0, ref.start, ref.start + ref.length);
        return bytes.toString('hex');
      };
      assert.equal(normalize(code ?? '0x'), normalize(artifact.deployedBytecode), 'DEPLOYED_CODE_MISMATCH');
      allowed.add(receipt.contractAddress.toLowerCase());
      pending.contractAddress = receipt.contractAddress;
    }
    report.totalGasFeeU18 = budget.spent; save(report);
    return receipt;
  }
  try {
    if (mode === 'testnet') {
      const [latestNonce, pendingNonce] = await Promise.all([
        client.getTransactionCount({ address: account.address, blockTag: 'latest' }),
        client.getTransactionCount({ address: account.address, blockTag: 'pending' }),
      ]);
      assertUnusedTestnetWallet(latestNonce, pendingNonce);
    }
    assert.equal(await read(TOKEN, ERC20, 'decimals'), 6);
    const initial = await client.getBalance({ address: account.address });
    assert.equal(await read(TOKEN, ERC20, 'balanceOf', [account.address]), initial / SCALE);
    if (mode === 'testnet' && initial < 2100000000000000000n) fail('TEST_FUNDS_AND_GAS_RESERVE_REQUIRED');
    pass('ARC-01', { sharedBalance: true, erc20Decimals: 6, nativeDecimals: 18 });
    const probeDeploy = await submit('deploy-probe', { artifact: compiled.probe, args: [TOKEN] });
    const probe = probeDeploy.contractAddress; report.contracts.probe = probe;
    assert.equal((await read(probe, compiled.probe.abi, 'operator')).toLowerCase(), account.address.toLowerCase());
    assert.equal((await read(probe, compiled.probe.abi, 'token')).toLowerCase(), TOKEN);
    const walletDeploy = await submit('deploy-1271', { artifact: compiled.wallet1271, args: [TOKEN] });
    const smartWallet = walletDeploy.contractAddress; report.contracts.wallet1271 = smartWallet;
    pass('ARC-02', { probe, smartWallet, runtimeBytecodeVerified: true });
    const recipientBefore = await client.getBalance({ address: smartWallet });
    const transfer = await submit('erc20-transfer', { address: TOKEN, abi: ERC20, functionName: 'transfer', args: [smartWallet, 1000n] });
    const transfers = pairedTransfers(transfer.logs);
    assert.equal(transfers.pairs, 1); assert.equal(transfers.token.length, 1);
    assert.equal(transfers.token[0].value, 1000n);
    assert.equal(await client.getBalance({ address: smartWallet }) - recipientBefore, 1000n * SCALE);
    pass('ARC-03', { amountU6: 1000n, matchedPairs: transfers.pairs, hash: transfer.transactionHash });
    await submit('return-direct-transfer', { address: smartWallet, abi: compiled.wallet1271.abi, functionName: 'returnToken' });
    assert.equal(await client.getBalance({ address: smartWallet }), recipientBefore);
    pass('ARC-04', { returnedToFixedOwner: true });
    await assert.rejects(client.simulateContract({ account, address: probe, abi: compiled.probe.abi, functionName: 'roundTrip', args: [caseId(1), 10000n] }));
    pass('ARC-05', { noAllowanceSimulationRejected: true, note: 'Simulation, not a mined revert.' });
    const approval = await submit('exact-approval', { address: TOKEN, abi: ERC20, functionName: 'approve', args: [probe, 10000n] });
    assert.equal(await read(TOKEN, ERC20, 'allowance', [account.address, probe]), 10000n);
    assert.equal(pairedTransfers(approval.logs).token.length, 0);
    pass('ARC-06', { allowanceU6: 10000n, notAPayment: true });
    const beforeRoundTrip = await client.getBalance({ address: account.address });
    const roundTrip = await submit('safe-transferfrom-roundtrip', { address: probe, abi: compiled.probe.abi, functionName: 'roundTrip', args: [caseId(1), 10000n] });
    const movements = pairedTransfers(roundTrip.logs);
    assert.equal(movements.token.length, 2); assert.equal(movements.pairs, 2);
    const events = parseEventLogs({ abi: compiled.probe.abi, logs: roundTrip.logs, eventName: 'ProbeRoundTrip', strict: true }).filter((event) => event.address.toLowerCase() === probe.toLowerCase());
    assert.equal(events.length, 1); assert.equal(events[0].args.caseId, caseId(1)); assert.equal(events[0].args.amountU6, 10000n);
    assert.equal(events[0].args.payer.toLowerCase(), account.address.toLowerCase());
    assert.equal(await read(TOKEN, ERC20, 'allowance', [account.address, probe]), 0n);
    assert.equal(await read(TOKEN, ERC20, 'balanceOf', [probe]), 0n);
    assert.equal(beforeRoundTrip - await client.getBalance({ address: account.address }), roundTrip.gasUsed * roundTrip.effectiveGasPrice);
    pass('ARC-07', { matchedPairs: 2, businessEvents: 1, residualU6: 0n, allowanceU6: 0n, gasSeparate: true });
    await assert.rejects(client.simulateContract({ account, address: probe, abi: compiled.probe.abi, functionName: 'roundTrip', args: [caseId(1), 10000n] }));
    pass('ARC-08', { duplicateCaseRejected: true });
    const text = 'ArcBox M0-D probe only. This is not a login or payment authorization.';
    assert.equal(await verifyMessage({ address: account.address, message: text, signature: await account.signMessage({ message: text }) }), true);
    pass('ARC-09', { eoaPersonalSignature: true, productionSiwe: false });
    for (const [index, signer] of [[10, account.address], [11, smartWallet]]) {
      const message = { caseId: caseId(index), signer, nonce: 0n, deadline: (await client.getBlock()).timestamp + 600n };
      const typed = typedAction(chainId, probe, message);
      const signature = await account.signTypedData(typed);
      assert.equal(await read(probe, compiled.probe.abi, 'digest', Object.values(message)), hashTypedData(typed));
      assert.equal(await read(probe, compiled.probe.abi, 'verify', [...Object.values(message), signature]), true);
      const wrongSignature = await account.signTypedData({ ...typed, domain: { ...typed.domain, chainId: chainId + 1 } });
      assert.equal(await read(probe, compiled.probe.abi, 'verify', [...Object.values(message), wrongSignature]), false);
      await submit(`consume-${index}`, { address: probe, abi: compiled.probe.abi, functionName: 'consume', args: [...Object.values(message), signature] });
      await assert.rejects(client.simulateContract({ account, address: probe, abi: compiled.probe.abi, functionName: 'consume', args: [...Object.values(message), signature] }));
      pass(`ARC-${index}`, { signerKind: index === 10 ? 'EOA' : 'DEPLOYED_ERC1271', typedDigestMatches: true, wrongChainRejected: true, nonceReplayRejected: true });
    }
    const reverted = await submit('expected-mined-revert', { address: probe, abi: compiled.probe.abi, functionName: 'expectedFailure', expected: 'reverted' });
    pass('ARC-12', { status: reverted.status, hash: reverted.transactionHash, logs: reverted.logs.length, gasCharged: reverted.gasUsed > 0n });
    report.status = mode === 'local' ? 'PASS_LOCAL_ARC' : 'PASS_PUBLIC_TESTNET';
  } catch (error) {
    report.status = 'FAIL_OR_BLOCKED'; report.failedAction = currentAction; report.errorClass = error.name;
    if (error.code === 'TESTNET_WALLET_ALREADY_USED') report.errorCode = error.code;
    // Do not stringify error objects: SDK errors can contain raw signed payloads.
    throw error;
  } finally {
    report.totalGasFeeU18 = budget.spent;
    report.unresolvedTransaction = budget.pending !== null;
    report.completedAt = new Date().toISOString();
    report.recovery = { operator: account.address, contracts: report.contracts, instruction: 'If interrupted: inspect recorded nonces/hashes first. Never blindly repeat. Check/revoke any remaining token allowance; returnToken only pays the fixed owner.' };
    save(report);
  }
  return { client, wallet, compiled, report };
}
