// Course feedback: the end-of-day pulse (A4) across classes.
//
// One row per class that has any pulse answers, open or closed, for the date
// range above. Totals only — the answers are anonymous to the trainer, and
// close keeps them with no person attached. Read through pulse_overview, which
// returns only classes the caller could host.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';

export default function AnalyticsFeedback({ sinceDays }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const from = sinceDays ? new Date(Date.now() - sinceDays * 86400000).toISOString() : null;
      const { data, error: e } = await supabase.rpc('pulse_overview', { p_from: from, p_to: null });
      if (cancelled) return;
      if (e) {
        const missing = ['PGRST202', '42883'].includes(e.code) || /could not find the function/i.test(e.message || '');
        setError(missing ? 'missing' : e.message); setRows([]); return;
      }
      setError('');
      setRows(data || []);
    })();
    return () => { cancelled = true; };
  }, [sinceDays]);

  if (rows === null) return <p className="an-muted-sm">Loading course feedback…</p>;
  if (error === 'missing') {
    return <p className="an-muted-sm an-feedback-empty">Course feedback isn't switched on yet. It needs a one-time database step (the day-pulse SQL).</p>;
  }
  if (error) return <p className="error">Couldn't load course feedback: {error}</p>;
  if (rows.length === 0) {
    return (
      <p className="an-muted-sm an-feedback-empty">
        No end-of-day answers in this range yet. In a session's Room, <strong>Ask how today went</strong> sends everyone
        in the workbook three quick questions.
      </p>
    );
  }

  return (
    <div className="an-feedback">
      <table className="an-feedback-table">
        <thead>
          <tr><th scope="col">Class</th><th scope="col">Days asked</th><th scope="col">Answers</th><th scope="col">How useful (1–5)</th><th scope="col">Pace</th></tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const avg = Number(r.avg_useful) || 0;
            const tone = avg >= 4 ? 'ok' : avg >= 3 ? 'mid' : 'poor';
            return (
              <tr key={r.session_id}>
                <td>
                  <span className="an-feedback-name">{r.session_name}</span>
                  <span className="an-muted-sm">{r.starts_at ? new Date(r.starts_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span>
                </td>
                <td className="num">{r.days}</td>
                <td className="num">{r.answers}</td>
                <td>
                  <span className="an-feedback-score">
                    <span className={`pulse-bar ${tone}`}><i style={{ width: `${(avg / 5) * 100}%` }} /></span>
                    <span className="num">{avg.toFixed(1)}</span>
                  </span>
                </td>
                <td className="an-muted-sm">
                  {r.fast > 0 || r.slow > 0
                    ? [r.fast > 0 && `${r.fast} too fast`, r.slow > 0 && `${r.slow} too slow`].filter(Boolean).join(' · ')
                    : 'About right'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
