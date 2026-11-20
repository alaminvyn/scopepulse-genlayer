import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Activity, BookOpen, CircleCheck, Clock3, FlaskConical, GitCompareArrows, History, LayoutGrid, Menu, Plus, ShieldAlert, SearchCheck, Wallet, X } from 'lucide-react';
import { type Hash } from 'viem';
import { byteCount, MAX_BYTES } from './diff';
import { deployment, examples } from './examples';
import { connectWallet, demoHash, errorMessage, explorer, hashPattern, observe, quote, ready, submit, contract, inspectDeployment, resolveEnvelope, type Assessment, type Observation, type Reference, walletWritesEnabled } from './chain';
import { Comparison, verdicts } from './comparison';
import { reportPath, VerifyReport } from './report';
import './style.css';

const Deployment = import.meta.env.DEV && walletWritesEnabled ? lazy(() => import('./deploy')) : null;

const paths = [
  ['dashboard', 'Overview', LayoutGrid], ['compare', 'New assessment', GitCompareArrows],
  ['history', 'History', History], ['verify', 'Verify assessment', SearchCheck], ['guide', 'Usage guide', BookOpen], ['demo', 'Reviewer demo', FlaskConical],
] as const;
const walletPaused = !walletWritesEnabled;
const storageKey = 'scopepulse.references.v1';

function readHistory(): Reference[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter(item => item && typeof item.id === 'string' && Number.isFinite(item.at) && Math.abs(item.at) <= 8.64e15 &&
      /^0x[\da-f]{40}$/i.test(item.caller) && /^0x[\da-f]{40}$/i.test(item.contract) &&
      (hashPattern.test(item.hash ?? '') || hashPattern.test(item.envelope ?? '')));
  } catch {
    return [];
  }
}

function Evidence({ result }: { result: Assessment }) {
  return <div className="evidence">
    <span className={`tag ${result.verdict}`}>{verdicts[result.verdict]}</span>
    <p>{result.rationale}</p>
    {result.evidence.map((pair, index) => <div className="two" key={index}>
      <blockquote><small>Original evidence</small>{pair.original}</blockquote>
      <blockquote><small>Revised evidence</small>{pair.revised}</blockquote>
    </div>)}
  </div>;
}

function DeploymentEvidence() {
  const [verification, setVerification] = useState('Checking Bradbury deployment');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const id = await resolveEnvelope(deployment.envelope);
        if (id.toLowerCase() !== deployment.id) throw new Error('Unexpected GenLayer deployment ID');
        const result = await inspectDeployment(deployment.id);
        if (!active) return;
        const address = result.address?.toLowerCase();
        setVerification(address === deployment.address.toLowerCase() && address === contract?.toLowerCase()
          ? 'FINALIZED · FINISHED_WITH_RETURN'
          : 'Deployment and app configuration could not be verified');
      } catch {
        if (active) setVerification('Live deployment verification unavailable');
      }
    }
    void check();
    return () => { active = false; };
  }, [attempt]);
  return <section className="panel">
    <header className="panel-head"><div><h2>Bradbury deployment evidence</h2><p>Contract creation and execution status.</p></div><button className="button small" onClick={() => { setVerification('Checking Bradbury deployment'); setAttempt(value => value + 1); }}>Recheck</button></header>
    <div className="result-body">
      <p role="status">{verification}</p>
      <p className="transaction-id">Contract <code>{deployment.address}</code></p>
      <p className="transaction-id">GenLayer deployment ID <code>{deployment.id}</code></p>
      <a href={explorer(deployment.envelope)} target="_blank" rel="noreferrer">View deployment transaction in explorer</a>
    </div>
  </section>;
}

function Result({ observation, reference, onRefresh }: { observation?: Observation; reference?: Reference; onRefresh: () => void }) {
  const result = observation?.result;
  const envelope = reference?.envelope ?? observation?.envelope;
  return <section className="panel result" aria-live="polite">
    <header className="panel-head"><div><h2>GenLayer assessment</h2><p>Semantic verdict and evidence from Bradbury.</p></div><ShieldAlert size={20} /></header>
    <div className="result-body">
      {!observation && !reference ? <p>Submit a comparison to begin consensus.</p> : <>
        <ol className="timeline">
          {reference && <li><span>{reference.recovered ? 'Saved to history' : 'Submitted'}</span><time>{new Date(reference.at).toLocaleString()}</time></li>}
          <li><span>{observation?.phase ?? 'Checking Bradbury'}</span>{!observation?.terminal && <button className="button small" onClick={onRefresh}>Refresh</button>}</li>
        </ol>
        {envelope && <a href={explorer(envelope)} target="_blank" rel="noreferrer">View wallet transaction in explorer</a>}
        {(observation?.hash ?? reference?.hash) && <p className="transaction-id">GenLayer ID <code>{observation?.hash ?? reference?.hash}</code></p>}
      </>}
      {result && <Evidence result={result}/>}
      {(envelope || observation?.hash || reference?.hash) && <p><a href={envelope
        ? reportPath('wallet', envelope)
        : reportPath('genlayer', (observation?.hash ?? reference?.hash)!)}>Open public report</a></p>}
    </div>
  </section>;
}

const historyKey = (item: Reference) => item.caller.toLowerCase() + '.' + item.id;

function App() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || 'dashboard');
  const [menu, setMenu] = useState(false);
  const [history, setHistory] = useState(readHistory);
  const historyRef = useRef(history);
  const [status, setStatus] = useState<Record<string, Observation>>({});
  const [review, setReview] = useState<Observation>();
  const [refresh, setRefresh] = useState(0);
  const [original, setOriginal] = useState('');
  const [revised, setRevised] = useState('');
  const [example, setExample] = useState(1);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyFilter, setHistoryFilter] = useState('all');
  const [active, setActive] = useState<Reference>();
  const [prepared, setPrepared] = useState<{ wallet: Awaited<ReturnType<typeof connectWallet>>; estimate: Awaited<ReturnType<typeof quote>>; id: string }>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [persistError, setPersistError] = useState('');

  useEffect(() => {
    const update = () => { setRoute(location.hash.slice(1) || 'dashboard'); setMenu(false); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  function track(reference: Reference) {
    const previous = historyRef.current.find(item => historyKey(item) === historyKey(reference));
    const entry = reference.recovered && previous ? {
      ...previous, hash: reference.hash ?? previous.hash, envelope: previous.envelope ?? reference.envelope,
    } : reference;
    const next = [entry, ...historyRef.current.filter(item => historyKey(item) !== historyKey(reference))];
    historyRef.current = next;
    if (!reference.recovered) setActive(reference);
    setHistory(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      return true;
    } catch {
      setPersistError('Browser storage is unavailable. Keep this tab open and copy the transaction ID.');
      return false;
    }
  }

  const tracked = route.startsWith('history/') ? history.find(item => historyKey(item) === route.split('/')[1] || item.id === route.split('/')[1]) : active;
  const isDashboard = route === 'dashboard' || !(Deployment && route === 'deploy') && !paths.some(([id]) => route === id || route.startsWith(id + '/'));
  const isList = route === 'history' || isDashboard;
  const reviewHash = route === 'demo' ? demoHash : undefined;
  useEffect(() => {
    const targets = isList ? history : tracked ? [tracked] : [];
    let stopped = false;
    let timer: number | undefined;
    let attempts = 0;
    const finished = new Set<string>();
    async function check() {
      const pending = targets.filter(item => !finished.has(historyKey(item)));
      const checkDemo = reviewHash && !finished.has(reviewHash);
      const apply = (key: string, value: Observation) => {
        if (stopped) return;
        if (value.terminal) finished.add(key);
        if (key === reviewHash) setReview(value);
        else setStatus(current => ({ ...current, [key]: value }));
      };
      const safeObserve = async (key: string, target: Reference | Hash) => {
        try { apply(key, await observe(target)); }
        catch { apply(key, { state: 'unavailable', phase: 'Status unavailable · retrying' }); }
      };
      for (let offset = 0; offset < pending.length && !stopped; offset += 4) {
        await Promise.all(pending.slice(offset, offset + 4).map(item => safeObserve(historyKey(item), item)));
      }
      if (checkDemo) await safeObserve(reviewHash, reviewHash);
      if (!stopped && ++attempts < 12 && (targets.some(item => !finished.has(historyKey(item))) || (reviewHash && !finished.has(reviewHash)))) {
        timer = window.setTimeout(check, 10000);
      } else if (!stopped && attempts >= 12) {
        setStatus(current => {
          const next = { ...current };
          for (const item of targets) if (!finished.has(historyKey(item))) next[historyKey(item)] = { ...next[historyKey(item)], state: next[historyKey(item)]?.state ?? 'unavailable', phase: (next[historyKey(item)]?.phase ?? 'Status unavailable').replace(' · retrying', '') + ' · refresh to check again' };
          return next;
        });
        if (reviewHash && !finished.has(reviewHash)) setReview({ state: 'unavailable', phase: 'Status unavailable · refresh to check again', hash: reviewHash });
      }
    }
    if (targets.length || reviewHash) void check();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [isList, history, tracked, reviewHash, refresh]);

  const valid = !!original.trim() && !!revised.trim() && byteCount(original) <= MAX_BYTES && byteCount(revised) <= MAX_BYTES;
  function change(setter: (value: string) => void, value: string) { setter(value); setPrepared(undefined); }
  async function prepare() {
    if (walletPaused || !valid || busy) return;
    setBusy(true); setNotice('');
    try {
      const wallet = await connectWallet();
      const id = crypto.randomUUID().replaceAll('-', '');
      setPrepared({ wallet, id, estimate: await quote(original, revised, id, wallet.caller) });
    }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function send() {
    if (walletPaused || !prepared || !valid || busy) return;
    setBusy(true); setNotice('');
    let broadcast = false;
    try {
      await submit(prepared.wallet, prepared.id, original, revised, prepared.estimate.fees, reference => { broadcast = true; track(reference); });
    } catch (error) { setNotice(broadcast ? 'Your wallet sent a transaction. Follow its status below before submitting again.' : errorMessage(error)); }
    finally { setBusy(false); setPrepared(undefined); }
  }

  const pending = history.filter(item => { const value = status[historyKey(item)]; return value && ['submitted', 'pending', 'awaiting-readback'].includes(value.state); }).length;
  const findings = history.filter(item => status[historyKey(item)]?.result && status[historyKey(item)].result?.verdict !== 'compatible').length;
  const refreshNow = () => setRefresh(value => value + 1);
  const isDemo = route === 'demo';
  const sample = examples[example];

  const filteredHistory = history.filter(item => {
    const value = status[historyKey(item)];
    const text = [item.hash, item.envelope, item.caller, item.id, value?.phase, value?.result && verdicts[value.result.verdict]].join(' ').toLowerCase();
    return text.includes(historyQuery.trim().toLowerCase()) && (historyFilter === 'all' ||
      historyFilter === 'verified' && Boolean(value?.result) || historyFilter === 'unresolved' && !value?.terminal ||
      historyFilter === 'failed' && value?.terminal && !value.result);
  });

  function renderHistory() {
    return <section className="panel">
      <header className="panel-head"><div><h2>{isDashboard ? 'Recent assessments' : 'Assessment history'}</h2><p>Transactions tracked in this browser.</p></div>{history.length > 0 && <button className="button small" onClick={refreshNow}>Refresh status</button>}</header>
      {!isDashboard && <div className="history-tools"><label>Search history<input value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} placeholder="ID, caller, or verdict"/></label><label>Status<select value={historyFilter} onChange={event => setHistoryFilter(event.target.value)}><option value="all">All statuses</option><option value="verified">Verified</option><option value="unresolved">Unresolved</option><option value="failed">Failed or invalid</option></select></label><a className="button" href="#verify">Recover by transaction ID</a></div>}
      {history.length === 0 ? <div className="empty-state"><History size={24} /><h3>No assessments yet</h3><p>Submitted transactions appear here on the browser that tracked them. The demo’s simulated results do not appear in history.</p><a className="button" href="#demo">Try the reviewer demo</a></div> :
        !isDashboard && !filteredHistory.length ? <p className="empty">No records match these filters.</p> : <ul className="history-list">{(isDashboard ? history.slice(0, 5) : filteredHistory).map(item => <li key={historyKey(item)}><a href={`#history/${historyKey(item)}`}><div><strong>Assessment</strong><small>{new Date(item.at).toLocaleString()} · {(item.hash ?? item.envelope)?.slice(0, 12)}…</small></div><span>{status[historyKey(item)]?.result ? verdicts[status[historyKey(item)].result!.verdict] + ' · verified' : status[historyKey(item)]?.phase ?? 'Checking status'}</span></a></li>)}</ul>}
    </section>;
  }

  return <div className="shell">
    <aside className={menu ? 'sidebar opened' : 'sidebar'} aria-label="Main navigation">
      <a className="brand" href="#dashboard"><img src="/scopepulse.svg" width="42" height="42" alt="" /><span>ScopePulse<small>Requirement drift monitor</small></span></a>
      <nav>{paths.map(([id, label, Icon]) => <a key={id} href={`#${id}`} aria-current={(id === 'dashboard' ? isDashboard : route.split('/')[0] === id) ? 'page' : undefined}><Icon size={18}/>{label}</a>)}</nav>
      <div className="sidebar-foot"><Activity size={17}/><div>GenLayer Bradbury<small>Phase 2 testnet</small></div></div>
    </aside>
    <main>
      <div className="topbar"><button className="button icon-button" aria-expanded={menu} aria-label={menu ? 'Close navigation' : 'Open navigation'} onClick={() => setMenu(!menu)}>{menu ? <X/> : <Menu/>}</button><span>ScopePulse workspace</span><span className="network"><span /> Bradbury testnet</span></div>
      <div className="content">
      {Deployment && route === 'deploy' && <Suspense fallback={<p>Loading deployment tool…</p>}><Deployment/></Suspense>}
      {persistError && <p role="alert" className="notice">{persistError}</p>}
      {isDashboard && <>
        <div className="workspace-heading">
          <div className="page-title"><h1>Review workspace</h1><p>Compare requirements, trace the evidence, and verify Bradbury assessments.</p></div>
          <a className="button primary" href="#compare"><Plus size={17}/> Compare requirements</a>
        </div>
        <div className="workspace-grid">
          <section className="panel workspace-card workspace-feature"><GitCompareArrows size={24}/><h2>Requirement review</h2><p>Inspect changes in split or unified view and jump from evidence to source.</p><a href={history.length ? '#history/' + historyKey(history[0]) : '#demo'} className="button">{history.length ? 'Resume latest review' : 'Explore a reviewer scenario'}</a></section>
          <section className="panel workspace-card"><SearchCheck size={23}/><h2>Verify a report</h2><p>Resolve a GenLayer ID or wallet transaction hash using public Bradbury data.</p><a href="#verify" className="button">Look up an assessment</a></section>
          <section className="panel workspace-card"><Activity size={23}/><h2>Bradbury Phase 2</h2><p>{walletPaused ? 'Wallet writes are paused. Public verification is available.' : 'Wallet submission and public verification are available.'}</p><a href="#demo" className="button">View deployment evidence</a></section>
        </div>
        <div className="metrics">
          {[[GitCompareArrows, 'Tracked assessments', history.length], [Clock3, 'Awaiting verification', pending], [CircleCheck, 'Verified with findings', findings]].map(([MetricIcon, label, count]) => {
            const Icon = MetricIcon as typeof Clock3;
            return <div className="panel metric" key={String(label)}><Icon size={19}/><strong>{String(count)}</strong><span>{String(label)}</span></div>;
          })}
        </div>
        {renderHistory()}
      </>}
      {route === 'compare' && <>
        <div className="workspace-heading"><div className="page-title"><h1>New assessment</h1><p>Compare two versions of the same requirement. Editing and comparison stay in this browser.</p></div>
          <button className="button" disabled={busy} onClick={() => { const example = examples[1]; change(setOriginal, example.original); change(setRevised, example.revised); }}>Load audit-log example</button></div>
        <div className="two">
          {([[original, setOriginal, 'Original requirements'], [revised, setRevised, 'Revised requirements']] as const).map(([value, setter, label]) =>
            <label className="panel editor" key={label}><span>{label}</span><textarea value={value} disabled={busy} onChange={event => change(setter, event.target.value)} placeholder="Enter requirements, one per line…" maxLength={MAX_BYTES * 2}/><small className={byteCount(value) > MAX_BYTES ? 'minus' : ''}>{byteCount(value)} / {MAX_BYTES} bytes</small></label>
          )}
        </div>
        <Comparison original={original} revised={revised}/>
        <div className="panel submit-panel"><div><h2>Submit to Bradbury</h2><p>Fee simulation may send requirements to the RPC. Signed submissions make both versions public on Bradbury. Use non-confidential text.</p>
          {walletPaused ? <p className="notice">Wallet submissions are paused while the site warning is under review. <a href="#demo">Open the wallet-free demo</a>.</p> : !ready && <p className="notice">Bradbury submission is unavailable until the contract address is configured.</p>}
          {prepared && <p>Estimated protocol deposit <strong>{prepared.estimate.label}</strong>. Wallet gas is extra.</p>}
          {notice && <p role="status" className="notice">{notice}</p>}</div>
          {!walletPaused && (prepared ? <div className="actions"><button className="button" disabled={busy} onClick={() => setPrepared(undefined)}>Cancel</button><button className="button primary" disabled={busy} onClick={send}>{busy ? 'Submitting…' : 'Confirm in wallet'}</button></div> :
            <button className="button primary" disabled={!ready || !valid || busy || Boolean(active && !status[historyKey(active)]?.terminal)} onClick={prepare}><Wallet size={17}/>{busy ? 'Preparing…' : 'Connect wallet & quote'}</button>)}
        </div>
        <Result observation={active && status[historyKey(active)]} reference={active} onRefresh={refreshNow}/>
      </>}
      {(route === 'verify' || route.startsWith('verify/')) && <VerifyReport key={route} path={route.slice(7)} onSave={track}/>}
      {route === 'history' && <><div className="page-title"><h1>History</h1><p>Find submissions and follow their consensus status.</p></div>{renderHistory()}</>}
      {route.startsWith('history/') && <><div className="page-title"><a href="#history">Back to history</a><h1>Assessment details</h1></div>
        {tracked ? <><Result observation={status[historyKey(tracked)]} reference={tracked} onRefresh={refreshNow}/>{status[historyKey(tracked)]?.result && <Comparison original={status[historyKey(tracked)].original!} revised={status[historyKey(tracked)].revised!} assessment={status[historyKey(tracked)].result} provenance="Verified GenLayer verdict"/>}</> : <p>This assessment is unavailable in this browser.</p>}</>}
      {route === 'guide' && <><div className="page-title"><h1>Usage guide</h1><p>From a first comparison to a verified testnet verdict.</p></div><ol className="panel guide">
        <li><h2>Compare two versions</h2><p>Open New assessment and paste your original and revised requirements. Put each requirement on its own line. Review the added and removed lines.</p></li>
        <li><h2>Review a simulated outcome</h2><p>Select a scenario in the reviewer demo to see its expected verdict and sample evidence. The demo works without a wallet.</p><a href="#demo">Open reviewer demo</a></li>
        <li><h2>Verify the deployment</h2><p>In the demo, check the Bradbury deployment status and open the explorer link for the wallet transaction. Contract deployment and an assessment are separate transactions.</p></li>
        <li><h2>Open a public report</h2><p>Look up a GenLayer ID or wallet transaction hash, then copy the report link. Verified reports can be printed or saved to this browser’s history.</p><a href="#verify">Verify assessment</a></li>
        <li><h2>Read assessment history</h2><p>History tracks submissions from this browser. A verified verdict requires GenLayer finalization, successful execution, and a matching result from the contract. Explorer success confirms the wallet transaction reached the chain.</p></li>
        {walletPaused && <li><h2>Wallet review in progress</h2><p>Live submissions are paused while the site warning is under review. You can still compare requirements and verify the contract deployment.</p></li>}
      </ol></>}
      {isDemo && <>
        <div className="page-title"><h1>Reviewer demo</h1><p>Explore requirement changes in read-only mode. No wallet needed.</p></div>
        <section className="panel demo-head"><label>Example scenario <select value={example} onChange={event => setExample(Number(event.target.value))}>{examples.map((item, index) => <option value={index} key={item.name}>{item.name}</option>)}</select></label><span className="tag needs_review">Simulation</span></section>
        <div className="demo-disclosure"><strong>Authored simulation</strong><p>Expected outcomes illustrate the review rubric. These examples have no finalized assessment transaction.</p></div>
        <Comparison original={sample.original} revised={sample.revised} assessment={sample.expected} provenance="Simulated expected assessment"/>
        <DeploymentEvidence/>
        {reviewHash ? <><div className="page-title secondary"><h2>On-chain assessment evidence</h2><p>Live verdict and evidence from a separate Bradbury assessment transaction.</p></div><Result observation={review ?? { state: 'checking', phase: 'Checking Bradbury', hash: reviewHash }} onRefresh={refreshNow}/>{review?.result && <Comparison original={review.original!} revised={review.revised!}/>}</> :
          <section className="panel read-only"><h2>On-chain assessment evidence</h2><p>No finalized assessment is available for this demo yet.</p><a href="#verify">Look up a Bradbury assessment</a></section>}
      </>}
      <footer>ScopePulse <span>Local comparison · GenLayer consensus</span></footer>
      </div>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
