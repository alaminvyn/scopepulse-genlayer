import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byteCount, compare } from '../src/diff.ts';

test('preserves original lines and marks inserted requirements', () => {
  assert.deepEqual(compare('Export PDF\nInclude the date', 'Export PDF\nExport CSV\nInclude the date'), [
    { kind: 'same', text: 'Export PDF' },
    { kind: 'added', text: 'Export CSV' },
    { kind: 'same', text: 'Include the date' },
  ]);
});

test('shows both sides of an explicit replacement', () => {
  assert.deepEqual(compare('Retain for 90 days', 'Delete after 30 days'), [
    { kind: 'removed', text: 'Retain for 90 days' },
    { kind: 'added', text: 'Delete after 30 days' },
  ]);
});

test('handles empty input, CRLF and UTF-8 lengths', () => {
  assert.deepEqual(compare('', ''), []);
  assert.equal(compare('a\r\nb', 'a\nb').filter(line => line.kind === 'same').length, 2);
  assert.equal(byteCount('🟢'), 4);
});

import { changeCues, inlineChanges, reviewRows, sourceMatches } from '../src/diff.ts';

test('pairs a clear replacement, numbers both sides and flags local wording changes', () => {
  const rows = reviewRows('Retain audit logs for 90 days.\nOnly admins can read them.', 'Retain audit logs for 30 days.\nOnly admins can read them.');
  assert.equal(rows[0].paired, true);
  assert.equal(rows[1].original?.number, 2);
  assert.equal(rows[1].revised?.number, 2);
  assert.deepEqual(changeCues(rows), ['Numbers or limits']);
  assert.deepEqual(inlineChanges(rows[0].original!.text, rows[0].revised!.text)?.filter(token => token.kind !== 'same'), [
    { kind: 'removed', text: '90' }, { kind: 'added', text: '30' },
  ]);
});

test('keeps unrelated replacements separate and preserves reordered and repeated text', () => {
  const distinct = reviewRows('Archive files.\nStable', 'Resize images.\nStable');
  assert.equal(distinct[0].revised, undefined);
  assert.equal(distinct[1].original, undefined);
  const original = 'first\nrepeat\nsecond\nrepeat';
  const revised = 'second\nrepeat\nfirst\nrepeat';
  const rows = reviewRows(original, revised);
  assert.equal(rows.flatMap(row => row.original?.text ?? []).join('\n'), original);
  assert.equal(rows.flatMap(row => row.revised?.text ?? []).join('\n'), revised);
});

test('finds each source line range for repeated and multiline evidence', () => {
  assert.deepEqual(sourceMatches('A\nB\nA\nB', 'A\nB'), [{ start: 1, end: 2 }, { start: 3, end: 4 }]);
  assert.deepEqual(sourceMatches('A', 'missing'), []);
  assert.deepEqual(sourceMatches('A', ''), []);
});

test('handles whitespace and Unicode and bounds inline token work', () => {
  assert.deepEqual(inlineChanges('État ✓', 'État ✗')?.filter(token => token.kind !== 'same'), [
    { kind: 'removed', text: '✓' }, { kind: 'added', text: '✗' },
  ]);
  assert.equal(inlineChanges('a '.repeat(500), 'b '.repeat(500)), undefined);
  assert.deepEqual(reviewRows('', ''), []);
  assert.equal(reviewRows('A', 'A ')[0].changed, true);
});
