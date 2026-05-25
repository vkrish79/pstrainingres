import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ComposedChart, Line,
} from 'recharts';
import { useSessionRollup } from '../hooks/useSessionRollup.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';

const NONE = '__none__'; // bucket key for sessions with no type / no vendor
const ACTIVE_COLOR = '#4CAF50';
const CLOSED_COLOR = '#9aa7b4';
// Categorical palette (brand-ish) for type/vendor slices.
const PALETTE = ['#b5985a', '#1e3c5a', '#4CAF50', '#6b8fb5', '#c9bea6', '#8b7342', '#9aa7b4', '#d98c5f', '#5a8a72', '#a05c7b'];

// Tally active/closed sessions + participants for each group.
function rollup(rows, keyFn, nameFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, { key: k, name: nameFn(r), active: 0, closed: 0, participants: 0 });
    const g = m.get(k);
    if (r.isClosed) g.closed += 1; else g.active += 1;
    g.participants += r.participants;
  }
  return [...m.values()].sort((x, y) => (y.active + y.closed) - (x.active + x.closed));
}

// Sessions per month (gap-filled so the line is continuous), split active/closed
// with a participant tally.
function buildTimeSeries(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = r.date ? String(r.date).slice(0, 7) : null;
    if (!k) continue;
    if (!m.has(k)) m.set(k, { active: 0, closed: 0, participants: 0 });
    const g = m.get(k);
    if (r.isClosed) g.closed += 1; else g.active += 1;
    g.participants += r.participants;
  }
  if (m.size === 0) return [];
  const keys = [...m.keys()].sort();
  const out = [];
  let [y, mo] = keys[0].split('-').map(Number);
  const [ey, emo] = keys[keys.length - 1].split('-').map(Number);
  while (y < ey || (y === ey && mo <= emo)) {
    const k = `${y}-${String(mo).padStart(2, '0')}`;
    const g = m.get(k) || { active: 0, closed: 0, participants: 0 };
    out.push({ key: k, label: new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), ...g });
    mo += 1;
    if (mo > 12) { mo = 1; y += 1; }
  }
  return out;
}

function Tile({ title, wide, children }) {
  return (
    <div className={`dash-tile${wide ? ' wide' : ''}`}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

// A volume-scaled, active/closed-split bar used in the detail tables.
function SessionsBar({ active, closed, max }) {
  const total = active + closed;
  const widthPct = max > 0 ? (total / max) * 100 : 0;
  const activePct = total > 0 ? (active / total) * 100 : 0;
  return (
    <div className="srt-bar-row">
      <div className="srt-bar-track">
        <div className="srt-bar" style={{ width: `${widthPct}%` }} title={`${active} active · ${closed} closed`}>
          <div className="srt-seg-active" style={{ width: `${activePct}%` }} />
          <div className="srt-seg-closed" style={{ width: `${100 - activePct}%` }} />
        </div>
      </div>
      <span className="srt-bar-label">{total}</span>
    </div>
  );
}

function RollupTable({ title, label, rows, emptyNote }) {
  const max = rows.reduce((m, r) => Math.max(m, r.active + r.closed), 0);
  return (
    <section className="closed-by-exercise">
      <h2 className="closed-subhead">{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">{emptyNote}</p>
      ) : (
        <table className="srt-table">
          <thead>
            <tr>
              <th>{label}</th><th>Sessions</th>
              <th className="srt-num">Active</th><th className="srt-num">Closed</th><th className="srt-num">Participants</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="srt-name">{r.name}</td>
                <td><SessionsBar active={r.active} closed={r.closed} max={max} /></td>
                <td className="srt-num">{r.active}</td>
                <td className="srt-num">{r.closed}</td>
                <td className="srt-num">{r.participants}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function AnalyticsPage() {
  const { loading, error, sessions } = useSessionRollup();
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | typeId | NONE

  const typeOptions = useMemo(() => {
    const m = new Map();
    let hasUntyped = false;
    for (const s of sessions) {
      if (s.typeId) m.set(s.typeId, s.typeName || '(unknown type)');
      else hasUntyped = true;
    }
    const opts = [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    if (hasUntyped) opts.push({ id: NONE, name: 'Untyped' });
    return opts;
  }, [sessions]);

  const filtered = useMemo(() => (
    typeFilter === 'all' ? sessions : sessions.filter((s) => (s.typeId ?? NONE) === typeFilter)
  ), [sessions, typeFilter]);

  const overall = useMemo(() => ({
    sessions: filtered.length,
    active: filtered.filter((s) => !s.isClosed).length,
    closed: filtered.filter((s) => s.isClosed).length,
    participants: filtered.reduce((n, s) => n + s.participants, 0),
  }), [filtered]);

  const byType = useMemo(() => rollup(sessions, (s) => s.typeId ?? NONE, (s) => s.typeName || 'Untyped'), [sessions]);
  const byVendor = useMemo(() => rollup(filtered.filter((s) => s.vendorId), (s) => s.vendorId, (s) => s.vendorName || '(unknown vendor)'), [filtered]);
  const byCity = useMemo(() => rollup(filtered.filter((s) => s.cityCode), (s) => s.cityCode, (s) => s.cityName || s.cityCode), [filtered]);
  const bySuperTrainer = useMemo(() => rollup(filtered.filter((s) => !s.vendorId && s.isSuperTrainer), (s) => s.trainerId, (s) => s.trainerName || '(unknown)'), [filtered]);
  const timeSeries = useMemo(() => buildTimeSeries(filtered), [filtered]);

  const filterName = typeFilter === 'all' ? null : (typeOptions.find((o) => o.id === typeFilter)?.name || '');
  const statusData = [
    { name: 'Active', value: overall.active },
    { name: 'Closed', value: overall.closed },
  ].filter((d) => d.value > 0);
  const vendorBars = byVendor.map((v) => ({ name: v.name, active: v.active, closed: v.closed }));

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>📊 Analytics</h1>
            <p className="muted">
              {loading
                ? 'Loading…'
                : filterName
                  ? `${filterName} · ${overall.sessions} session${overall.sessions === 1 ? '' : 's'}`
                  : `${overall.sessions} session${overall.sessions === 1 ? '' : 's'} across every cohort you can see`}
            </p>
          </div>
        </section>

        {error && <p className="error">{error}</p>}
        {!loading && !error && sessions.length === 0 && (
          <p className="muted">No sessions yet. Create one to start tracking volume here.</p>
        )}

        {!loading && sessions.length > 0 && (
          <>
            {typeOptions.length > 0 && (
              <div className="srt-filter">
                <label htmlFor="srt-type">Session type</label>
                <select
                  id="srt-type"
                  className="form-input"
                  style={{ width: 'auto', minWidth: '13rem' }}
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  <option value="all">All types</option>
                  {typeOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            )}

            <div className="stat-strip">
              <div className="stat-card"><div className="stat-icon">S</div><div><div className="stat-num">{overall.sessions}</div><div className="stat-label">{filterName ? `${filterName} sessions` : 'Total sessions'}</div></div></div>
              <div className="stat-card"><div className="stat-icon">●</div><div><div className="stat-num">{overall.active}</div><div className="stat-label">Active sessions</div></div></div>
              <div className="stat-card"><div className="stat-icon">✓</div><div><div className="stat-num">{overall.closed}</div><div className="stat-label">Closed sessions</div></div></div>
              <div className="stat-card"><div className="stat-icon">P</div><div><div className="stat-num">{overall.participants}</div><div className="stat-label">Participants</div></div></div>
            </div>

            <div className="dash-grid">
              <Tile title="Session status">
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                      {statusData.map((d) => (
                        <Cell key={d.name} fill={d.name === 'Active' ? ACTIVE_COLOR : CLOSED_COLOR} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </Tile>

              {typeFilter === 'all' && byType.length > 0 && (
                <Tile title="Sessions by type">
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={byType.map((t) => ({ name: t.name, value: t.active + t.closed }))} dataKey="value" nameKey="name" outerRadius={85} label>
                        {byType.map((t, i) => <Cell key={t.key} fill={PALETTE[i % PALETTE.length]} />)}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </Tile>
              )}

              {vendorBars.length > 0 && (
                <Tile title="Sessions by vendor">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={vendorBars} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="active" stackId="a" name="Active" fill={ACTIVE_COLOR} />
                      <Bar dataKey="closed" stackId="a" name="Closed" fill={CLOSED_COLOR} />
                    </BarChart>
                  </ResponsiveContainer>
                </Tile>
              )}

              <Tile title="Sessions over time" wide>
                {timeSeries.length === 0 ? (
                  <p className="muted">No dated sessions to plot.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={timeSeries} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar yAxisId="left" dataKey="active" stackId="t" name="Active" fill={ACTIVE_COLOR} />
                      <Bar yAxisId="left" dataKey="closed" stackId="t" name="Closed" fill={CLOSED_COLOR} />
                      <Line yAxisId="right" type="monotone" dataKey="participants" name="Participants" stroke="#b5985a" strokeWidth={2} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </Tile>
            </div>

            {typeFilter === 'all' && (
              <RollupTable title="By session type" label="Session type" rows={byType} />
            )}
            <RollupTable
              title="By vendor" label="Vendor" rows={byVendor}
              emptyNote={filterName ? `No vendor-delivered "${filterName}" sessions.` : 'No vendor-delivered sessions.'}
            />
            <RollupTable
              title="By city / venue" label="City" rows={byCity}
              emptyNote={filterName ? `No "${filterName}" sessions have a city set.` : 'No sessions have a city set.'}
            />
            <RollupTable
              title="By super trainer" label="Super trainer" rows={bySuperTrainer}
              emptyNote={filterName ? `No super-delivered "${filterName}" sessions.` : 'No super-delivered sessions.'}
            />
          </>
        )}
      </main>
    </>
  );
}
