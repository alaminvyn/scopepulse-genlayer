import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAssessment, parseLookup } from '../src/verification.ts';

const original = 'Keep audit records for 90 days.';
const revised = 'Delete audit records after 30 days.';
const result = { verdict: 'potential_conflict', rationale: 'The retention terms conflict.', evidence: [{ original, revised }] };

test('validates verdicts and requires evidence from the corresponding versions', () => {
  assert.deepEqual(parseAssessment(JSON.stringify(result), original, revised), result);
  for (const invalid of [
    null, {}, { ...result, verdict: 'very_risky' }, { ...result, rationale: '' },
    { ...result, evidence: [null] }, { ...result, evidence: [{ original: revised, revised: original }] },
    { ...result, evidence: [{ original: 90, revised }] }, { ...result, evidence: [] },
    { ...result, evidence: [...result.evidence, ...result.evidence, ...result.evidence] },
  ]) assert.equal(parseAssessment(JSON.stringify(invalid), original, revised), undefined);
  assert.equal(parseAssessment('{broken}', original, revised), undefined);
});

test('report paths accept only a typed transaction identifier', () => {
  const hash = '0x' + 'AB'.repeat(32);
  assert.deepEqual(parseLookup('wallet/' + hash), { kind: 'wallet', hash: hash.toLowerCase() });
  assert.deepEqual(parseLookup('genlayer/' + hash), { kind: 'genlayer', hash: hash.toLowerCase() });
  for (const path of ['wallet/0x1', 'other/' + hash, 'wallet/' + hash + '/text', 'wallet/' + hash + '?requirements=private']) {
    assert.equal(parseLookup(path), undefined);
  }
});
