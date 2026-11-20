import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import { createServer, type ViteDevServer } from 'vite';
import { abi, decodeInputData } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, toFunctionSelector, toHex, type Address, type Hash } from 'viem';

const chainId = '0x107d';
const genesis = '0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4';
const consensus = '0x2E2766cbc3E5e61Ce93bBcdCBb3eAcB82082A019';
const contract = '0xC437D73bCd58b8B5a3Fe5e601A6B9A2283E2D64F';
const caller = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const envelope = ('0x' + 'ab'.repeat(32)) as Hash;
const genId = ('0x' + 'cd'.repeat(32)) as Hash;
const id = '0123456789abcdef0123456789abcdef';
const original = 'Retain audit logs for at least 90 days.';
const revised = 'Delete audit logs after 30 days.';
const deposit = 100000000000010352n;
const outcome = { verdict: 'potential_conflict', rationale: 'The revised retention time conflicts with the original.', evidence: [{ original, revised }] };
const mainAbi = testnetBradbury.consensusMainContract!.abi;
const eventAbi = parseAbi(['event CreatedTransaction(bytes32 indexed txId, uint256 txSlot)']);
const feeSelectors = new Map([
  ['GENPerTimeUnit()', 1n], ['storageUnitPrice()', 250000000n], ['quoteGasPrice()', 250000000n],
  ['calculateRoundFees((uint256,uint256,uint256,uint256,uint256,uint256,uint256[],uint256,uint256,uint256),uint256,uint256)', deposit],
  ['receiptWrapperBytes()', 128n], ['useChainDerivedReceiptPrice()', 0n], ['estimateProposeReceiptGas(uint256)', 248408n],
].map(([fn, value]) => [toFunctionSelector(fn as string), value]));
type Request = { method: string; params?: any[] };
type WalletTx = { from: Address; to: Address; value: Hash; chainId: string; data: Hash; gas: Hash; gasPrice: Hash; nonce: Hash };
type Module = typeof import('../src/chain-rpc');

let server: ViteDevServer;
let app: Module;
let realGetTransaction: Module['read']['getTransaction'];
let realReadContract: Module['read']['readContract'];
let rpcCalls: Request[];
let walletCalls: Request[];
let unsigned: WalletTx[];
let rpcGenesis: string;
let receiptStatus: string;
let emittedId: Hash;
let gasRejected: boolean;
let receiptHash: Hash;
let receiptRecipient: Address;
let simulationRejected: boolean;
const realFetch = globalThis.fetch;
const realWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

function block() {
  return { hash: rpcGenesis, number: '0x0', timestamp: '0x0', transactions: [] };
}
function receipt() {
  return {
    transactionHash: receiptHash, blockHash: genesis, blockNumber: '0x5', transactionIndex: '0x0',
    from: caller, to: receiptRecipient, status: receiptStatus, gasUsed: '0x5208', cumulativeGasUsed: '0x5208',
    effectiveGasPrice: '0xee6b280', type: '0x0', logsBloom: '0x' + '00'.repeat(256),
    logs: [{
      address: consensus,
      topics: encodeEventTopics({ abi: eventAbi, eventName: 'CreatedTransaction', args: { txId: emittedId } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [1n]), blockNumber: '0x5', blockHash: genesis,
      transactionHash: envelope, transactionIndex: '0x0', logIndex: '0x0', removed: false,
    }],
  };
}
function mockRpc(request: Request) {
  rpcCalls.push(request);
  switch (request.method) {
    case 'eth_getBlockByNumber': return block();
    case 'eth_getTransactionCount': return '0x2';
    case 'eth_getTransactionReceipt': return receipt();
    case 'eth_gasPrice': return '0xee6b280';
    case 'eth_estimateGas': {
      if (gasRejected) throw new Error('Execution reverted during gas estimation');
      return '0x186a0';
    }
    case 'eth_call': {
      const [{ to, data }] = request.params!;
      assert.equal(to.toLowerCase(), testnetBradbury.feeManagerContract!.address.toLowerCase());
      const value = feeSelectors.get(data.slice(0, 10));
      assert.notEqual(value, undefined, 'Unexpected FeeManager call');
      return toHex(value as bigint, { size: 32 });
    }
    case 'gen_call':
      if (simulationRejected) throw new Error('Assessment simulation rejected');
      return { data: toHex(abi.calldata.encode(null)), genvm_result: { fee_accounting: { execution_fee_consumed: '75000000000000' } } };
    default: throw new Error('Unexpected mock RPC call: ' + request.method);
  }
}

function installWallet(options: {
  wallet?: 'metamask' | 'rabby'; chain?: string; genesis?: string; unknown?: boolean;
  stuck?: boolean; reject?: string; selected?: Array<Address | undefined>;
} = {}) {
  let chain = options.chain ?? chainId;
  let unknown = options.unknown;
  const provider = {
    switchTo(value: string) { chain = value; },
    isMetaMask: options.wallet !== 'rabby',
    isRabby: options.wallet === 'rabby',
    async request(request: Request) {
      walletCalls.push(request);
      if (request.method === options.reject) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      switch (request.method) {
        case 'eth_requestAccounts': return [caller];
        case 'eth_accounts': {
          const account = options.selected?.length ? options.selected.shift() : caller;
          return account ? [account] : [];
        }
        case 'eth_chainId': return chain;
        case 'eth_getBlockByNumber':
          assert.deepEqual(request.params, ['0x0', false]);
          return { hash: options.genesis ?? genesis };
        case 'wallet_switchEthereumChain':
          assert.deepEqual(request.params, [{ chainId }]);
          if (unknown) throw Object.assign(new Error('Unknown network'), { code: 4902 });
          if (!options.stuck) chain = chainId;
          return null;
        case 'wallet_addEthereumChain':
          assert.deepEqual(request.params, [{
            chainId, chainName: 'GenLayer Bradbury Phase 2', rpcUrls: ['https://rpc.testnet-chain.genlayer.com'],
            nativeCurrency: { name: 'GEN Token', symbol: 'GEN', decimals: 18 },
            blockExplorerUrls: ['https://scan.testnet-chain.genlayer.com'],
          }]);
          unknown = false;
          return null;
        case 'eth_sendTransaction':
          unsigned.push(request.params![0]);
          // This is a fixture hash. No signer or RPC transport is invoked.
          return envelope;
        default: throw new Error('Unexpected mock wallet request: ' + request.method);
      }
    },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { ethereum: provider } });
  return provider;
}

before(async () => {
  // Vite transforms import.meta.env in an in-memory module runner. No server listens.
  server = await createServer({
    configFile: false, envFile: false, logLevel: 'silent',
    server: { middlewareMode: true, ws: false, watcher: null },
    define: {
      'import.meta.env.VITE_ENABLE_WALLET_WRITES': JSON.stringify('true'),
      'import.meta.env.VITE_SCOPEPULSE_CONTRACT': JSON.stringify(contract),
      'import.meta.env.VITE_BRADBURY_RPC': JSON.stringify('https://bradbury.invalid'),
      'import.meta.env.VITE_ASSESS_LEADER_TIMEUNITS': 'undefined',
      'import.meta.env.VITE_ASSESS_VALIDATOR_TIMEUNITS': 'undefined',
      'import.meta.env.VITE_ASSESS_EXECUTION_BUDGET_WEI': 'undefined',
    },
  });
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input).replace(/\/$/, ''), 'https://bradbury.invalid');
    const request = JSON.parse(String(init?.body));
    try {
      return Response.json({ jsonrpc: '2.0', id: request.id, result: mockRpc(request) });
    } catch (error) {
      return Response.json({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: (error as Error).message } });
    }
  }) as typeof fetch;
  app = await server.ssrLoadModule('/src/chain-rpc.ts') as Module;
  realGetTransaction = app.read.getTransaction;
  realReadContract = app.read.readContract;
});

after(async () => {
  globalThis.fetch = realFetch;
  if (realWindow) Object.defineProperty(globalThis, 'window', realWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  await server?.close();
});

beforeEach(() => {
  // The pinned SDK logs expected rejected RPC calls before propagating the errors.
  mock.method(console, 'error', () => {});
  mock.method(console, 'warn', () => {});
  rpcCalls = []; walletCalls = []; unsigned = [];
  rpcGenesis = genesis; receiptStatus = '0x1'; receiptHash = envelope; receiptRecipient = consensus; emittedId = genId; gasRejected = false; simulationRejected = false;
  app.read.getTransaction = realGetTransaction;
  app.read.readContract = realReadContract;
});

afterEach(() => mock.restoreAll());

function assertAssessmentCalldata(data: Hash) {
  const decoded = decodeInputData(data, contract);
  assert.ok(decoded && 'callData' in decoded);
  const call = decoded.callData;
  assert.equal(call instanceof Map ? call.get('') : call[''], 'assess');
  assert.deepEqual(call instanceof Map ? call.get('args') : call.args, [id, original, revised]);
  assert.equal(decoded.leaderOnly, false);
}

async function buildSubmission() {
  const wallet = await app.connectWallet();
  const estimate = await app.quote(original, revised, id, wallet.caller);
  const tracked: Parameters<Parameters<Module['submit']>[5]>[0][] = [];
  await app.submit(wallet, id, original, revised, estimate.fees, reference => tracked.push(reference));
  return { wallet, estimate, tracked };
}

for (const wallet of ['metamask', 'rabby'] as const) {
  test(`${wallet} mock quotes, builds an unsigned assessment and tracks both identifiers`, async () => {
    installWallet({ wallet, chain: wallet === 'rabby' ? '0x1' : chainId, unknown: wallet === 'rabby' });
    const { estimate, tracked } = await buildSubmission();
    assert.equal(estimate.fees.feeValue, deposit);
    assert.equal(estimate.label, '0.100000000000010352 GEN');
    const simulation = rpcCalls.find(call => call.method === 'gen_call')?.params?.[0];
    assert.equal(simulation.from.toLowerCase(), caller);
    assert.equal(simulation.to.toLowerCase(), contract.toLowerCase());
    assert.equal(simulation.type, 'write');
    assert.equal(simulation.value, undefined);
    assertAssessmentCalldata(simulation.data);
    assert.equal(unsigned.length, 1);
    const tx = unsigned[0];
    assert.equal(tx.chainId, chainId);
    assert.equal(tx.to.toLowerCase(), consensus.toLowerCase());
    assert.equal(tx.from.toLowerCase(), caller);
    assert.equal(BigInt(tx.value), deposit);
    const gasRequests = rpcCalls.filter(request => request.method === 'eth_estimateGas');
    assert.equal(gasRequests.length, 2);
    for (const request of gasRequests) {
      const payload = request.params![0];
      assert.equal(payload.from.toLowerCase(), caller);
      assert.equal(payload.to.toLowerCase(), consensus.toLowerCase());
      assert.equal(payload.data, tx.data);
      assert.equal(BigInt(payload.value), deposit);
    }
    assert.ok(BigInt(tx.gas) >= 100000n);
    assert.equal(tx.gasPrice, '0xee6b280');
    assert.equal(tx.nonce, '0x2');
    assert.deepEqual(rpcCalls.find(call => call.method === 'eth_getTransactionCount')?.params, [caller, 'pending']);
    const decoded = decodeFunctionData({ abi: mainAbi, data: tx.data });
    assert.equal(decoded.functionName, 'addTransaction');
    const payload = decoded.args![0] as any;
    assert.equal(payload.sender.toLowerCase(), caller);
    assert.equal(payload.recipient.toLowerCase(), contract.toLowerCase());
    assert.equal(payload.userValue, 0n);
    assert.deepEqual(payload.feesDistribution, estimate.fees.distribution);
    assert.deepEqual(payload.messageAllocations, []);
    assertAssessmentCalldata(payload.txCalldata);
    assert.deepEqual(tracked.map(item => [item.envelope, item.hash]), [[envelope, undefined], [envelope, genId]]);
    assert.equal(walletCalls.filter(call => call.method === 'eth_sendTransaction').length, 1);
    assert.equal(walletCalls.filter(call => /sign|approve/i.test(call.method)).length, 0);
    assert.equal(walletCalls.some(call => call.method === 'wallet_addEthereumChain'), wallet === 'rabby');
  });
}

test('rejects wrong chain, stale Bradbury genesis, and wrong app RPC genesis', async () => {
  installWallet({ chain: '0x1', stuck: true });
  await assert.rejects(app.connectWallet(), /Switch your wallet to Bradbury/);
  installWallet({ genesis: envelope });
  await assert.rejects(app.connectWallet(), /Update your wallet’s Bradbury RPC/);
  installWallet();
  rpcGenesis = envelope;
  await assert.rejects(app.connectWallet(), /configured node is not Bradbury/);
  assert.equal(unsigned.length, 0);
});

test('blocks a network change after quoting and before the wallet request', async () => {
  const provider = installWallet();
  const wallet = await app.connectWallet();
  const { fees } = await app.quote(original, revised, id, caller);
  provider.switchTo('0x1');
  await assert.rejects(app.submit(wallet, id, original, revised, fees, () => assert.fail('Unexpected tracking')), /chain|Bradbury/i);
  assert.equal(walletCalls.filter(request => request.method === 'eth_sendTransaction').length, 0);
});

test('rejects account changes both before estimation and immediately before the wallet request', async () => {
  for (const accounts of [[other], [caller, other], [caller, undefined]] as Array<Array<Address | undefined>>) {
    installWallet({ selected: accounts });
    const wallet = await app.connectWallet();
    const { fees } = await app.quote(original, revised, id, caller);
    await assert.rejects(app.submit(wallet, id, original, revised, fees, () => assert.fail('Unexpected tracking')), /selected account changed/);
  }
  assert.equal(walletCalls.filter(request => request.method === 'eth_sendTransaction').length, 0);
});

test('rejects declined wallet connection, chain switch, and signing requests', async () => {
  for (const reject of ['eth_requestAccounts', 'wallet_switchEthereumChain']) {
    installWallet({ reject, chain: '0x1' });
    await assert.rejects(app.connectWallet(), /User rejected/);
  }
  installWallet({ reject: 'eth_sendTransaction' });
  const wallet = await app.connectWallet();
  const { fees } = await app.quote(original, revised, id, caller);
  await assert.rejects(app.submit(wallet, id, original, revised, fees, () => assert.fail('Unexpected tracking')), /User rejected/);
  assert.equal(unsigned.length, 0);
});

test('rejects fee simulation failure and guards against the SDK gas-estimation fallback', async () => {
  installWallet();
  const wallet = await app.connectWallet();
  simulationRejected = true;
  await assert.rejects(app.quote(original, revised, id, caller), /Assessment simulation rejected/);
  simulationRejected = false;
  const { fees } = await app.quote(original, revised, id, caller);
  gasRejected = true;
  await assert.rejects(app.submit(wallet, id, original, revised, fees, () => assert.fail('Unexpected tracking')), /gas/i);
  assert.equal(unsigned.length, 0);
});

test('rejects unsigned requests with altered outer fields, assessment calldata or fee fields', async () => {
  installWallet();
  const { estimate } = await buildSubmission();
  const tx = unsigned[0];
  const expected = { caller, contract, id, original, revised, fees: estimate.fees } as const;
  app.assertAssessmentRequest(tx, expected);
  const decoded = decodeFunctionData({ abi: mainAbi, data: tx.data });
  const payload = decoded.args![0] as Record<string, unknown>;
  const encode = (fields: Record<string, unknown>) => encodeFunctionData({ abi: mainAbi, functionName: 'addTransaction', args: [{ ...payload, ...fields }] });
  const assessmentData = (method: string, args: string[], leaderOnly = false) =>
    abi.transactions.serialize([abi.calldata.encode(abi.calldata.makeCalldataObject(method, args, undefined)), leaderOnly]);
  for (const altered of [
    { chainId: '0x1' }, { from: other }, { to: other }, { value: toHex(deposit + 1n) }, { value: '0x0' }, { value: 'invalid' },
    { data: encode({ recipient: other }) }, { data: encode({ sender: other }) }, { data: encode({ userValue: 1n }) },
    { data: encode({ feesDistribution: { ...estimate.fees.distribution, leaderTimeunitsAllocation: estimate.fees.distribution.leaderTimeunitsAllocation + 1n } }) },
    { data: encode({ txCalldata: assessmentData('get_assessment', [id, original, revised]) }) },
    { data: encode({ txCalldata: assessmentData('assess', [id, original, revised + ' Altered']) }) },
    { data: encode({ txCalldata: assessmentData('assess', [id, original, revised], true) }) },
    { data: undefined }, { data: '0x12345678' }, { gas: '0x0' },
  ]) assert.throws(() => app.assertAssessmentRequest({ ...tx, ...altered }, expected));
  assert.throws(() => app.assertAssessmentRequest(tx, { ...expected, fees: { ...estimate.fees, feeValue: deposit + 1n } }), /reviewed Bradbury fee/);
});

function mockAssessment(options: { status?: string; execution?: string; sender?: Address; recipient?: Address; requestId?: string; result?: string } = {}) {
  const reads: unknown[] = [];
  app.read.getTransaction = async ({ hash }) => {
    assert.equal(hash, genId);
    return {
      statusName: options.status ?? 'FINALIZED',
      txExecutionResultName: options.execution ?? 'FINISHED_WITH_RETURN',
      sender: options.sender ?? caller,
      recipient: options.recipient ?? contract,
      txDataDecoded: { type: 'call', leaderOnly: false, callData: new Map<string, unknown>([['', 'assess'], ['args', [options.requestId ?? id, original, revised]]]) },
    } as Awaited<ReturnType<Module['read']['getTransaction']>>;
  };
  app.read.readContract = (async (request: unknown) => {
    reads.push(request);
    assert.deepEqual(request, { address: contract, functionName: 'get_assessment', args: [caller, id], transactionHashVariant: 'latest-final' });
    return options.result ?? JSON.stringify(outcome);
  }) as Module['read']['readContract'];
  return reads;
}

test('recovers from the wallet hash and GenLayer ID without consulting any wallet', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { get ethereum() { assert.fail('Recovery accessed a wallet'); } } });
  const reads = mockAssessment();
  for (const result of [
    await app.verifyAssessment('wallet', envelope),
    await app.verifyAssessment('genlayer', genId),
    await app.observe({ id, at: 1, contract, caller, envelope }),
  ]) {
    assert.equal(result.state, 'verified');
    assert.equal(result.hash, genId);
    assert.equal(result.contract, contract);
    assert.equal(result.caller, caller);
    assert.equal(result.requestId, id);
    assert.deepEqual(result.result, outcome);
  }
  assert.equal(reads.length, 3);
  assert.deepEqual(walletCalls, []);
});

test('separates pending, cancelled, execution failures, invalid results, and mismatched receipts', async () => {
  const reference = { id, at: 1, contract, caller, envelope, hash: genId };
  for (const [fixture, state] of [
    [{ status: 'PENDING' }, 'pending'],
    [{ status: 'CANCELED' }, 'failed'],
    [{ execution: 'FINISHED_WITH_ERROR' }, 'failed'],
    [{ result: '' }, 'awaiting-readback'],
    [{ result: '{broken' }, 'invalid'],
    [{ result: JSON.stringify({ ...outcome, evidence: [null] }) }, 'invalid'],
    [{ result: JSON.stringify({ ...outcome, evidence: [{ original: 'invented', revised }] }) }, 'invalid'],
    [{ sender: other }, 'invalid'],
    [{ recipient: other }, 'invalid'],
    [{ requestId: 'f'.repeat(32) }, 'invalid'],
  ] as const) {
    mockAssessment(fixture);
    const result = await app.observe(reference);
    assert.equal(result.state, state);
    assert.equal(result.result, undefined);
  }
  emittedId = envelope;
  assert.equal((await app.observe(reference)).state, 'invalid');
  receiptStatus = '0x0';
  assert.equal((await app.verifyAssessment('wallet', envelope)).state, 'failed');
  receiptStatus = '0x1';
  receiptHash = genId;
  assert.equal((await app.verifyAssessment('wallet', envelope)).state, 'failed');
  receiptHash = envelope;
  receiptRecipient = other;
  assert.equal((await app.verifyAssessment('wallet', envelope)).state, 'failed');
});

test('retains the wallet hash if the SDK reports an L2 revert after handoff', async () => {
  installWallet();
  const wallet = await app.connectWallet();
  const { fees } = await app.quote(original, revised, id, caller);
  receiptStatus = '0x0';
  const tracked: Parameters<Parameters<Module['submit']>[5]>[0][] = [];
  await assert.rejects(app.submit(wallet, id, original, revised, fees, reference => tracked.push(reference)), /revert/i);
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].envelope, envelope);
  assert.equal(tracked[0].hash, undefined);
  assert.equal((await app.observe(tracked[0])).state, 'failed');
});
