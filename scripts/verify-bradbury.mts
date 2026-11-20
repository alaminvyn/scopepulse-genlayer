import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createClient, isSuccessful } from 'genlayer-js';
import { testnetBradbury as chain } from 'genlayer-js/chains';
import type { TransactionHash } from 'genlayer-js/types';
import { parseAbi, parseEventLogs } from 'viem';
import { deployment } from '../src/examples.ts';

const endpoint = 'https://rpc-bradbury.genlayer.com';
const client = createClient({ chain, endpoint });
const genesis = await client.getBlock({ blockNumber: 0n });
assert.equal(genesis.hash, '0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4');
const receipt = await client.getTransactionReceipt({ hash: deployment.envelope });
assert.equal(receipt.status, 'success');
const logs = receipt.logs.filter(log => log.address.toLowerCase() === chain.consensusMainContract?.address.toLowerCase());
const registered = parseEventLogs({ abi: chain.consensusMainContract!.abi, eventName: 'NewTransaction', logs })[0] as { args?: { txId?: string } } | undefined;
const created = parseEventLogs({ abi: parseAbi(['event CreatedTransaction(bytes32 indexed txId,uint256 txSlot)']), logs })[0];
assert.equal(registered?.args?.txId ?? created?.args.txId, deployment.id);
const transaction = await client.getTransaction({ hash: deployment.id as TransactionHash });
assert.equal(transaction.statusName, 'FINALIZED');
assert.equal(transaction.txExecutionResultName, 'FINISHED_WITH_RETURN');
assert.ok(isSuccessful(transaction));
assert.equal(transaction.txDataDecoded?.type, 'deploy');
assert.equal(transaction.recipient?.toLowerCase(), deployment.address.toLowerCase());
const code = await client.getContractCode(deployment.address);
const local = execFileSync('git', ['show', 'e8fa498dd38b56eef88fbcc9a77bd98a052c236a:contracts/scopepulse.py'], {
  cwd: new URL('../', import.meta.url), encoding: 'utf8',
});
assert.ok(code === local || Buffer.from(code, 'base64').toString() === local);
const schema = await client.getContractSchema(deployment.address);
assert.ok(schema.methods.assess && schema.methods.get_assessment);
const explorer = await fetch('https://scan.testnet-chain.genlayer.com/tx/' + deployment.envelope, { signal: AbortSignal.timeout(12000) });
assert.ok(explorer.ok);
console.log(JSON.stringify({ ...deployment, consensus: transaction.statusName, execution: transaction.txExecutionResultName, sourceMatches: true, checkedAt: new Date().toISOString() }, null, 2));
