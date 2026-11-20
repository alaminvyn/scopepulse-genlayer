import { useEffect, useState } from 'react';
import { Clipboard, Printer, Search } from 'lucide-react';
import { explorer, verifyAssessment, type Observation, type Reference } from './chain';
import { Comparison } from './comparison';
import { hashPattern, parseLookup, type LookupKind } from './verification';

export function reportPath(kind: LookupKind, hash: string) {
  return `#verify/${kind}/${hash.toLowerCase()}`;
}

export function VerifyReport({ path, onSave }: { path: string; onSave: (reference: Reference) => boolean }) {
  const lookup = parseLookup(path);
  const [kind, setKind] = useState<LookupKind>(lookup?.kind ?? 'genlayer');
  const [input, setInput] = useState(lookup?.hash ?? '');
  const [attempt, setAttempt] = useState(0);
  const [observation, setObservation] = useState<Observation>();
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!lookup) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    async function check() {
      let value: Observation;
      try { value = await verifyAssessment(lookup!.kind, lookup!.hash); }
      catch { value = { state: 'unavailable', phase: 'Bradbury data unavailable · check the identifier or retry' }; }
      if (!active) return;
      setObservation(value);
      if (!value.terminal && ++retries < 4) timer = setTimeout(check, 12000);
    }
    void check();
    return () => { active = false; clearTimeout(timer); };
  }, [lookup?.kind, lookup?.hash, attempt]);

  function refresh() {
    setObservation(undefined);
    setAttempt(value => value + 1);
  }

  return <>
    <div className="page-title"><h1>Verify assessment</h1><p>Look up a ScopePulse transaction on Bradbury. No wallet required.</p></div>
    <form className="panel verify-form" onSubmit={event => {
      event.preventDefault();
      const hash = input.trim();
      if (!hashPattern.test(hash)) { setFormError('Enter a 0x-prefixed, 64-digit hexadecimal identifier.'); return; }
      setFormError('');
      const next = reportPath(kind, hash);
      if (location.hash === next) refresh();
      else location.hash = next;
    }}>
      <label>Identifier type<select value={kind} onChange={event => setKind(event.target.value as LookupKind)}><option value="genlayer">GenLayer ID</option><option value="wallet">Wallet transaction hash</option></select></label>
      <label className="verify-id">Transaction identifier<input value={input} onChange={event => setInput(event.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off"/></label>
      <button className="button primary"><Search size={16}/> Verify</button>
      {(formError || path && !lookup) && <p className="notice" role="alert">{formError || 'This report link is invalid.'}</p>}
    </form>
    {lookup && <section className="panel">
      <header className="panel-head"><div><h2>Bradbury assessment report</h2><p>Phase 2 testnet · chain ID 4221</p></div><button className="button small" onClick={refresh}>Recheck</button></header>
      <div className="result-body">
        <p className="report-phase" role="status">{observation?.phase ?? 'Checking Bradbury'}</p>
        <p className="transaction-id">{lookup.kind === 'wallet' ? 'Wallet transaction hash' : 'GenLayer ID'} <code>{lookup.hash}</code></p>
        {lookup.kind === 'wallet' && observation?.hash && <p className="transaction-id">GenLayer ID <code>{observation.hash}</code></p>}
        {observation?.contract && <p className="transaction-id">ScopePulse contract <code>{observation.contract}</code></p>}
        {observation?.caller && <p className="transaction-id">Submitter <code>{observation.caller}</code></p>}
        {observation?.requestId && <p className="transaction-id">Request ID <code>{observation.requestId}</code></p>}
        {observation?.envelope && <a href={explorer(observation.envelope)} target="_blank" rel="noreferrer">View wallet transaction in explorer</a>}
        {observation?.verifiedAt && <p className="transaction-id">Verified at <time dateTime={new Date(observation.verifiedAt).toISOString()}>{new Date(observation.verifiedAt).toISOString()}</time></p>}
        <div className="actions report-actions">
          <button className="button small" onClick={async () => {
            try { await navigator.clipboard.writeText(location.origin + location.pathname + reportPath(lookup.kind, lookup.hash)); setNotice('Report link copied.'); }
            catch { setNotice('Copy the report address from the browser address bar.'); }
          }}><Clipboard size={15}/> Copy report link</button>
          {observation?.result && <><button className="button small" onClick={() => window.print()}><Printer size={15}/> Print report</button>
            <button className="button small" onClick={() => {
              if (!observation.hash || !observation.contract || !observation.caller || !observation.requestId) return;
              const saved = onSave({ id: observation.requestId, caller: observation.caller, contract: observation.contract, hash: observation.hash, envelope: observation.envelope, at: Date.now(), recovered: true });
              setNotice(saved ? 'Report added to browser history.' : 'History could not be saved. Copy the report link to keep it.');
            }}>Save to history</button></>}
        </div>
        {notice && <p role="status">{notice}</p>}
        {observation?.result && <p className="transaction-id print-link">{location.origin + location.pathname + reportPath(lookup.kind, lookup.hash)}</p>}
      </div>
    </section>}
    {observation?.result && <section className="print-link"><h2>Original requirements</h2><pre>{observation.original}</pre><h2>Revised requirements</h2><pre>{observation.revised}</pre></section>}
    {observation?.result && <Comparison original={observation.original!} revised={observation.revised!} assessment={observation.result} provenance="Verified GenLayer verdict"/>}
  </>;
}
