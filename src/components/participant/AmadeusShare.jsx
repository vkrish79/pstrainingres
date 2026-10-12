import { useEffect, useState } from 'react';
import { useAmadeusShare } from '../../contexts/AmadeusShareContext.jsx';
import '../../styles/amadeus-watch.css';

// Watch Amadeus, in the participant's workbook. See AmadeusShareContext.

// In the action bar: a button while not sharing, a status pill while sharing.
// Absent entirely when sharing isn't available here (SQL not applied, or a
// browser without screen sharing).
export function AmadeusShareButton() {
  const amx = useAmadeusShare();
  if (!amx?.available) return null;
  const { status, start, pause, resume, stop } = amx;

  if (status === 'sharing' || status === 'paused') {
    const paused = status === 'paused';
    return (
      <span className={`amx-pill${paused ? ' is-paused' : ''}`} role="status">
        <span className="amx-dot" aria-hidden="true" />
        {paused ? 'Amadeus paused' : 'Sharing Amadeus'}
        <button type="button" className="amx-pill-btn" onClick={paused ? resume : pause}
          data-tip={paused ? 'Let your trainer see it again' : 'Hide it from your trainer for a moment'}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="amx-pill-btn" onClick={stop} data-tip="Stop sharing">Stop</button>
      </span>
    );
  }
  return (
    <button type="button" className="amx-share" onClick={start} disabled={status === 'starting'}
      data-tip="Let your trainer see your ARD Web tab while you work">
      🖥 {status === 'starting' ? 'Pick the ARD Web tab…' : 'Share my Amadeus'}
    </button>
  );
}

const NOTED_KEY = 'amx-noted';

// Under the action bar: the trainer asking, the whole-screen warning, a
// one-time note on what sharing means, and a readout for testing.
export function AmadeusShareNotices() {
  const amx = useAmadeusShare();
  const [noted, setNoted] = useState(() => {
    try { return localStorage.getItem(NOTED_KEY) === '1'; } catch { return true; }
  });
  const [showDiag] = useState(() => {
    try { return /[?&]amxdiag\b/.test(window.location.search) || localStorage.getItem('amx-diag') === '1'; } catch { return false; }
  });
  useEffect(() => {
    if (showDiag) { try { localStorage.setItem('amx-diag', '1'); } catch { /* fine */ } }
  }, [showDiag]);

  if (!amx) return null;
  const { available, status, surface, asked, error, diag, start, stop, dismissAsk, clearError } = amx;
  const sharing = status === 'sharing' || status === 'paused';

  function markNoted() {
    setNoted(true);
    try { localStorage.setItem(NOTED_KEY, '1'); } catch { /* shows again next time */ }
  }

  return (
    <>
      {available && asked && !sharing && (
        <div className="amx-ask no-print" role="status">
          <div>
            <strong>Your trainer asked you to share Amadeus.</strong>
            <span> Only your trainer sees it.</span>
          </div>
          <div className="amx-ask-actions">
            <button type="button" className="amx-share" onClick={start}>🖥 Share my Amadeus</button>
            <button type="button" className="amx-ghost" onClick={dismissAsk}>Not now</button>
          </div>
        </div>
      )}
      {sharing && surface === 'monitor' && (
        <div className="amx-warn no-print" role="alert">
          <span>⚠ You're sharing your <strong>whole screen</strong>, so your trainer can see everything on it, not only Amadeus.</span>
          <button type="button" className="amx-ghost" onClick={() => { stop(); start(); }}>Share just the ARD Web tab</button>
        </div>
      )}
      {sharing && !noted && (
        <div className="amx-note no-print" role="status">
          <span>Your trainer can see this tab while you share it. Pause or stop any time.</span>
          <button type="button" className="amx-ghost" onClick={markNoted}>Got it</button>
        </div>
      )}
      {error && (
        <p className="error no-print">{error} <button type="button" className="amx-ghost" onClick={clearError}>Dismiss</button></p>
      )}
      {showDiag && (
        <div className="amx-diag no-print" aria-hidden="true">
          <b>amx</b> channel {available ? 'ok' : 'no'} · {status} · surface {surface || '–'}<br />
          label “{diag.label || '–'}”<br />
          sent {diag.sent} · failed {diag.failed} · last {diag.lastKind || '–'} {diag.lastBytes ? `${Math.round(diag.lastBytes / 1024)} KB` : ''} ({diag.lastAck || '–'})<br />
          longest tick gap {diag.tickGapMax ? `${(diag.tickGapMax / 1000).toFixed(1)}s` : '–'} · no picture {diag.noPicture || 0}
        </div>
      )}
    </>
  );
}
