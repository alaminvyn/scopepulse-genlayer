import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Columns2, Rows3 } from 'lucide-react';
import { byteCount, changeCues, inlineChanges, MAX_BYTES, reviewRows, sourceMatches, type ReviewRow, type SourceLine } from './diff';
import type { Assessment, Verdict } from './chain';

export const verdicts: Record<Verdict, string> = { compatible: 'Compatible', potential_conflict: 'Potential conflict', needs_review: 'Needs review' };

export function Comparison({ original, revised, assessment, provenance }: { original: string; revised: string; assessment?: Assessment; provenance?: string }) {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<'split' | 'unified'>('split');
  const [context, setContext] = useState(false);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [target, setTarget] = useState<number>();
  const [source, setSource] = useState<{ side: 'original' | 'revised'; start: number; end: number }>();
  const [jump, setJump] = useState(0);
  const limited = byteCount(original) > MAX_BYTES || byteCount(revised) > MAX_BYTES;
  const rows = useMemo(() => limited ? [] : reviewRows(original, revised), [limited, original, revised]);
  const hunks = rows.flatMap((row, index) => row.changed && !rows[index - 1]?.changed ? [index] : []);
  const additions = rows.filter(row => row.changed && row.revised).length;
  const removals = rows.filter(row => row.changed && row.original).length;
  const cues = changeCues(rows);

  useEffect(() => {
    setTarget(undefined);
    setSource(undefined);
    setExpanded([]);
  }, [original, revised]);

  useEffect(() => {
    if (target === undefined) return;
    const row = root.current?.querySelector<HTMLElement>(`[data-row="${target}"]`);
    row?.scrollIntoView({ block: 'nearest' });
    row?.focus({ preventScroll: true });
  }, [jump, target]);

  function navigate(index: number) {
    setSource(undefined);
    setTarget(index);
    setJump(value => value + 1);
  }

  function showSource(side: 'original' | 'revised', start: number, end: number) {
    const index = rows.findIndex(row => row[side]?.number === start);
    if (index < 0) return;
    setContext(true);
    setSource({ side, start, end });
    setTarget(index);
    setJump(value => value + 1);
  }

  function lineCell(row: ReviewRow, side: 'original' | 'revised', line: SourceLine | undefined) {
    const highlight = line && source?.side === side && line.number >= source.start && line.number <= source.end;
    const tokens = row.paired && row.original && row.revised ? inlineChanges(row.original.text, row.revised.text) : undefined;
    const omitted = side === 'original' ? 'added' : 'removed';
    const sign = row.changed ? side === 'original' ? '−' : '+' : '';
    return <div className={`diff-cell ${line && row.changed ? side : ''} ${highlight ? 'source-hit' : ''}`} aria-label={line ? `${side} line ${line.number}` : undefined}>
      <span className="line-gutter" aria-hidden="true">{line?.number} {line && sign}</span>
      <code>{line && (tokens ? tokens.filter(token => token.kind !== omitted).map((token, i) => token.kind === 'same' ? token.text : <mark key={i}>{token.text}</mark>) : line.text || ' ')}</code>
    </div>;
  }

  const selectedHunk = target === undefined ? -1 : hunks.filter(index => index <= target).length - 1;
  const visible = rows.flatMap((row, index) => {
    if (context || row.changed || rows[index - 1]?.changed || rows[index + 1]?.changed) return [{ row, index, hidden: 0 }];
    let start = index;
    while (start > 0 && !rows[start - 1].changed && !rows[start - 2]?.changed) start--;
    if (expanded.includes(start)) return [{ row, index, hidden: 0 }];
    if (start !== index) return [];
    let end = index + 1;
    while (end < rows.length && !rows[end].changed && !rows[end + 1]?.changed) end++;
    return [{ row, index, hidden: end - index }];
  });

  return <section className="panel diff-panel" ref={root}>
    <header className="panel-head"><div><h2>Text comparison</h2><p>Local analysis · changes calculated in this browser</p></div><div className="diff-count"><span className="plus">+{additions}</span><span className="minus">−{removals}</span></div></header>
    {limited ? <p className="empty">Trim each version to 2,048 bytes to compare.</p> : rows.length === 0 ? <p className="empty">Enter requirements to see changes here.</p> : <>
      <div className="diff-toolbar">
        <div className="segmented" aria-label="Comparison layout"><button aria-pressed={mode === 'split'} onClick={() => setMode('split')}><Columns2 size={15}/> Split</button><button aria-pressed={mode === 'unified'} onClick={() => setMode('unified')}><Rows3 size={15}/> Unified</button></div>
        <label><input type="checkbox" checked={context} onChange={event => setContext(event.target.checked)}/> Show unchanged</label>
        <div className="actions"><button className="button small" aria-label="Previous change" disabled={selectedHunk <= 0} onClick={() => navigate(hunks[selectedHunk - 1])}><ChevronUp size={15}/></button><button className="button small" aria-label="Next change" disabled={selectedHunk >= hunks.length - 1} onClick={() => navigate(hunks[selectedHunk + 1])}><ChevronDown size={15}/></button></div>
      </div>
      {hunks.length > 0 && <nav className="change-map" aria-label="Change map">{hunks.map((index, i) => <button key={index} aria-current={i === selectedHunk ? 'location' : undefined} onClick={() => navigate(index)}>Change {i + 1}</button>)}</nav>}
      {cues.length > 0 && <p className="change-cues"><strong>Local cues</strong> {cues.join(' · ')}</p>}
      <div className={`review-diff ${mode}`} aria-label="Requirement changes">
        <div className="diff-labels"><span>Original</span><span>Revised</span></div>
        {visible.map(({ row, index, hidden }) => hidden
          ? <button className="context-control" key={index} onClick={() => setExpanded(current => [...current, index])}>Show {hidden} unchanged {hidden === 1 ? 'line' : 'lines'}</button>
          : <div key={index} id={`${id}-row-${index}`} data-row={index} tabIndex={-1} className={`review-row ${index === target ? 'target-row' : ''}`}>
              {(mode === 'split' || row.original && (row.changed || source?.side === 'original' && !row.changed)) && lineCell(row, 'original', row.original)}
              {(mode === 'split' || row.revised && (row.changed || source?.side !== 'original')) && lineCell(row, 'revised', row.revised)}
            </div>)}
      </div>
    </>}
    {assessment && <div className="result-body"><h3 className="evidence-heading">{provenance}</h3>
      <span className={`tag ${assessment.verdict}`}>{verdicts[assessment.verdict]}</span>
      <p className="assessment-rationale">{assessment.rationale}</p>
      {assessment.evidence.map((pair, index) => <div className="two evidence-pair" key={index}>
        {(['original', 'revised'] as const).map(side => <blockquote key={side}><small>{side === 'original' ? 'Original evidence' : 'Revised evidence'}</small>{pair[side]}
          <div className="source-links">{sourceMatches(side === 'original' ? original : revised, pair[side]).map(({ start, end }) => <button className="button small" key={`${start}-${end}`} onClick={() => showSource(side, start, end)}>{start === end ? `Line ${start}` : `Lines ${start}–${end}`}</button>)}</div>
        </blockquote>)}
      </div>)}
    </div>}
  </section>;
}
