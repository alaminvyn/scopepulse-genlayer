export const hashPattern = /^0x[0-9a-f]{64}$/i;

export const verdictCodes = ['compatible', 'potential_conflict', 'needs_review'] as const;
export type Verdict = typeof verdictCodes[number];
export type Assessment = { verdict: Verdict; rationale: string; evidence: { original: string; revised: string }[] };

export function parseAssessment(raw: string, original: string, revised: string): Assessment | undefined {
  try {
    const value = JSON.parse(raw);
    if (!value || !verdictCodes.includes(value.verdict) || typeof value.rationale !== 'string' ||
        !value.rationale.trim() || [...value.rationale].length > 420 || !Array.isArray(value.evidence) ||
        value.evidence.length < 1 || value.evidence.length > 2) return;
    if (!value.evidence.every((pair: unknown) => {
      if (!pair || typeof pair !== 'object' || !('original' in pair) || !('revised' in pair)) return false;
      return [[pair.original, original], [pair.revised, revised]].every(([excerpt, source]) =>
        typeof excerpt === 'string' && Boolean(excerpt.trim()) && [...excerpt].length <= 200 &&
        typeof source === 'string' && source.includes(excerpt));
    })) return;
    return value as Assessment;
  } catch {
    return undefined;
  }
}

export type LookupKind = 'genlayer' | 'wallet';
export function parseLookup(path: string): { kind: LookupKind; hash: `0x${string}` } | undefined {
  const [kind, hash, rest] = path.split('/');
  if ((kind !== 'genlayer' && kind !== 'wallet') || !hashPattern.test(hash ?? '') || rest !== undefined) return;
  return { kind, hash: hash.toLowerCase() as `0x${string}` };
}
