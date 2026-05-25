import { Fragment, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { useTrainerSessions } from '../hooks/useTrainerSessions.js';
import { useSessionTypes } from '../hooks/useSessionTypes.js';
import { isSuperTrainerOrAbove } from '../lib/roles.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';

function formatDateRange(start, end) {
  const fmt = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `from ${fmt(start)}`;
  if (end) return `until ${fmt(end)}`;
  return '—';
}
function formatClosed(d) {
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// Archive page. Table view of closed sessions, scoped by RLS:
//   vendor_trainer -> own closed sessions
//   vendor_manager -> closed sessions in their vendor
//   super          -> all closed sessions across vendors
export default function ClosedSessionsPage() {
  const { profile, session: authSession } = useAuth();
  const navigate = useNavigate();
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  // scope='all' relies on RLS for each role.
  const { loading, error, sessions, setSessions } = useTrainerSessions(
    authSession?.user.id, 'all', null, 'closed',
  );
  // includeInactive so a session keeps showing a type that's since been retired.
  const { types: sessionTypes } = useSessionTypes({ includeInactive: true });

  const [backfilling, setBackfilling] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState('');
  const [typeMsg, setTypeMsg] = useState('');

  // Retro-tag a closed session's type. RLS (sessions_trainer_all) already lets a
  // trainer update any session they can see, so a plain update suffices; patch
  // local state rather than refetch.
  async function setType(s, typeId) {
    setTypeMsg('');
    const { error: e } = await supabase
      .from('sessions').update({ session_type_id: typeId || null }).eq('id', s.id);
    if (e) { setTypeMsg(`Couldn't set type for "${s.name}": ${e.message}`); return; }
    const t = sessionTypes.find(x => x.id === typeId) || null;
    setSessions(prev => prev.map(x => (
      x.id === s.id ? { ...x, session_type_id: typeId || null, session_type: t ? { id: t.id, name: t.name } : null } : x
    )));
  }

  // One-time maintenance: populate analytics for sessions closed before the
  // session-analytics feature shipped. Idempotent (upserts), super-tier only.
  async function runBackfill() {
    setBackfilling(true); setBackfillMsg('');
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (!s) { setBackfillMsg('Not authenticated.'); return; }
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/backfill-session-analytics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${s.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({}),
      });
      const j = await res.json();
      if (!res.ok) { setBackfillMsg(j.error || 'Backfill failed.'); return; }
      const errs = j.errors?.length ? `, ${j.errors.length} error(s)` : '';
      setBackfillMsg(`Backfilled ${j.processed} session${j.processed === 1 ? '' : 's'}${j.skipped ? `, skipped ${j.skipped}` : ''}${errs}.`);
    } catch (e) {
      setBackfillMsg(e.message || 'Backfill failed.');
    } finally {
      setBackfilling(false);
    }
  }

  const [query, setQuery] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [sortKey, setSortKey] = useState('closed_at');
  const [sortDir, setSortDir] = useState('desc'); // 'desc' | 'asc'

  const years = useMemo(() => {
    const set = new Set();
    for (const s of sessions) {
      if (s.closed_at) set.add(new Date(s.closed_at).getFullYear());
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [sessions]);

  const vendors = useMemo(() => {
    const map = new Map();
    for (const s of sessions) {
      if (s.vendors?.id) map.set(s.vendors.id, s.vendors);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [sessions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions
      .filter(s => !q || (s.name || '').toLowerCase().includes(q) || (s.vendors?.name || '').toLowerCase().includes(q) || (s.trainer?.full_name || '').toLowerCase().includes(q))
      .filter(s => yearFilter === 'all' || (s.closed_at && new Date(s.closed_at).getFullYear() === Number(yearFilter)))
      .filter(s => vendorFilter === 'all' || s.vendor_id === vendorFilter)
      .sort((a, b) => {
        const dir = sortDir === 'desc' ? -1 : 1;
        if (sortKey === 'name') return dir * (a.name || '').localeCompare(b.name || '');
        if (sortKey === 'starts_at') return dir * ((a.starts_at || '').localeCompare(b.starts_at || ''));
        return dir * ((a.closed_at || '').localeCompare(b.closed_at || ''));
      });
  }, [sessions, query, yearFilter, vendorFilter, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }
  function sortIndicator(key) {
    if (sortKey !== key) return '';
    return sortDir === 'desc' ? ' ↓' : ' ↑';
  }

  // Group by year for visual separators (only when not filtering to one year).
  const grouped = useMemo(() => {
    if (yearFilter !== 'all') return [{ year: Number(yearFilter), rows: filtered }];
    const map = new Map();
    for (const s of filtered) {
      const y = s.closed_at ? new Date(s.closed_at).getFullYear() : 'Unknown';
      if (!map.has(y)) map.set(y, []);
      map.get(y).push(s);
    }
    return Array.from(map.entries())
      .sort((a, b) => (b[0] || 0) - (a[0] || 0))
      .map(([year, rows]) => ({ year, rows }));
  }, [filtered, yearFilter]);

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>📁 Closed sessions</h1>
            <p className="muted">
              {loading ? 'Loading…' : `${sessions.length} session${sessions.length === 1 ? '' : 's'} in the archive`}
            </p>
          </div>
          {isSuper && (
            <div className="page-hero-actions">
              <button
                type="button"
                className="ghost"
                onClick={runBackfill}
                disabled={backfilling}
                title="One-time: compute analytics for sessions closed before this feature shipped"
              >
                {backfilling ? 'Backfilling…' : '↻ Backfill analytics'}
              </button>
            </div>
          )}
        </section>
        {backfillMsg && <p className="prep-notice">{backfillMsg}</p>}
        {typeMsg && <p className="error">{typeMsg}</p>}

        <div className="archive-toolbar">
          <input
            className="form-input"
            type="search"
            placeholder="Search by name, vendor, or trainer…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <select className="form-input" value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
            <option value="all">All years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {isSuper && (
            <select className="form-input" value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}>
              <option value="all">All vendors</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
        </div>

        {error && <p className="error">{error}</p>}
        {!loading && sessions.length === 0 && (
          <p className="muted">No closed sessions yet. When a trainer closes a session, it'll show up here.</p>
        )}
        {!loading && sessions.length > 0 && filtered.length === 0 && (
          <p className="muted">No closed sessions match the current filter.</p>
        )}

        {!loading && filtered.length > 0 && (
          <table className="archive-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort('name')} className="sortable">Session{sortIndicator('name')}</th>
                <th>Type</th>
                {isSuper && <th>Vendor</th>}
                <th>Trainer</th>
                <th onClick={() => toggleSort('starts_at')} className="sortable">Dates{sortIndicator('starts_at')}</th>
                <th onClick={() => toggleSort('closed_at')} className="sortable">Closed{sortIndicator('closed_at')}</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(group => (
                <Fragment key={`group-${group.year}`}>
                  {yearFilter === 'all' && (
                    <tr className="archive-year-row">
                      <td colSpan={isSuper ? 6 : 5}>{group.year}</td>
                    </tr>
                  )}
                  {group.rows.map(s => (
                    <tr
                      key={s.id}
                      className="archive-row"
                      onClick={() => navigate(`/trainer/sessions/${s.id}`)}
                    >
                      <td>
                        <div className="archive-cell-name">
                          {s.name}
                          {s.city_code && <span className="city-tag">{s.city_code}</span>}
                        </div>
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <select
                          className="form-input archive-type-select"
                          value={s.session_type_id || ''}
                          onChange={e => setType(s, e.target.value)}
                          title="Set this session's type"
                        >
                          <option value="">— Untyped —</option>
                          {sessionTypes.map(t => (
                            <option key={t.id} value={t.id}>{t.name}{t.is_active ? '' : ' (inactive)'}</option>
                          ))}
                        </select>
                      </td>
                      {isSuper && <td>{s.vendors?.name || '—'}</td>}
                      <td>{s.trainer?.full_name || '—'}</td>
                      <td>{formatDateRange(s.starts_at, s.ends_at)}</td>
                      <td>{s.closed_at ? formatClosed(s.closed_at) : '—'}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
