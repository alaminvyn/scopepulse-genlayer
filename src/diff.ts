export type DiffLine = { kind: 'same' | 'removed' | 'added'; text: string };
export const MAX_BYTES = 2048;
export const byteCount = (text: string) => new TextEncoder().encode(text).length;

export function compare(original: string, revised: string): DiffLine[] {
  const oldLines = original ? original.split(/\r?\n/) : [];
  const newLines = revised ? revised.split(/\r?\n/) : [];
  return compareTokens(oldLines, newLines);
}

function compareTokens(oldLines: string[], newLines: string[]): DiffLine[] {
  const common = Array.from({ length: oldLines.length + 1 }, () => new Uint16Array(newLines.length + 1));
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      common[i][j] = oldLines[i] === newLines[j]
        ? 1 + common[i + 1][j + 1]
        : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      lines.push({ kind: 'same', text: oldLines[i++] });
      j++;
    } else if (i < oldLines.length && (j === newLines.length || common[i + 1][j] >= common[i][j + 1])) {
      lines.push({ kind: 'removed', text: oldLines[i++] });
    } else {
      lines.push({ kind: 'added', text: newLines[j++] });
    }
  }
  return lines;
}

export type SourceLine = { number: number; text: string };
export type ReviewRow = { original?: SourceLine; revised?: SourceLine; changed: boolean; paired?: boolean };

const words = (value: string) => value.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [];

export function inlineChanges(original: string, revised: string) {
  const before = words(original);
  const after = words(revised);
  // Bound token work independently of the document input limit.
  if (before.length * after.length > 16000) return undefined;
  return compareTokens(before, after);
}

export function reviewRows(original: string, revised: string): ReviewRow[] {
  const lines = compare(original, revised);
  const rows: ReviewRow[] = [];
  let before = 0;
  let after = 0;
  for (let i = 0; i < lines.length;) {
    const line = lines[i++];
    if (line.kind === 'same') {
      rows.push({ original: { number: ++before, text: line.text }, revised: { number: ++after, text: line.text }, changed: false });
      continue;
    }
    const removed: SourceLine[] = [];
    const added: SourceLine[] = [];
    let next: DiffLine | undefined = line;
    while (next && next.kind !== 'same') {
      if (next.kind === 'removed') removed.push({ number: ++before, text: next.text });
      else added.push({ number: ++after, text: next.text });
      next = lines[i];
      if (next && next.kind !== 'same') i++;
    }
    if (removed.length === 1 && added.length === 1) {
      const a = removed[0].text.toLowerCase();
      const b = added[0].text.toLowerCase();
      const tokens = (text: string) => new Set(words(text).filter(word => /^[\p{L}]{3,}$/u.test(word)));
      const left = tokens(a);
      const right = tokens(b);
      const shared = [...left].filter(word => right.has(word)).length;
      if (shared >= 2 && shared / Math.max(left.size, right.size) >= 0.4) {
        rows.push({ original: removed[0], revised: added[0], changed: true, paired: true });
        continue;
      }
    }
    rows.push(...removed.map(value => ({ original: value, changed: true })), ...added.map(value => ({ revised: value, changed: true })));
  }
  return rows;
}

export function sourceMatches(text: string, excerpt: string) {
  const matches: { start: number; end: number }[] = [];
  if (!excerpt) return matches;
  for (let offset = text.indexOf(excerpt); offset >= 0; offset = text.indexOf(excerpt, offset + 1)) {
    const start = text.slice(0, offset).split('\n').length;
    const end = start + excerpt.split('\n').length - 1;
    if (!matches.some(match => match.start === start && match.end === end)) matches.push({ start, end });
  }
  return matches;
}

const signals = [
  ['Numbers or limits', /\d+(?:[.,]\d+)?/g],
  ['Timing or deadlines', /\b(?:before|after|daily|weekly|monthly|within|days?|hours?|minutes?|deadline)\b/gi],
  ['Access or roles', /\b(?:admin\w*|managers?|staff|users?|roles?|permissions?|authorized|access|approve)\b/gi],
  ['Obligation wording', /\b(?:must|shall|may|should|required|optional|only|at least|at most|never)\b/gi],
] as const;

export function changeCues(rows: ReviewRow[]) {
  return signals.filter(([, pattern]) => rows.some(row => row.changed &&
    JSON.stringify(row.original?.text.toLowerCase().match(pattern) ?? []) !==
    JSON.stringify(row.revised?.text.toLowerCase().match(pattern) ?? []))).map(([label]) => label);
}
