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
