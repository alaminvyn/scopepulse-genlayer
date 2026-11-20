export type DiffLine = { kind: 'same' | 'removed' | 'added'; text: string };
export const MAX_BYTES = 2048;
export const byteCount = (text: string) => new TextEncoder().encode(text).length;

export function compare(original: string, revised: string): DiffLine[] {
  const oldLines = original ? original.split(/\r?\n/) : [];
  const newLines = revised ? revised.split(/\r?\n/) : [];
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
