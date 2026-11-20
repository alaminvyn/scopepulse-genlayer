import { createClient, isSuccessful, decodeInputData } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';
import { TransactionHashVariant, type TransactionHash } from 'genlayer-js/types';
import { decodeFunctionData, formatEther, parseEventLogs, type Address, type Hash } from 'viem';

import { hashPattern, parseAssessment, type LookupKind } from './verification';
import { contract, ready, walletWritesEnabled, errorMessage, type Reference, type Observation } from './chain';

type Provider = NonNullable<NonNullable<Parameters<typeof createClient>[0]>['provider']>;

const chainId = '0x107d';
const genesis = '0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4';
const endpoint = import.meta.env.VITE_BRADBURY_RPC || 'https://rpc-bradbury.genlayer.com';
const addressPattern = /^0x[0-9a-f]{40}$/i;
export const read = createClient({ chain: testnetBradbury, endpoint });
const allocations = {
  leaderTimeunitsAllocation: import.meta.env.VITE_ASSESS_LEADER_TIMEUNITS,
  validatorTimeunitsAllocation: import.meta.env.VITE_ASSESS_VALIDATOR_TIMEUNITS,
  executionBudgetPerRound: import.meta.env.VITE_ASSESS_EXECUTION_BUDGET_WEI,
};
const hasProfile = Object.values(allocations).every(value => /^[1-9][0-9]*$/.test(value ?? ''));

export async function withDeadline<T>(request: Promise<T>, timeout = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Bradbury request timed out.')), timeout);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

let verifiedNetwork: Promise<void> | undefined;
function verifyReadNetwork() {
  verifiedNetwork ??= withDeadline(read.getBlock({ blockNumber: 0n })).then(block => {
    if (block.hash !== genesis) throw new Error('The configured RPC is not Bradbury Phase 2.');
  }).catch(error => { verifiedNetwork = undefined; throw error; });
  return verifiedNetwork;
}

const demoEnvelope = hashPattern.test(import.meta.env.VITE_DEMO_ENVELOPE ?? '') ? import.meta.env.VITE_DEMO_ENVELOPE as Hash : undefined;

export async function connectWallet() {
  if (!walletWritesEnabled) throw new Error('Wallet writes are paused.');
  const provider = (window as Window & { ethereum?: Provider }).ethereum;
  if (!provider) throw new Error('Open this page in a browser with an Ethereum wallet such as MetaMask.');
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as Address[];
  const caller = accounts[0];
  if (!caller || !addressPattern.test(caller)) throw new Error('Select an account in your wallet.');
  if (await provider.request({ method: 'eth_chainId' }) !== chainId) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 4902) throw error;
      await provider.request({ method: 'wallet_addEthereumChain', params: [{
        chainId, chainName: 'GenLayer Bradbury Phase 2', rpcUrls: testnetBradbury.rpcUrls.default.http,
        nativeCurrency: testnetBradbury.nativeCurrency,
        blockExplorerUrls: [testnetBradbury.blockExplorers?.default.url],
      }] });
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    }
  }
  await assertBradburyWallet(provider);
  if ((await read.getBlock({ blockNumber: 0n })).hash !== genesis) throw new Error('The configured node is not Bradbury Phase 2.');
  return { provider, caller };
}

async function assertBradburyWallet(provider: Provider) {
  if (await provider.request({ method: 'eth_chainId' }) !== chainId) throw new Error('Switch your wallet to Bradbury Phase 2.');
  const walletGenesis = await provider.request({ method: 'eth_getBlockByNumber', params: ['0x0', false] }) as { hash?: string } | null;
  if (walletGenesis?.hash !== genesis) throw new Error('Update your wallet’s Bradbury RPC to the Phase 2 network.');
}

export async function quote(original: string, revised: string, id: string, caller: Address) {
  if (!walletWritesEnabled || !ready || !contract) throw new Error('Wallet writes are unavailable.');
  const estimate = hasProfile
    ? await read.estimateTransactionFees(allocations)
    : await createClient({ chain: testnetBradbury, endpoint, account: caller }).estimateTransactionFeesForWrite({ address: contract, functionName: 'assess', args: [id, original, revised] });
  return { fees: { distribution: estimate.distribution, feeValue: estimate.feeValue }, label: formatEther(estimate.feeValue) + ' GEN' };
}

export async function submit(
  wallet: Awaited<ReturnType<typeof connectWallet>>, id: string, original: string, revised: string,
  fees: Awaited<ReturnType<typeof quote>>['fees'], onReference: (reference: Reference) => void,
) {
  const assessmentAddress = contract;
  if (!walletWritesEnabled || !ready || !assessmentAddress) throw new Error('Wallet writes are unavailable.');
  const { caller, provider } = wallet;
  const accounts = await provider.request({ method: 'eth_accounts' }) as Address[];
  if (accounts[0]?.toLowerCase() !== caller.toLowerCase()) throw new Error('The selected account changed. Review the submission again.');
  const reference: Reference = { at: Date.now(), id, contract: assessmentAddress, caller };
  const trackedProvider: Provider = {
    request: async (request: { method: string; params?: unknown[] }) => {
      if (request.method === 'eth_sendTransaction') {
        const tx = assertAssessmentRequest(request.params?.[0], { caller, contract: assessmentAddress, id, original, revised, fees });
        // The SDK can fall back to a fixed gas limit after a reverted estimate.
        // Require an independent preflight of the exact request before handing it to the wallet.
        let estimatedGas: bigint;
        try {
          estimatedGas = await withDeadline(read.estimateTransactionGas({ from: tx.from, to: tx.to, data: tx.data, value: BigInt(tx.value) }));
        } catch {
          throw new Error('Gas estimation failed for this exact assessment. No wallet request was sent.');
        }
        if (estimatedGas <= 0n || BigInt(tx.gas) < estimatedGas) {
          throw new Error('The wallet transaction gas limit is below the verified estimate.');
        }
        await assertBradburyWallet(provider);
        const selected = await provider.request({ method: 'eth_accounts' }) as Address[];
        if (selected[0]?.toLowerCase() !== caller.toLowerCase()) {
          throw new Error('The selected account changed. Review the submission again.');
        }
      }
      const result = await provider.request(request);
      if (request.method === 'eth_sendTransaction' && typeof result === 'string' && hashPattern.test(result)) {
        reference.envelope = result as Hash;
        onReference({ ...reference });
      }
      return result;
    },
  };
  const client = createClient({ chain: testnetBradbury, endpoint, account: caller, provider: trackedProvider });
  reference.hash = await client.writeContract({ address: assessmentAddress, functionName: 'assess', args: [reference.id, original, revised], fees });
  onReference({ ...reference });
}

export function assertAssessmentRequest(
  request: unknown,
  expected: { caller: Address; contract: Address; id: string; original: string; revised: string; fees: Awaited<ReturnType<typeof quote>>['fees'] },
) {
  const tx = request as { from?: Address; to?: Address; value?: Hash; chainId?: string; data?: Hash; gas?: Hash } | undefined;
  const consensus = testnetBradbury.consensusMainContract;
  if (!consensus || tx?.from?.toLowerCase() !== expected.caller.toLowerCase() ||
      tx?.to?.toLowerCase() !== consensus.address.toLowerCase() || tx.chainId !== chainId ||
      typeof tx.value !== 'string' || !/^0x[0-9a-f]+$/i.test(tx.value) || BigInt(tx.value) !== expected.fees.feeValue) {
    throw new Error('The wallet transaction does not match the reviewed Bradbury fee and recipient.');
  }

  if (!tx.data) throw new Error('Wallet transaction payload is missing.');
  if (typeof tx.gas !== 'string' || !/^0x[0-9a-f]+$/i.test(tx.gas) || BigInt(tx.gas) <= 0n) {
    throw new Error('Wallet transaction gas limit is invalid.');
  }
  const decoded = decodeFunctionData({ abi: consensus.abi, data: tx.data });
  const payload = decoded.args?.[0] as {
    sender: Address; recipient: Address; userValue: bigint; txCalldata: Hash;
    messageAllocations: unknown[]; feesDistribution: Record<string, unknown>;
  } | undefined;
  if (decoded.functionName !== 'addTransaction' || !payload ||
      payload.sender?.toLowerCase() !== expected.caller.toLowerCase() ||
      payload.recipient?.toLowerCase() !== expected.contract.toLowerCase() ||
      payload.userValue !== 0n || !Array.isArray(payload.messageAllocations) || payload.messageAllocations.length) {
    throw new Error('Wallet transaction does not match the reviewed assessment.');
  }

  const distribution = expected.fees.distribution;
  const encodedFees = payload.feesDistribution;
  if (!encodedFees || Object.entries(distribution).some(([key, value]) => {
    const encoded = encodedFees[key];
    return Array.isArray(value)
      ? !Array.isArray(encoded) || value.length !== encoded.length || value.some((item, index) => item !== encoded[index])
      : value !== encoded;
  })) {
    throw new Error('Wallet transaction contains an unexpected fee distribution.');
  }

  const call = assessmentCall(decodeInputData(payload.txCalldata, expected.contract));
  const args = [expected.id, expected.original, expected.revised];
  if (!call || call.some((value, index) => value !== args[index])) {
    throw new Error('Wallet transaction contains unexpected assessment inputs.');
  }
  return { from: expected.caller, to: consensus.address, value: tx.value, data: tx.data, gas: tx.gas };
}

const createdTransactionAbi = [{
  type: 'event', name: 'CreatedTransaction',
  inputs: [{ name: 'txId', type: 'bytes32', indexed: true }, { name: 'txSlot', type: 'uint256', indexed: false }],
}] as const;

export async function resolveEnvelope(hash: Hash) {
  await verifyReadNetwork();
  const envelope = await withDeadline(read.getTransactionReceipt({ hash }));
  if (envelope.status === 'reverted') throw new Error('Wallet transaction reverted.');
  const consensus = testnetBradbury.consensusMainContract;
  if (!consensus || envelope.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      envelope.to?.toLowerCase() !== consensus.address.toLowerCase()) {
    throw new Error('Wallet receipt does not match the expected Bradbury consensus transaction.');
  }
  const logs = envelope.logs.filter(log => log.address.toLowerCase() === consensus?.address.toLowerCase());
  const events = parseEventLogs({ abi: consensus?.abi ?? [], eventName: 'NewTransaction', logs });
  const emittedIds = new Set([
    ...events.map(event => (event as { args?: { txId?: Hash } }).args?.txId),
    ...parseEventLogs({ abi: createdTransactionAbi, logs }).map(event => event.args.txId),
  ].filter((id): id is Hash => Boolean(id && hashPattern.test(id))).map(id => id.toLowerCase() as Hash));
  if (emittedIds.size === 0) throw new Error('No GenLayer ID was found in the wallet transaction.');
  if (emittedIds.size !== 1) throw new Error('Wallet transaction returned multiple GenLayer IDs.');
  return [...emittedIds][0];
}

function assessmentCall(decoded: ReturnType<typeof decodeInputData> | undefined): [string, string, string] | undefined {
  if (!decoded || !('callData' in decoded) || decoded.leaderOnly) return;
  const call = decoded.callData;
  const method = call instanceof Map ? call.get('') : call?.[''];
  const args = call instanceof Map ? call.get('args') : call?.args;
  const kwargs = call instanceof Map ? call.get('kwargs') : call?.kwargs;
  if (method === 'assess' && !kwargs && Array.isArray(args) && args.length === 3 && args.every(value => typeof value === 'string')) {
    return [args[0], args[1], args[2]];
  }
}

export async function verifyAssessment(kind: LookupKind, input: Hash): Promise<Observation> {
  if (kind === 'genlayer') return observe(input);
  try {
    const hash = await resolveEnvelope(input);
    return { ...await observe(hash), envelope: input };
  } catch (error) {
    const phase = errorMessage(error);
    if (phase === 'Wallet transaction reverted.' || phase.startsWith('No GenLayer ID') || phase.startsWith('Wallet receipt') || phase.includes('multiple GenLayer IDs')) {
      return { state: 'failed', phase, terminal: true, envelope: input };
    }
    throw error;
  }
}

export async function observe(target: Reference | Hash): Promise<Observation> {
  await verifyReadNetwork();
  const reference = typeof target === 'string' ? undefined : target;
  let hash = typeof target === 'string' ? target : target.hash;
  if (reference?.envelope) {
    try {
      const resolved = await resolveEnvelope(reference.envelope);
      if (hash && hash.toLowerCase() !== resolved.toLowerCase()) {
        return { state: 'invalid', phase: 'Wallet transaction and GenLayer ID do not match', terminal: true, hash };
      }
      hash = resolved;
    }
    catch (error) {
      const phase = errorMessage(error);
      if (phase === 'Wallet transaction reverted.' || phase.startsWith('No GenLayer ID') || phase.startsWith('Wallet receipt') || phase.includes('multiple GenLayer IDs')) return { state: 'failed', phase, terminal: true };
      throw error;
    }
  }
  if (!hash) return { state: 'submitted', phase: 'Awaiting transaction ID' };
  const tx = await withDeadline(read.getTransaction({ hash: hash as TransactionHash }));
  if (!tx.statusName || tx.statusName === 'UNINITIALIZED') return { state: 'unavailable', phase: 'No transaction record is available yet', hash };
  if (tx.statusName === 'CANCELED') return { state: 'failed', phase: 'Canceled', terminal: true, hash };
  if (tx.statusName !== 'FINALIZED') return { state: 'pending', phase: tx.statusName?.toLowerCase().replaceAll('_', ' ') || 'Awaiting consensus', hash };
  if (!isSuccessful(tx)) return { state: 'failed', phase: 'Finalized · execution failed', terminal: true, hash };
  const recipient = tx.recipient ?? tx.to_address;
  const caller = tx.sender ?? tx.from_address;
  const expectedContract = ready ? contract : undefined;
  const args = assessmentCall(tx.txDataDecoded);
  if (!expectedContract || (reference && reference.contract.toLowerCase() !== expectedContract.toLowerCase()) || recipient?.toLowerCase() !== expectedContract.toLowerCase() || !caller ||
      (reference && caller.toLowerCase() !== reference.caller.toLowerCase()) ||
      !args || !/^[0-9a-f]{32}$/.test(args[0]) || (reference && args[0] !== reference.id)) {
    return { state: 'invalid', phase: 'Transaction does not match this assessment', terminal: true, hash };
  }
  const [requestId, original, revised] = args;
  const raw = await withDeadline(read.readContract({
    address: expectedContract, functionName: 'get_assessment', args: [caller, requestId],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  }));
  if (raw === '' || raw == null) return { state: 'awaiting-readback', phase: 'Finalized · waiting for result readback', hash };
  const result = typeof raw === 'string' ? parseAssessment(raw, original, revised) : undefined;
  if (!result) return { state: 'invalid', phase: 'Finalized · invalid result evidence', terminal: true, hash };
  let envelope = reference?.envelope;
  if (!reference && demoEnvelope) {
    try { if (await resolveEnvelope(demoEnvelope) === hash) envelope = demoEnvelope; }
    catch { /* The verified read remains available if the optional explorer link cannot be verified. */ }
  }
  return { state: 'verified', phase: 'Finalized · verified', result, original, revised, terminal: true, hash, envelope, contract: expectedContract, caller, requestId, verifiedAt: Date.now() };
}

export async function quoteDeployment(code: string) {
  if (!walletWritesEnabled) throw new Error('Wallet writes are paused.');
  await read.getContractSchemaForCode(code);
  const estimate = await read.estimateTransactionFees();
  return { fees: { distribution: estimate.distribution, feeValue: estimate.feeValue }, label: formatEther(estimate.feeValue) + ' GEN' };
}

export function deployContract(wallet: Awaited<ReturnType<typeof connectWallet>>, code: string, fees: Awaited<ReturnType<typeof quoteDeployment>>['fees'], onBroadcast: (hash: Hash) => void) {
  if (!walletWritesEnabled) throw new Error('Wallet writes are paused.');
  const provider: Provider = {
    request: async (request: { method: string; params?: unknown[] }) => {
      const result = await wallet.provider.request(request);
      if (request.method === 'eth_sendTransaction' && typeof result === 'string' && hashPattern.test(result)) onBroadcast(result as Hash);
      return result;
    },
  };
  return createClient({ chain: testnetBradbury, endpoint, provider, account: wallet.caller }).deployContract({ code, args: [], fees });
}

export async function inspectDeployment(hash: Hash) {
  const tx = await withDeadline(read.getTransaction({ hash: hash as TransactionHash }));
  if (tx.statusName === 'CANCELED') throw new Error('Deployment was canceled.');
  if (tx.statusName !== 'FINALIZED') return { phase: tx.statusName ?? 'Awaiting consensus' };
  if (!isSuccessful(tx) || !tx.recipient || tx.txDataDecoded?.type !== 'deploy') {
    throw new Error('Transaction did not finalize as a successful contract deployment.');
  }
  const schema = await withDeadline(read.getContractSchema(tx.recipient));
  if (!schema.methods.assess || !schema.methods.get_assessment) throw new Error('The contract schema does not match ScopePulse.');
  return { state: 'verified', phase: 'Finalized · verified', address: tx.recipient };
}
