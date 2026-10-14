import { useState } from 'react';
import { PACES } from '../../hooks/useDayPulse.js';

// "Day 3 · before you go" (A4). Shown in the workbook once the trainer asks;
// never on the assessment. "Not now" folds it to one line rather than losing
// it, and it never blocks the workbook.
//
//   latest — { day_no, answered } from useDayPulse({ mine: true })
//   onAnswer(dayNo, useful, pace, word) → Promise<{ error }>
export default function DayPulseCard({ latest, onAnswer }) {
  const [useful, setUseful] = useState(null);
  const [pace, setPace] = useState(null);
  const [word, setWord] = useState('');
  const [folded, setFolded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sentDay, setSentDay] = useState(null);

  if (!latest) return null;
  if (latest.answered || sentDay === latest.day_no) {
    return sentDay === latest.day_no
      ? <div className="pulse-card is-sent no-print" role="status">✓ Thanks — your trainer sees the class's answers together, not yours on its own.</div>
      : null;
  }

  if (folded) {
    return (
      <div className="pulse-card is-folded no-print">
        <span>Your trainer asked how <strong>Day {latest.day_no}</strong> went.</span>
        <button type="button" className="pulse-open" onClick={() => setFolded(false)}>Answer</button>
      </div>
    );
  }

  async function send() {
    if (!useful || !pace) return;
    setBusy(true);
    setErr('');
    const { error } = await onAnswer(latest.day_no, useful, pace, word.trim());
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setSentDay(latest.day_no);
  }

  return (
    <section className="pulse-card no-print" aria-label={`Day ${latest.day_no}, before you go`}>
      <div className="pulse-head">
        <strong>Day {latest.day_no} · before you go</strong>
        <span className="pulse-private">Your trainer sees totals, not who said what</span>
      </div>
      <div className="pulse-q">
        <span className="pulse-label" id="pulse-useful">How useful was today?</span>
        <div className="pulse-scale" role="group" aria-labelledby="pulse-useful">
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} type="button" className={`pulse-chip${useful === n ? ' is-on' : ''}`} aria-pressed={useful === n} onClick={() => setUseful(n)}>{n}</button>
          ))}
          <span className="pulse-ends">1 not at all · 5 very</span>
        </div>
      </div>
      <div className="pulse-q">
        <span className="pulse-label" id="pulse-pace">The pace was</span>
        <div className="pulse-scale" role="group" aria-labelledby="pulse-pace">
          {PACES.map(p => (
            <button key={p.id} type="button" className={`pulse-chip${pace === p.id ? ' is-on' : ''}`} aria-pressed={pace === p.id} onClick={() => setPace(p.id)}>{p.label}</button>
          ))}
        </div>
      </div>
      <div className="pulse-q">
        <label className="pulse-label" htmlFor="pulse-word">One word for today <span className="pulse-optional">(optional)</span></label>
        <input id="pulse-word" type="text" className="form-input pulse-word" maxLength={30} value={word} onChange={e => setWord(e.target.value)} />
      </div>
      {err && <p className="error">{err}</p>}
      <div className="pulse-actions">
        <button type="button" className="pulse-later" onClick={() => setFolded(true)}>Not now</button>
        <button type="button" className="pulse-send" disabled={!useful || !pace || busy} onClick={send}>Send</button>
      </div>
    </section>
  );
}
