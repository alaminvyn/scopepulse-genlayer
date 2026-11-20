import { useEffect, useState } from 'react';
import { keccak256, stringToHex, type Hash } from 'viem';
import { connectWallet, deployContract, errorMessage, explorer, hashPattern, inspectDeployment, quoteDeployment, resolveEnvelope } from './chain';
import code from '../contracts/scopepulse.py?raw';

const deploymentKey = 'scopepulse.deploy.' + keccak256(stringToHex(code));

function storedHash(key: string): Hash | undefined {
  const value = localStorage.getItem(key);
  return value && hashPattern.test(value) ? value as Hash : undefined;
}

export default function Deployment() {
  const [envelope, setEnvelope] = useState(() => storedHash(deploymentKey + '.envelope'));
  const [hash, setHash] = useState(() => storedHash(deploymentKey + '.hash'));
  const [status, setStatus] = useState<Awaited<ReturnType<typeof inspectDeployment>>>();
  const [prepared, setPrepared] = useState<{ wallet: Awaited<ReturnType<typeof connectWallet>>; estimate: Awaited<ReturnType<typeof quoteDeployment>> }>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!hash && !envelope) return;
    let stopped = false;
    let timer: number;
    let attempts = 0;
    const check = async () => {
      try {
        const id = hash ?? await resolveEnvelope(envelope!);
        if (stopped) return;
        if (!hash) {
          setHash(id);
          localStorage.setItem(deploymentKey + '.hash', id);
          return;
        }
        const result = await inspectDeployment(id);
        if (stopped) return;
        setStatus(result);
        if (result.address) return;
      } catch (error) {
        if (stopped) return;
        const message = errorMessage(error);
        setNotice(message);
        if (/reverted|canceled|without successful execution|does not match/.test(message)) return;
      }
      if (++attempts < 40) timer = window.setTimeout(check, 15000);
    };
    void check();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [hash, envelope]);

  async function prepare() {
    setBusy(true); setNotice('');
    try { setPrepared({ wallet: await connectWallet(), estimate: await quoteDeployment(code) }); }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function deploy() {
    if (!prepared) return;
    setBusy(true); setNotice('');
    try {
      const id = await deployContract(prepared.wallet, code, prepared.estimate.fees, value => {
        setEnvelope(value);
        localStorage.setItem(deploymentKey + '.envelope', value);
      });
      setHash(id);
      localStorage.setItem(deploymentKey + '.hash', id);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setPrepared(undefined); setBusy(false); }
  }

  return <>
    <div className="page-title"><h1>Deploy ScopePulse</h1><p>Deploy the bundled Intelligent Contract on Bradbury Phase 2 with your browser wallet.</p></div>
    <section className="panel submit-panel"><div><h2>Bradbury deployment</h2>
      {prepared && <p>Estimated protocol deposit <strong>{prepared.estimate.label}</strong>. Wallet gas is extra.</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {envelope && <p><a href={explorer(envelope)} target="_blank" rel="noreferrer">View wallet transaction</a></p>}
      {hash && <p className="transaction-id">GenLayer ID <code>{hash}</code></p>}
      {status && <p>{status.phase}</p>}
      {status?.address && <p className="transaction-id">Contract address <code>{status.address}</code></p>}
    </div>
      {prepared ? <button className="button primary" disabled={busy} onClick={deploy}>Sign deployment</button> :
        <button className="button primary" disabled={busy || !!envelope || !!hash} onClick={prepare}>{busy ? 'Preparing…' : 'Connect wallet & quote'}</button>}
    </section>
  </>;
}
