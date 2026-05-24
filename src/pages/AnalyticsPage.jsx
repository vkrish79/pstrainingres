import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { isSuperTrainerOrAbove } from '../lib/roles.js';
import { useSessionAnalytics } from '../hooks/useSessionAnalytics.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';

// Weighted completion across a set of analytics rows: total answered / total
// possible. Beats averaging per-session percentages (a 2-person session
// shouldn't weigh the same as a 40-person one).
function wpct(rows) {
  const total = rows.reduce((s, r) => s + (r.total_slots || 0), 0);
  const answered = rows.reduce((s, r) => s + (r.answered_slots || 0), 0);
  return total ? Math.round((answered / total) * 100) : 0;
}
function sumBy(rows, f) { return rows.reduce((s, r) => s + (f(r) || 0), 0); }
function group(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function CompletionBar({ pct }) {
  return (
    <div className="cet-bar-row">
      <div className="cet-bar"><div className="cet-bar-fill" style={{ width: `${pct}%` }} /></div>
      <span className="cet-bar-label">{pct}%</span>
    </div>
  );
}

export default function AnalyticsPage() {
  const { profile } = useAuth();
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  const { loading, error, sessions, sections } = useSessionAnalytics();

  const wbTitle = useMemo(() => {
    const m = new Map();
    for (const r of sessions) {
      const wb = r.sessions?.workbooks;
      if (wb?.id) m.set(wb.id, wb.title);
    }
    return m;
  }, [sessions]);

  const summary = useMemo(() => ({
    sessions: sessions.length,
    participants: sumBy(sessions, r => r.participant_count),
    pct: wpct(sessions),
    flagged: sumBy(sessions, r => r.flagged_count),
  }), [sessions]);

  const byWorkbook = useMemo(() => (
    [...group(sessions, r => r.workbook_id).entries()].map(([id, rows]) => ({
      id,
      title: rows[0].sessions?.workbooks?.title || '(unknown workbook)',
      sessions: rows.length,
      pct: wpct(rows),
      flagged: sumBy(rows, r => r.flagged_count),
    })).sort((a, b) => b.sessions - a.sessions)
  ), [sessions]);

  const byTrainer = useMemo(() => (
    [...group(sessions, r => r.trainer_id).entries()].map(([id, rows]) => ({
      id,
      name: rows[0].sessions?.trainer?.full_name || '(unknown)',
      sessions: rows.length,
      pct: wpct(rows),
    })).sort((a, b) => b.sessions - a.sessions)
  ), [sessions]);

  const byVendor = useMemo(() => (
    [...group(sessions, r => r.vendor_id ?? '__none__').entries()].map(([id, rows]) => ({
      id,
      name: id === '__none__' ? 'Super-delivered' : (rows[0].sessions?.vendors?.name || '(unknown vendor)'),
      sessions: rows.length,
      pct: wpct(rows),
    })).sort((a, b) => b.sessions - a.sessions)
  ), [sessions]);

  const overTime = useMemo(() => (
    [...group(sessions.filter(r => r.closed_at), r => String(r.closed_at).slice(0, 7)).entries()]
      .map(([month, rows]) => ({ month, sessions: rows.length, pct: wpct(rows) }))
      .sort((a, b) => a.month.localeCompare(b.month))
  ), [sessions]);

  const hardest = useMemo(() => {
    const m = new Map();
    for (const r of sections) {
      if (!(r.total_slots > 0)) continue;
      const k = `${r.workbook_id}::${r.section_id}`;
      if (!m.has(k)) m.set(k, { workbook_id: r.workbook_id, section_id: r.section_id, title: r.title, rows: [] });
      m.get(k).rows.push(r);
    }
    return [...m.values()]
      .map(g => ({
        key: `${g.workbook_id}::${g.section_id}`,
        title: g.title || '(untitled)',
        workbook: wbTitle.get(g.workbook_id) || '',
        sessions: g.rows.length,
        pct: wpct(g.rows),
      }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 12);
  }, [sections, wbTitle]);

  const monthLabel = (m) => {
    const [y, mo] = m.split('-');
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>📊 Analytics</h1>
            <p className="muted">
              {loading ? 'Loading…' : `Across ${summary.sessions} closed session${summary.sessions === 1 ? '' : 's'}`}
            </p>
          </div>
        </section>

        {error && <p className="error">{error}</p>}
        {!loading && !error && summary.sessions === 0 && (
          <p className="muted">
            No closed-session analytics yet. They appear as sessions are closed — or run
            <strong> Backfill analytics</strong> on the Closed sessions page to include older ones.
          </p>
        )}

        {!loading && summary.sessions > 0 && (
          <>
            <div className="stat-strip">
              <div className="stat-card"><div className="stat-icon">S</div><div><div className="stat-num">{summary.sessions}</div><div className="stat-label">Closed sessions</div></div></div>
              <div className="stat-card"><div className="stat-icon">P</div><div><div className="stat-num">{summary.participants}</div><div className="stat-label">Participants</div></div></div>
              <div className="stat-card"><div className="stat-icon">%</div><div><div className="stat-num">{summary.pct}%</div><div className="stat-label">Avg completion</div></div></div>
              <div className="stat-card"><div className="stat-icon">🚩</div><div><div className="stat-num">{summary.flagged}</div><div className="stat-label">Flagged answer{summary.flagged === 1 ? '' : 's'}</div></div></div>
            </div>

            <section className="closed-by-exercise">
              <h2 className="closed-subhead">Completion over time</h2>
              <table className="closed-exercise-table">
                <thead><tr><th>Month closed</th><th>Completion</th><th className="cet-num">Sessions</th></tr></thead>
                <tbody>
                  {overTime.map(m => (
                    <tr key={m.month}><td className="cet-title">{monthLabel(m.month)}</td><td><CompletionBar pct={m.pct} /></td><td className="cet-num">{m.sessions}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="closed-by-exercise">
              <h2 className="closed-subhead">By workbook</h2>
              <table className="closed-exercise-table">
                <thead><tr><th>Workbook</th><th>Completion</th><th className="cet-num">Sessions</th><th className="cet-num">Flags</th></tr></thead>
                <tbody>
                  {byWorkbook.map(w => (
                    <tr key={w.id}><td className="cet-title">{w.title}</td><td><CompletionBar pct={w.pct} /></td><td className="cet-num">{w.sessions}</td><td className="cet-num">{w.flagged || '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="closed-by-exercise">
              <h2 className="closed-subhead">By trainer</h2>
              <table className="closed-exercise-table">
                <thead><tr><th>Trainer</th><th>Completion</th><th className="cet-num">Sessions</th></tr></thead>
                <tbody>
                  {byTrainer.map(t => (
                    <tr key={t.id}><td className="cet-title">{t.name}</td><td><CompletionBar pct={t.pct} /></td><td className="cet-num">{t.sessions}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>

            {isSuper && byVendor.length > 0 && (
              <section className="closed-by-exercise">
                <h2 className="closed-subhead">By vendor</h2>
                <table className="closed-exercise-table">
                  <thead><tr><th>Vendor</th><th>Completion</th><th className="cet-num">Sessions</th></tr></thead>
                  <tbody>
                    {byVendor.map(v => (
                      <tr key={v.id}><td className="cet-title">{v.name}</td><td><CompletionBar pct={v.pct} /></td><td className="cet-num">{v.sessions}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {hardest.length > 0 && (
              <section className="closed-by-exercise">
                <h2 className="closed-subhead">Hardest exercises (lowest completion across cohorts)</h2>
                <table className="closed-exercise-table">
                  <thead><tr><th>Exercise</th><th>Completion</th><th className="cet-num">Cohorts</th></tr></thead>
                  <tbody>
                    {hardest.map(h => (
                      <tr key={h.key}>
                        <td className="cet-title">{h.title}{h.workbook && <span className="muted" style={{ marginLeft: '0.4rem' }}>· {h.workbook}</span>}</td>
                        <td><CompletionBar pct={h.pct} /></td>
                        <td className="cet-num">{h.sessions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
