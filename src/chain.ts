import { createClient, isSuccessful } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';
import { TransactionHashVariant, type TransactionHash } from 'genlayer-js/types';
import { formatEther, parseEventLogs, type Address, type Hash } from 'viem';

export type Verdict = 'compatible' | 'potential_conflict' | 'needs_review';
export type Assessment = {
  verdict: Verdict;
  rationale: string;
  evidence: { original: string; revised: string }[];
};
export type Reference = { hash?: Hash; envelope?: Hash; at: number; contract: Address; id: string; caller: Address };
export type Observation = { phase: string; terminal?: boolean; result?: Assessment; original?: string; revised?: string; hash?: Hash; envelope?: Hash };
type Provider = NonNullable<NonNullable<Parameters<typeof createClient>[0]>['provider']>;

const chainId = '0x107d';
const genesis = '0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4';
const endpoint = import.meta.env.VITE_BRADBURY_RPC || 'https://rpc-bradbury.genlayer.com';
const addressPattern = /^0x[0-9a-f]{40}$/i;
export const hashPattern = /^0x[0-9a-f]{64}$/i;
const envAddress = import.meta.env.VITE_SCOPEPULSE_CONTRACT as string | undefined;
export const contract = envAddress && addressPattern.test(envAddress) ? envAddress as Address : undefined;
export const read = createClient({ chain: testnetBradbury, endpoint });
const allocations = {
  leaderTimeunitsAllocation: import.meta.env.VITE_ASSESS_LEADER_TIMEUNITS,
  validatorTimeunitsAllocation: import.meta.env.VITE_ASSESS_VALIDATOR_TIMEUNITS,
  executionBudgetPerRound: import.meta.env.VITE_ASSESS_EXECUTION_BUDGET_WEI,
};
const hasProfile = Object.values(allocations).every(value => /^[1-9][0-9]*$/.test(value ?? ''));
export const ready = Boolean(contract);
export const demoHash = hashPattern.test(import.meta.env.VITE_DEMO_TRANSACTION ?? '') ? import.meta.env.VITE_DEMO_TRANSACTION as Hash : undefined;

const demoEnvelope = hashPattern.test(import.meta.env.VITE_DEMO_ENVELOPE ?? '') ? import.meta.env.VITE_DEMO_ENVELOPE as Hash : undefined;

export function errorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 4001) return 'The wallet request was declined.';
  if (error && typeof error === 'object' && 'message' in error) return String(error.message).split('\n')[0].slice(0, 240);
  return 'The request could not be completed. Please try again.';
}

export async function connectWallet() {
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
  if (!contract) throw new Error('The contract must be configured first.');
  const estimate = hasProfile
    ? await read.estimateTransactionFees(allocations)
    : await createClient({ chain: testnetBradbury, endpoint, account: caller }).estimateTransactionFeesForWrite({ address: contract, functionName: 'assess', args: [id, original, revised] });
  return { fees: { distribution: estimate.distribution, feeValue: estimate.feeValue }, label: formatEther(estimate.feeValue) + ' GEN' };
}

export async function submit(
  wallet: Awaited<ReturnType<typeof connectWallet>>, id: string, original: string, revised: string,
  fees: Awaited<ReturnType<typeof quote>>['fees'], onReference: (reference: Reference) => void,
) {
  if (!contract) throw new Error('The Bradbury contract is unavailable.');
  const { caller, provider } = wallet;
  const accounts = await provider.request({ method: 'eth_accounts' }) as Address[];
  if (accounts[0]?.toLowerCase() !== caller.toLowerCase()) throw new Error('The selected account changed. Review the submission again.');
  const reference: Reference = { at: Date.now(), id, contract, caller };
  const trackedProvider: Provider = {
    request: async (request: { method: string; params?: unknown[] }) => {
      if (request.method === 'eth_sendTransaction') {
        await assertBradburyWallet(provider);
        const tx = request.params?.[0] as { from?: string; to?: string; value?: string; chainId?: string } | undefined;
        if (tx?.from?.toLowerCase() !== caller.toLowerCase() ||
            tx?.to?.toLowerCase() !== testnetBradbury.consensusMainContract?.address.toLowerCase() ||
            tx?.chainId !== chainId || !tx.value || BigInt(tx.value) !== fees.feeValue) {
          throw new Error('The wallet transaction does not match the reviewed Bradbury fee and recipient.');
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
  reference.hash = await client.writeContract({ address: contract, functionName: 'assess', args: [reference.id, original, revised], fees });
  onReference({ ...reference });
}

const createdTransactionAbi = [{
  type: 'event', name: 'CreatedTransaction',
  inputs: [{ name: 'txId', type: 'bytes32', indexed: true }, { name: 'txSlot', type: 'uint256', indexed: false }],
}] as const;

export async function resolveEnvelope(hash: Hash) {
  const envelope = await read.getTransactionReceipt({ hash });
  if (envelope.status === 'reverted') throw new Error('Wallet transaction reverted.');
  const consensus = testnetBradbury.consensusMainContract;
  const logs = envelope.logs.filter(log => log.address.toLowerCase() === consensus?.address.toLowerCase());
  const events = parseEventLogs({ abi: consensus?.abi ?? [], eventName: 'NewTransaction', logs });
  const args = (events[0] as { args?: { txId?: Hash } } | undefined)?.args;
  const resolved = args?.txId ?? parseEventLogs({ abi: createdTransactionAbi, logs })[0]?.args.txId;
  if (!resolved) throw new Error('No GenLayer ID was found in the wallet transaction.');
  return resolved;
}

export async function observe(target: Reference | Hash): Promise<Observation> {
  const reference = typeof target === 'string' ? undefined : target;
  let hash = typeof target === 'string' ? target : target.hash;
  if (!hash && reference?.envelope) {
    try { hash = await resolveEnvelope(reference.envelope); }
    catch (error) {
      const phase = errorMessage(error);
      if (phase === 'Wallet transaction reverted.' || phase.startsWith('No GenLayer ID')) return { phase, terminal: true };
      throw error;
    }
  }
  if (!hash) return { phase: 'Awaiting transaction ID' };
  const tx = await read.getTransaction({ hash: hash as TransactionHash });
  if (tx.statusName === 'CANCELED') return { phase: 'Canceled', terminal: true, hash };
  if (tx.statusName !== 'FINALIZED') return { phase: tx.statusName?.toLowerCase().replaceAll('_', ' ') || 'Awaiting consensus', hash };
  if (!isSuccessful(tx)) return { phase: 'Finalized · execution failed', terminal: true, hash };
  const recipient = tx.recipient ?? tx.to_address;
  const caller = tx.sender ?? tx.from_address;
  const expectedContract = reference?.contract ?? contract;
  const decoded = tx.txDataDecoded;
  const call = decoded && 'callData' in decoded ? decoded.callData : undefined;
  const method = call instanceof Map ? call.get('') : call?.[''];
  const args = call instanceof Map ? call.get('args') : call?.args;
  if (!expectedContract || recipient?.toLowerCase() !== expectedContract.toLowerCase() || !caller ||
      (reference && caller.toLowerCase() !== reference.caller.toLowerCase()) ||
      method !== 'assess' || !Array.isArray(args) || args.length !== 3 || !args.every(value => typeof value === 'string') ||
      (reference && args[0] !== reference.id)) {
    return { phase: 'Transaction does not match this assessment', terminal: true, hash };
  }
  const [requestId, original, revised] = args as string[];
  const raw = await read.readContract({
    address: expectedContract, functionName: 'get_assessment', args: [caller, requestId],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  if (typeof raw !== 'string' || !raw) return { phase: 'Finalized · waiting for result readback', hash };
  const result = JSON.parse(raw) as Assessment;
  if (!['compatible', 'potential_conflict', 'needs_review'].includes(result.verdict) ||
      typeof result.rationale !== 'string' || !Array.isArray(result.evidence) ||
      !result.evidence.length || result.evidence.some(pair => !pair.original || !pair.revised ||
        !original.includes(pair.original) || !revised.includes(pair.revised))) {
    return { phase: 'Finalized · invalid result evidence', terminal: true, hash };
  }
  let envelope = reference?.envelope;
  if (!reference && demoEnvelope) {
    try { if (await resolveEnvelope(demoEnvelope) === hash) envelope = demoEnvelope; }
    catch { /* The verified read remains available if the optional explorer link cannot be verified. */ }
  }
  return { phase: 'Finalized · verified', result, original, revised, terminal: true, hash, envelope };
}

export const explorer = (hash: Hash) => 'https://scan.testnet-chain.genlayer.com/tx/' + hash;

export async function quoteDeployment(code: string) {
  await read.getContractSchemaForCode(code);
  const estimate = await read.estimateTransactionFees();
  return { fees: { distribution: estimate.distribution, feeValue: estimate.feeValue }, label: formatEther(estimate.feeValue) + ' GEN' };
}

export function deployContract(wallet: Awaited<ReturnType<typeof connectWallet>>, code: string, fees: Awaited<ReturnType<typeof quoteDeployment>>['fees'], onBroadcast: (hash: Hash) => void) {
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
  const tx = await read.getTransaction({ hash: hash as TransactionHash });
  if (tx.statusName === 'CANCELED') throw new Error('Deployment was canceled.');
  if (tx.statusName !== 'FINALIZED') return { phase: tx.statusName ?? 'Awaiting consensus' };
  if (!isSuccessful(tx) || !tx.recipient || tx.txDataDecoded?.type !== 'deploy') {
    throw new Error('Transaction did not finalize as a successful contract deployment.');
  }
  const schema = await read.getContractSchema(tx.recipient);
  if (!schema.methods.assess || !schema.methods.get_assessment) throw new Error('The contract schema does not match ScopePulse.');
  return { phase: 'Finalized · verified', address: tx.recipient };
}
