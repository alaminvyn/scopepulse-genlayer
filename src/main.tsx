import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BookOpen, CircleCheck, Clock3, FlaskConical, GitCompareArrows, History, LayoutGrid, Menu, Plus, ShieldAlert, Wallet, X } from 'lucide-react';
import { type Hash } from 'viem';
import { byteCount, compare, MAX_BYTES } from './diff';
import { deployment, examples } from './examples';
import { connectWallet, demoHash, errorMessage, explorer, hashPattern, observe, quote, ready, submit, contract, inspectDeployment, resolveEnvelope, type Assessment, type Observation, type Reference, type Verdict } from './chain';
import './style.css';

const Deployment = import.meta.env.DEV ? lazy(() => import('./deploy')) : null;

const paths = [
  ['dashboard', 'Overview', LayoutGrid], ['compare', 'New assessment', GitCompareArrows],
  ['history', 'History', History], ['guide', 'Usage guide', BookOpen], ['demo', 'Reviewer demo', FlaskConical],
] as const;
const verdicts: Record<Verdict, string> = { compatible: 'Compatible', potential_conflict: 'Potential conflict', needs_review: 'Needs review' };
const walletPaused = import.meta.env.VITE_ENABLE_WALLET_WRITES !== 'true';
const storageKey = 'scopepulse.references.v1';

function readHistory(): Reference[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter(item => item && typeof item.id === 'string' && typeof item.at === 'number' &&
      /^0x[\da-f]{40}$/i.test(item.caller) && /^0x[\da-f]{40}$/i.test(item.contract) &&
      (hashPattern.test(item.hash ?? '') || hashPattern.test(item.envelope ?? '')));
  } catch {
    return [];
  }
}

function Comparison({ original, revised }: { original: string; revised: string }) {
  const limited = byteCount(original) > MAX_BYTES || byteCount(revised) > MAX_BYTES;
  const lines = useMemo(() => limited ? [] : compare(original, revised), [limited, original, revised]);
  const additions = lines.filter(line => line.kind === 'added').length;
  const removals = lines.filter(line => line.kind === 'removed').length;
  return <section className="panel diff-panel">
    <header className="panel-head"><div><h2>Text comparison</h2><p>Line-by-line changes between the two versions.</p></div>
      {!limited && <div className="diff-count"><span className="plus">+{additions}</span><span className="minus">−{removals}</span></div>}
    </header>
    {limited ? <p className="empty">Trim each version to 2,048 bytes to compare.</p> : lines.length === 0 ? <p className="empty">Enter requirements to see changes here.</p> :
      <div className="diff-lines" aria-label="Requirement changes">{lines.map((line, i) =>
        <div className={line.kind} key={i}><span aria-label={line.kind}>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : '·'}</span><code>{line.text || ' '}</code></div>
      )}</div>}
  </section>;
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
          {reference && <li><span>Submitted</span><time>{new Date(reference.at).toLocaleString()}</time></li>}
          <li><span>{observation?.phase ?? 'Checking Bradbury'}</span>{!observation?.terminal && <button className="button small" onClick={onRefresh}>Refresh</button>}</li>
        </ol>
        {envelope && <a href={explorer(envelope)} target="_blank" rel="noreferrer">View wallet transaction in explorer</a>}
        {(observation?.hash ?? reference?.hash) && <p className="transaction-id">GenLayer ID <code>{observation?.hash ?? reference?.hash}</code></p>}
      </>}
      {result && <Evidence result={result}/>}
    </div>
  </section>;
}

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
    const next = [reference, ...historyRef.current.filter(item => item.id !== reference.id)];
    historyRef.current = next;
    setActive(reference);
    setHistory(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { setPersistError('Browser storage is unavailable. Keep this tab open and copy the transaction ID.'); }
  }

  const tracked = route.startsWith('history/') ? history.find(item => item.id === route.split('/')[1]) : active;
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
      const pending = targets.filter(item => !finished.has(item.id));
      const checkDemo = reviewHash && !finished.has(reviewHash);
      const apply = (key: string, value: Observation) => {
        if (stopped) return;
        if (value.terminal) finished.add(key);
        if (key === reviewHash) setReview(value);
        else setStatus(current => ({ ...current, [key]: value }));
      };
      const safeObserve = async (key: string, target: Reference | Hash) => {
        try { apply(key, await observe(target)); }
        catch { apply(key, { phase: 'Status unavailable · retrying' }); }
      };
      for (const item of pending) {
        if (stopped) return;
        await safeObserve(item.id, item);
      }
      if (checkDemo) await safeObserve(reviewHash, reviewHash);
      if (!stopped && ++attempts < 12 && (targets.some(item => !finished.has(item.id)) || (reviewHash && !finished.has(reviewHash)))) {
        timer = window.setTimeout(check, 10000);
      } else if (!stopped && attempts >= 12) {
        setStatus(current => {
          const next = { ...current };
          for (const item of targets) if (!finished.has(item.id)) next[item.id] = { ...next[item.id], phase: 'Awaiting verification · refresh to check again' };
          return next;
        });
        if (reviewHash && !finished.has(reviewHash)) setReview({ phase: 'Awaiting verification · refresh to check again', hash: reviewHash });
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

  const pending = history.filter(item => !status[item.id]?.terminal).length;
  const findings = history.filter(item => status[item.id]?.result && status[item.id].result?.verdict !== 'compatible').length;
  const refreshNow = () => setRefresh(value => value + 1);
  const isDemo = route === 'demo';
  const sample = examples[example];

  function HistoryList() {
    return <section className="panel">
      <header className="panel-head"><div><h2>{isDashboard ? 'Recent assessments' : 'Assessment history'}</h2><p>Transactions tracked in this browser.</p></div>{history.length > 0 && <button className="button small" onClick={refreshNow}>Refresh status</button>}</header>
      {history.length === 0 ? <div className="empty-state"><History size={24} /><h3>No assessments yet</h3><p>Submitted transactions appear here on the browser that tracked them. The demo’s simulated results do not appear in history.</p><a className="button" href="#demo">Try the reviewer demo</a></div> :
        <ul className="history-list">{(isDashboard ? history.slice(0, 5) : history).map(item => <li key={item.id}><a href={`#history/${item.id}`}><div><strong>Assessment</strong><small>{new Date(item.at).toLocaleString()} · {(item.hash ?? item.envelope)?.slice(0, 12)}…</small></div><span>{status[item.id]?.result ? verdicts[status[item.id].result!.verdict] + ' · verified' : status[item.id]?.phase ?? 'Checking status'}</span></a></li>)}</ul>}
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
        <section className="hero">
          <svg className="signature" aria-hidden="true" viewBox="0 0 430 180" fill="none"><defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" stroke="#96c9b4" strokeOpacity=".19"/></pattern></defs><path fill="url(#grid)" d="M0 0h430v180H0z"/><path d="M0 111h80l34-31 37 22 34-58 37 93 38-49 30 14 36-62 39 62h65" stroke="#a9f4d0" strokeWidth="2.5"/><path d="M0 111h80l34-31 37 22 34-58 37 93 38-49 30 14 36-62 39 62h65v78H0Z" fill="#a9f4d0" fillOpacity=".055"/><circle cx="326" cy="40" r="5" fill="#a9f4d0"/></svg>
          <div><div className="eyebrow"><Activity size={16}/> REQUIREMENT DRIFT MONITOR</div><h1>See what changed.<br /> <em>Review what it means.</em></h1><p>Compare requirement versions and use GenLayer to check whether the changes introduce a conflict.</p><div className="actions"><a className="button primary" href="#compare"><Plus size={17}/> New assessment</a><a className="button" href="#demo">Reviewer demo</a></div></div>
        </section>
        <div className="metrics">
          {[[GitCompareArrows, 'Tracked assessments', history.length], [Clock3, 'Awaiting verification', pending], [CircleCheck, 'Verified with findings', findings]].map(([MetricIcon, label, count]) => {
            const Icon = MetricIcon as typeof Clock3;
            return <div className="panel metric" key={String(label)}><Icon size={19}/><strong>{String(count)}</strong><span>{String(label)}</span></div>;
          })}
        </div>
        <HistoryList />
      </>}
      {route === 'compare' && <>
        <div className="page-title"><h1>New assessment</h1><p>Compare two versions of the same requirement before submitting them to Bradbury.</p></div>
        <div className="two">
          {([[original, setOriginal, 'Original requirements'], [revised, setRevised, 'Revised requirements']] as const).map(([value, setter, label]) =>
            <label className="panel editor" key={label}><span>{label}</span><textarea value={value} disabled={busy} onChange={event => change(setter, event.target.value)} placeholder="Enter requirements, one per line…" maxLength={MAX_BYTES * 2}/><small className={byteCount(value) > MAX_BYTES ? 'minus' : ''}>{byteCount(value)} / {MAX_BYTES} bytes</small></label>
          )}
        </div>
        <Comparison original={original} revised={revised}/>
        <div className="panel submit-panel"><div><h2>Submit to Bradbury</h2><p>Both versions become public on the testnet. Use non-confidential text.</p>
          {walletPaused ? <p className="notice">Wallet submissions are paused while the site warning is under review. <a href="#demo">Open the wallet-free demo</a>.</p> : !ready && <p className="notice">Bradbury submission is unavailable until the contract address is configured.</p>}
          {prepared && <p>Estimated protocol deposit <strong>{prepared.estimate.label}</strong>. Wallet gas is extra.</p>}
          {notice && <p role="status" className="notice">{notice}</p>}</div>
          {!walletPaused && (prepared ? <div className="actions"><button className="button" disabled={busy} onClick={() => setPrepared(undefined)}>Cancel</button><button className="button primary" disabled={busy} onClick={send}>{busy ? 'Submitting…' : 'Confirm in wallet'}</button></div> :
            <button className="button primary" disabled={!ready || !valid || busy || Boolean(active && !status[active.id]?.terminal)} onClick={prepare}><Wallet size={17}/>{busy ? 'Preparing…' : 'Connect wallet & quote'}</button>)}
        </div>
        <Result observation={active && status[active.id]} reference={active} onRefresh={refreshNow}/>
      </>}
      {route === 'history' && <><div className="page-title"><h1>History</h1><p>Find submissions and follow their consensus status.</p></div><HistoryList/></>}
      {route.startsWith('history/') && <><div className="page-title"><a href="#history">Back to history</a><h1>Assessment details</h1></div>
        {tracked ? <><Result observation={status[tracked.id]} reference={tracked} onRefresh={refreshNow}/>{status[tracked.id]?.result && <Comparison original={status[tracked.id].original!} revised={status[tracked.id].revised!}/>}</> : <p>This assessment is unavailable in this browser.</p>}</>}
      {route === 'guide' && <><div className="page-title"><h1>Usage guide</h1><p>From a first comparison to a verified testnet verdict.</p></div><ol className="panel guide">
        <li><h2>Compare two versions</h2><p>Open New assessment and paste your original and revised requirements. Put each requirement on its own line. Review the added and removed lines.</p></li>
        <li><h2>Review a simulated outcome</h2><p>Select a scenario in the reviewer demo to see its expected verdict and sample evidence. The demo works without a wallet.</p><a href="#demo">Open reviewer demo</a></li>
        <li><h2>Verify the deployment</h2><p>In the demo, check the Bradbury deployment status and open the explorer link for the wallet transaction. Contract deployment and an assessment are separate transactions.</p></li>
        <li><h2>Read assessment history</h2><p>History tracks submissions from this browser. A verified verdict requires GenLayer finalization, successful execution, and a matching result from the contract. Explorer success confirms the wallet transaction reached the chain.</p></li>
        {walletPaused && <li><h2>Wallet review in progress</h2><p>Live submissions are paused while the site warning is under review. You can still compare requirements and verify the contract deployment.</p></li>}
      </ol></>}
      {isDemo && <>
        <div className="page-title"><h1>Reviewer demo</h1><p>Explore requirement changes in read-only mode. No wallet needed.</p></div>
        <section className="panel demo-head"><label>Example scenario <select value={example} onChange={event => setExample(Number(event.target.value))}>{examples.map((item, index) => <option value={index} key={item.name}>{item.name}</option>)}</select></label><span className="tag needs_review">Simulation</span></section>
        <div className="two">{([['Original', sample.original], ['Revised', sample.revised]] as const).map(([label, text]) => <article className="panel read-only" key={label}><h2>{label} requirements</h2><pre>{text}</pre></article>)}</div>
        <Comparison original={sample.original} revised={sample.revised}/>
        <section className="panel">
          <header className="panel-head"><div><h2>Expected assessment</h2><p>Simulated result prepared for this example. No assessment transaction was submitted.</p></div></header>
          <div className="result-body"><Evidence result={sample.expected}/></div>
        </section>
        <DeploymentEvidence/>
        {reviewHash ? <><div className="page-title secondary"><h2>On-chain assessment evidence</h2><p>Live verdict and evidence from a separate Bradbury assessment transaction.</p></div><Result observation={review ?? { phase: 'Checking Bradbury', hash: reviewHash }} onRefresh={refreshNow}/>{review?.result && <Comparison original={review.original!} revised={review.revised!}/>}</> :
          <section className="panel read-only"><h2>On-chain assessment evidence</h2><p>No finalized assessment is available for this demo yet.</p></section>}
      </>}
      <footer>ScopePulse <span>Local comparison · GenLayer consensus</span></footer>
      </div>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
