import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

// Assessment results across closed sessions, for the Analytics page.
//
// Every figure comes from session_analytics, written by close-session from the
// same scoring the trainer's Report tab uses. Two consequences worth stating on
// the page rather than burying:
//   * Only CLOSED sessions count. A live session's scores are interim.
//   * Sessions closed before close-session recorded assessments have no
//     results at all — the answers were deleted with the participants.
//
// Pooling rule: averages are over PAPERS, not sessions. A cohort of 20 counts
// twenty times as much as a cohort of one, which is what "average score" means
// to a reader. Papers still awaiting hand-marking at close are counted but kept
// out of every score, because their unmarked questions would read as zeros.

const SERIES = '#1e3c5a'; // one series per chart: one hue, no legend

const GROUPS = [
  { id: 'assessment', label: 'Assessment', key: s => s.assessment.title, name: s => s.assessment.title },
  { id: 'type', label: 'Session type', key: s => s.typeId ?? '__none__', name: s => s.typeName || 'Untyped' },
  { id: 'vendor', label: 'Vendor', key: s => s.vendorId ?? '__none__', name: s => s.vendorName || 'No vendor (super-delivered)' },
  { id: 'city', label: 'City', key: s => s.cityCode ?? '__none__', name: s => s.cityName || 'No city' },
  { id: 'trainer', label: 'Trainer', key: s => s.trainerId ?? '__none__', name: s => s.trainerName || '(unknown)' },
];

function pooled(sessions) {
  let participants = 0; let sat = 0; let incomplete = 0; let pass = 0; let fail = 0;
  const pcts = [];
  for (const s of sessions) {
    const a = s.assessment;
    participants += a.participants;
    sat += a.sat;
    incomplete += a.incomplete;
    pass += a.pass;
    fail += a.fail;
    pcts.push(...a.scorePcts);
  }
  const avg = pcts.length ? Math.round(pcts.reduce((n, p) => n + p, 0) / pcts.length) : null;
  const decided = pass + fail;
  return {
    sessions: sessions.length, participants, sat, incomplete, pass, fail, pcts, avg,
    passRate: decided ? Math.round((pass / decided) * 100) : null,
  };
}

// Ten bands; 100% sits in the top band rather than getting a lonely bar.
// `tick` is the axis label (the band's floor — ten full ranges do not fit
// under a half-width tile); `band` is the full range, for the tooltip.
function distribution(pcts) {
  const bins = Array.from({ length: 10 }, (_, i) => ({
    tick: `${i * 10}`,
    band: i === 9 ? '90–100' : `${i * 10}–${i * 10 + 9}`,
    papers: 0,
  }));
  for (const p of pcts) bins[Math.min(9, Math.max(0, Math.floor(p / 10)))].papers += 1;
  return bins;
}

// Mean score per month. Months with no scored papers stay null so the line
// breaks there instead of dropping to a zero nobody scored.
function monthlyAverage(sessions) {
  const m = new Map();
  for (const s of sessions) {
    const k = s.date ? String(s.date).slice(0, 7) : null;
    if (!k || !s.assessment.scorePcts.length) continue;
    const g = m.get(k) || { sum: 0, n: 0 };
    for (const p of s.assessment.scorePcts) { g.sum += p; g.n += 1; }
    m.set(k, g);
  }
  if (m.size === 0) return [];
  const keys = [...m.keys()].sort();
  const out = [];
  let [y, mo] = keys[0].split('-').map(Number);
  const [ey, emo] = keys[keys.length - 1].split('-').map(Number);
  while (y < ey || (y === ey && mo <= emo)) {
    const k = `${y}-${String(mo).padStart(2, '0')}`;
    const g = m.get(k);
    out.push({
      key: k,
      label: new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
      avg: g ? Math.round(g.sum / g.n) : null,
      papers: g ? g.n : 0,
    });
    mo += 1;
    if (mo > 12) { mo = 1; y += 1; }
  }
  return out;
}

function Stat({ icon, value, label, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div>
        <div className="stat-num">{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

export default function AssessmentAnalytics({ sessions, filterName }) {
  const [groupBy, setGroupBy] = useState('assessment');
  const assessed = useMemo(() => sessions.filter(s => s.assessment), [sessions]);
  const total = useMemo(() => pooled(assessed), [assessed]);
  const bins = useMemo(() => distribution(total.pcts), [total.pcts]);
  const trend = useMemo(() => monthlyAverage(assessed), [assessed]);

  const grouped = useMemo(() => {
    const g = GROUPS.find(x => x.id === groupBy) || GROUPS[0];
    const m = new Map();
    for (const s of assessed) {
      const k = g.key(s);
      if (!m.has(k)) m.set(k, { key: k, name: g.name(s), sessions: [] });
      m.get(k).sessions.push(s);
    }
    return [...m.values()]
      .map(r => ({ ...r, ...pooled(r.sessions) }))
      .sort((a, b) => b.sat - a.sat || a.name.localeCompare(b.name));
  }, [assessed, groupBy]);

  const groupLabel = (GROUPS.find(x => x.id === groupBy) || GROUPS[0]).label;

  return (
    <section className="asmt-analytics">
      <h2 className="closed-subhead">Assessments</h2>
      <p className="muted asmt-analytics-note">
        From closed sessions only — scores are recorded when a session closes. Sessions closed before
        this was added have no assessment results.
      </p>

      {assessed.length === 0 ? (
        <p className="muted">
          {filterName
            ? `No closed "${filterName}" sessions with a recorded assessment yet.`
            : 'No closed sessions with a recorded assessment yet.'}
        </p>
      ) : (
        <>
          <div className="stat-strip">
            <Stat icon="A" value={total.sessions} label={`Assessed session${total.sessions === 1 ? '' : 's'}`} />
            <Stat
              icon="✎" value={total.sat} label="Papers sat"
              sub={`of ${total.participants} active participant${total.participants === 1 ? '' : 's'}`}
            />
            <Stat
              icon="%" value={total.avg != null ? `${total.avg}%` : '—'} label="Average score"
              sub={`${total.pcts.length} fully-marked paper${total.pcts.length === 1 ? '' : 's'}`}
            />
            <Stat
              icon="✓" value={total.passRate != null ? `${total.passRate}%` : '—'} label="Pass rate"
              sub={total.pass + total.fail > 0 ? `${total.pass} passed · ${total.fail} failed` : 'no pass mark set'}
            />
            {total.incomplete > 0 && (
              <Stat icon="✋" value={total.incomplete} label="Unmarked at close" sub="not in any score" />
            )}
          </div>

          <div className="dash-grid">
            <div className="dash-tile">
              <h3>Score distribution</h3>
              {total.pcts.length === 0 ? (
                <p className="muted">No fully-marked papers to plot.</p>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={bins} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="tick" tick={{ fontSize: 11 }} interval={0} unit="%" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip
                      cursor={{ fill: 'rgba(30, 60, 90, 0.06)' }}
                      formatter={(v) => [v, 'Papers']}
                      labelFormatter={(_l, items) => `Scored ${items?.[0]?.payload?.band ?? ''}%`}
                    />
                    <Bar dataKey="papers" name="Papers" fill={SERIES} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="dash-tile">
              <h3>Average score over time</h3>
              {trend.length === 0 ? (
                <p className="muted">No fully-marked papers to plot.</p>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 8, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(v, _n, item) => [v == null ? '—' : `${v}% (${item.payload.papers} paper${item.payload.papers === 1 ? '' : 's'})`, 'Average']}
                    />
                    <Line
                      type="monotone" dataKey="avg" name="Average" stroke={SERIES} strokeWidth={2}
                      dot={{ r: 4 }} activeDot={{ r: 5 }} connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <section className="closed-by-exercise">
            <div className="asmt-group-head">
              <h2 className="closed-subhead" style={{ margin: 0 }}>Results by {groupLabel.toLowerCase()}</h2>
              <select
                className="form-input"
                style={{ width: 'auto', minWidth: '11rem' }}
                value={groupBy}
                onChange={e => setGroupBy(e.target.value)}
                aria-label="Group assessment results by"
              >
                {GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            </div>
            <table className="srt-table">
              <thead>
                <tr>
                  <th>{groupLabel}</th>
                  <th className="srt-num">Sessions</th>
                  <th className="srt-num">Sat</th>
                  <th>Average score</th>
                  <th className="srt-num">Passed</th>
                  <th className="srt-num">Failed</th>
                  <th className="srt-num">Pass rate</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(r => (
                  <tr key={r.key}>
                    <td className="srt-name">{r.name}</td>
                    <td className="srt-num">{r.sessions}</td>
                    <td className="srt-num">{r.sat}</td>
                    <td>
                      {r.avg == null ? <span className="muted">—</span> : (
                        <div className="srt-bar-row">
                          <div className="srt-bar-track asmt-score-track" title={`${r.avg}% average over ${r.pcts.length} fully-marked paper${r.pcts.length === 1 ? '' : 's'}`}>
                            <div className="asmt-score-bar" style={{ width: `${r.avg}%` }} />
                          </div>
                          <span className="srt-bar-label">{r.avg}%</span>
                        </div>
                      )}
                    </td>
                    <td className="srt-num">{r.pass}</td>
                    <td className="srt-num">{r.fail}</td>
                    <td className="srt-num">{r.passRate != null ? `${r.passRate}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </section>
  );
}
