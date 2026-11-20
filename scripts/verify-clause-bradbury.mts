import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient, isSuccessful } from 'genlayer-js';
import { testnetBradbury as chain } from 'genlayer-js/chains';
import { TransactionHashVariant, type ContractSchema, type TransactionHash } from 'genlayer-js/types';
import { formatEther, isAddress, parseAbi, parseEventLogs, type Address, type Hash } from 'viem';
import { deployment as baseline } from '../src/examples.ts';
import { hashPattern } from '../src/verification.ts';

const endpoint = 'https://rpc-bradbury.genlayer.com';
const client = createClient({ chain, endpoint });
const source = await readFile(new URL('../contracts/scopepulse.py', import.meta.url), 'utf8');
const clause = 'Audit logs must be retained for at least 90 days.';
const requirement = 'Delete all audit logs after 30 days.';
const createdAbi = parseAbi(['event CreatedTransaction(bytes32 indexed txId,uint256 txSlot)']);

// Use explicit ID prefixes because both layers use 32-byte hashes.
async function resolveId(reference: string) {
  const [kind, value, extra] = reference.split(':');
  assert.ok(extra === undefined && hashPattern.test(value ?? ''), 'Use genlayer:0x… or wallet:0x…');
  const hash = value.toLowerCase() as Hash;
  if (kind === 'genlayer') return { id: hash };
  assert.equal(kind, 'wallet', 'Unknown transaction ID type');
  const receipt = await client.getTransactionReceipt({ hash });
  const consensus = chain.consensusMainContract!;
  assert.equal(receipt.status, 'success', 'L2 receipt reverted');
  assert.equal(receipt.transactionHash.toLowerCase(), hash);
  assert.equal(receipt.to?.toLowerCase(), consensus.address.toLowerCase());
  const logs = receipt.logs.filter(log => log.address.toLowerCase() === consensus.address.toLowerCase());
  const events = parseEventLogs({ abi: consensus.abi, eventName: 'NewTransaction', logs });
  const candidates = [
    ...events.map(event => (event as { args?: { txId?: string } }).args?.txId),
    ...parseEventLogs({ abi: createdAbi, logs }).map(event => event.args.txId),
  ];
  const ids = new Set(candidates.filter((id): id is string => !!id && hashPattern.test(id)).map(id => id.toLowerCase()));
  assert.equal(ids.size, 1, 'Expected exactly one GenLayer ID in the L2 receipt');
  return { id: [...ids][0] as Hash, walletHash: hash, l2Explorer: 'https://scan.testnet-chain.genlayer.com/tx/' + hash };
}

async function finalized(reference: string) {
  const ids = await resolveId(reference);
  const tx = await client.getTransaction({ hash: ids.id as TransactionHash });
  assert.equal(tx.statusName, 'FINALIZED', `GenLayer transaction ${ids.id} is not finalized`);
  assert.equal(tx.txExecutionResultName, 'FINISHED_WITH_RETURN', 'GenLayer execution failed');
  assert.ok(isSuccessful(tx));
  return { ids, tx };
}

function assertSchema(schema: ContractSchema) {
  assert.equal(schema.methods.assess?.readonly, false);
  assert.equal(schema.methods.get_assessment?.readonly, true);
  assert.equal(schema.methods.assess_clause?.readonly, false);
  assert.equal(schema.methods.get_clause_assessment?.readonly, true);
}

async function verifyDeployment(reference: string) {
  const { ids, tx } = await finalized(reference);
  const address = tx.recipient ?? tx.to_address;
  assert.ok(address && isAddress(address));
  assert.notEqual(address.toLowerCase(), baseline.address.toLowerCase(), 'Provide the milestone deployment');
  assert.equal(tx.txDataDecoded?.type, 'deploy');
  const code = await client.getContractCode(address);
  assert.ok(code === source || Buffer.from(code, 'base64').toString() === source, 'Deployed source differs from local milestone source');
  assertSchema(await client.getContractSchema(address));
  return { ...ids, address, consensus: tx.statusName, execution: tx.txExecutionResultName, sourceMatches: true };
}

async function verifyAssessment(reference: string, address: Address) {
  const { ids, tx } = await finalized(reference);
  assert.equal((tx.recipient ?? tx.to_address)?.toLowerCase(), address.toLowerCase(), 'Wrong assessment recipient');
  const caller = tx.sender ?? tx.from_address;
  assert.ok(caller && isAddress(caller), 'Invalid assessment caller');
  const decoded = tx.txDataDecoded;
  assert.ok(decoded && 'callData' in decoded && decoded.type === 'call' && !decoded.leaderOnly);
  const call = decoded.callData;
  assert.ok(call && typeof call === 'object');
  const method = call instanceof Map ? call.get('') : call[''];
  const args = call instanceof Map ? call.get('args') : call.args;
  const kwargs = call instanceof Map ? call.get('kwargs') : call.kwargs;
  assert.equal(method, 'assess_clause');
  assert.ok(!kwargs && Array.isArray(args) && args.length === 3 && args.every(value => typeof value === 'string'));
  const [requestId, policy, proposed] = args as [string, string, string];
  assert.match(requestId, /^[0-9a-f]{32}$/);
  for (const input of [policy, proposed]) {
    assert.ok(input.trim() && Buffer.byteLength(input) <= 2048);
  }
  const raw = await client.readContract({
    address, functionName: 'get_clause_assessment', args: [caller, requestId],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  assert.ok(typeof raw === 'string' && raw.length, 'Missing final assessment state');
  const result = JSON.parse(raw);
  assert.ok(result && typeof result === 'object');
  assert.deepEqual(Object.keys(result).sort(), ['evidence', 'rationale', 'verdict']);
  assert.ok(['satisfies', 'violates', 'unclear'].includes(result.verdict));
  assert.ok(typeof result.rationale === 'string' && result.rationale.trim() && [...result.rationale].length <= 420);
  assert.ok(result.evidence && typeof result.evidence === 'object');
  assert.deepEqual(Object.keys(result.evidence).sort(), ['clause', 'requirement']);
  for (const [field, input] of [['clause', policy], ['requirement', proposed]]) {
    const excerpt = result.evidence[field];
    assert.ok(typeof excerpt === 'string' && excerpt.trim() && [...excerpt].length <= 200 && input.includes(excerpt),
      `Stored ${field} evidence is not an exact excerpt`);
  }
  return { ...ids, consensus: tx.statusName, execution: tx.txExecutionResultName, caller, requestId,
    method, clause: policy, requirement: proposed, result };
}

function validReference(reference: string) {
  return /^(genlayer|wallet):0x[0-9a-fA-F]{64}$/.test(reference);
}

const [mode, first, second, third, extra] = process.argv.slice(2);
if (mode === 'preflight') {
  assert.ok(!second && (!first || isAddress(first)), 'Usage: preflight [public-wallet-address]');
} else if (mode === 'quote-assessment') {
  assert.ok(!extra && validReference(first ?? '') && isAddress(second ?? '') && /^[0-9a-f]{32}$/.test(third ?? ''),
    'Usage: quote-assessment <deployment-ref> <public-wallet-address> <request-id>');
} else {
  assert.ok(mode === 'verify' && !third && validReference(first ?? '') && (!second || validReference(second)),
    'Usage: verify <deployment-ref> [assessment-ref]');
}

assert.equal(await client.getChainId(), 4221);
const genesis = await client.getBlock({ blockNumber: 0n });
assert.equal(genesis.hash, '0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4');
const network = { chainId: 4221, genesis: genesis.hash };
const sourceSha256 = createHash('sha256').update(source).digest('hex');
function print(output: object) {
  console.log(JSON.stringify({ ...network, sourceSha256, ...output }, null, 2));
}

if (mode === 'preflight') {
  assertSchema(await client.getContractSchemaForCode(source));
  const quote = await client.estimateTransactionFees();
  const balance = first ? await client.getBalance({ address: first as Address }) : undefined;
  print({ schemaValidated: true, sdkDefaultDeploymentDepositGEN: formatEther(quote.feeValue),
    wallet: first, walletBalanceGEN: balance === undefined ? undefined : formatEther(balance),
    depositCoveredBeforeGas: balance === undefined ? undefined : balance >= quote.feeValue });
} else if (mode === 'quote-assessment') {
  const deployment = await verifyDeployment(first);
  const account = second as Address;
  const quote = await createClient({ chain, endpoint, account }).estimateTransactionFeesForWrite({
    address: deployment.address, functionName: 'assess_clause', args: [third, clause, requirement],
  });
  const balance = await client.getBalance({ address: account });
  print({ deployment, requestId: third, clause, requirement, estimatedAssessmentDepositGEN: formatEther(quote.feeValue),
    wallet: account, walletBalanceGEN: formatEther(balance), depositCoveredBeforeGas: balance >= quote.feeValue });
} else {
  const deployment = await verifyDeployment(first);
  const assessment = second ? await verifyAssessment(second, deployment.address) : undefined;
  print({ deployment, assessment });
}
