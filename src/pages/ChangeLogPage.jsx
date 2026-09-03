import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { isSuperTrainerOrAbove } from '../lib/roles.js';
import {
  useAllChanges, resolveChangeGroup, resolveSectionChanges, fetchLineDecisions,
} from '../hooks/useWorkbookEditHeat.js';
import ChangeEntry, { keyOf } from '../components/editor/ChangeEntry.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/edit-heat.css';

// Everything the field has reworded, across every workbook, on one page.
//
// The heat markers put each change next to the content it is about, which only
// helps once you know which master to open. This is the other direction: the
// whole log, grouped by workbook and exercise, so "what does the field keep
// changing" is answerable without opening anything.
//
// Grouped rather than a flat table on purpose. A flat list sorted by recency
// answers "what changed lately"; grouped by workbook answers "what does this
// master need", which is the decision this page exists to support.

const TABS = [
  { key: 'open', label: 'Open' },
  { key: 'adopted', label: 'Adopted' },
  { key: 'not_needed', label: 'Not needed' },
  { key: 'all', label: 'All' },
];

function matchesQuery(r, q) {
  if (!q) return true;
  const hay = [
    r.workbook_title, r.section_title, r.session_name,
    r.actor_name, r.city_code,
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

export default function ChangeLogPage() {
  const { profile } = useAuth();
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  const { loading, rows, error, refresh } = useAllChanges(isSuper);

  const [tab, setTab] = useState('open');
  const [workbookFilter, setWorkbookFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const [actionError, setActionError] = useState('');
  const [lines, setLines] = useState(() => new Map());

  // Per-line decisions come from their own RPC and are merged in by group key,
  // so the shared change_groups return type stays as it is.
  const reloadAll = useCallback(async () => {
    const [, { byGroup }] = await Promise.all([refresh(), fetchLineDecisions(null)]);
    setLines(byGroup);
  }, [refresh]);

  useEffect(() => {
    if (!isSuper) return undefined;
    let cancelled = false;
    (async () => {
      const { byGroup } = await fetchLineDecisions(null);
      if (!cancelled) setLines(byGroup);
    })();
    return () => { cancelled = true; };
  }, [isSuper]);

  // Built from the unfiltered rows so the dropdown doesn't shrink as you filter.
  const workbooks = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (r.master_workbook_id && !m.has(r.master_workbook_id)) {
        m.set(r.master_workbook_id, r.workbook_title);
      }
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const counts = useMemo(() => ({
    open: rows.filter(r => r.is_open).length,
    adopted: rows.filter(r => !r.is_open && r.status === 'adopted').length,
    not_needed: rows.filter(r => !r.is_open && r.status === 'not_needed').length,
    all: rows.length,
  }), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (tab === 'open' && !r.is_open) return false;
      if (tab === 'adopted' && (r.is_open || r.status !== 'adopted')) return false;
      if (tab === 'not_needed' && (r.is_open || r.status !== 'not_needed')) return false;
      if (workbookFilter !== 'all' && r.master_workbook_id !== workbookFilter) return false;
      return matchesQuery(r, q);
    });
  }, [rows, tab, workbookFilter, query]);

  // workbook -> exercise -> entries. Workbooks by most recent change (what you
  // want to look at first); exercises in the order they appear in the workbook
  // (what you see when you open the master).
  const grouped = useMemo(() => {
    const byWb = new Map();
    for (const r of filtered) {
      const wbKey = r.master_workbook_id || 'unknown';
      if (!byWb.has(wbKey)) {
        byWb.set(wbKey, {
          id: r.master_workbook_id, title: r.workbook_title,
          lastAt: r.last_changed_at, openCount: 0, sections: new Map(),
        });
      }
      const wb = byWb.get(wbKey);
      if (r.last_changed_at > wb.lastAt) wb.lastAt = r.last_changed_at;
      if (r.is_open) wb.openCount += 1;

      const secKey = r.master_section_id || 'unknown';
      if (!wb.sections.has(secKey)) {
        wb.sections.set(secKey, {
          id: r.master_section_id, title: r.section_title,
          order: r.section_order ?? 9999, openCount: 0, entries: [],
        });
      }
      const sec = wb.sections.get(secKey);
      if (r.is_open) sec.openCount += 1;
      sec.entries.push(r);
    }
    return [...byWb.values()]
      .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))
      .map(wb => ({
        ...wb,
        sections: [...wb.sections.values()]
          .sort((a, b) => a.order - b.order)
          .map(s => ({
            ...s,
            entries: s.entries.sort((a, b) => (a.last_changed_at < b.last_changed_at ? 1 : -1)),
          })),
      }));
  }, [filtered]);

  async function resolveOne(row, status) {
    const k = keyOf(row);
    setBusyKey(k);
    setActionError('');
    const { error: e } = await resolveChangeGroup({
      workbookId: row.master_workbook_id,
      sectionId: row.master_section_id,
      blockId: row.master_block_id,
      sessionId: row.session_id,
      actorId: row.actor_id,
      status,
    });
    setBusyKey(null);
    if (e) { setActionError(e); return; }
    await refresh();
  }

  async function resolveExercise(wbId, sectionId, status) {
    const k = `sec:${sectionId}`;
    setBusyKey(k);
    setActionError('');
    const { error: e } = await resolveSectionChanges({
      workbookId: wbId, sectionId, status,
    });
    setBusyKey(null);
    if (e) { setActionError(e); return; }
    await refresh();
  }

  if (!isSuper) {
    return (
      <>
        <TopBar />
        <main className="page"><p className="muted">Not available for your role.</p></main>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="page-hero">
          <div>
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>Session changes</h1>
            <p>
              Every exercise the field has reworded in its own copy of a workbook.
              Adopting a line writes it into the master workbook, live to enrolled
              participants; dismissing one only records that you decided against it.
            </p>
          </div>
        </div>

        {error && <p className="error">{error}</p>}
        {actionError && <p className="error">{actionError}</p>}

        <div className="cl-controls">
          <div className="cl-tabs">
            {TABS.map(t => (
              <button
                key={t.key}
                type="button"
                className={`cl-tab${tab === t.key ? ' cl-tab--active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label} <span className="cl-tab-count">{counts[t.key]}</span>
              </button>
            ))}
          </div>
          <div className="cl-filters">
            <select
              className="form-input"
              value={workbookFilter}
              onChange={e => setWorkbookFilter(e.target.value)}
            >
              <option value="all">All workbooks</option>
              {workbooks.map(([id, title]) => (
                <option key={id} value={id}>{title}</option>
              ))}
            </select>
            <input
              className="form-input"
              placeholder="Search exercise, session, trainer, city…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>

        {loading && <p className="muted">Loading changes…</p>}

        {!loading && !error && rows.length === 0 && (
          <p className="muted">
            Nothing recorded yet. Changes appear here once a trainer rewords an
            exercise in their session's copy of a workbook.
          </p>
        )}

        {!loading && rows.length > 0 && filtered.length === 0 && (
          <p className="muted">Nothing matches these filters.</p>
        )}

        {grouped.map(wb => (
          <section className="cl-workbook" key={wb.id || 'unknown'}>
            <header className="cl-workbook-head">
              <h2>{wb.title}</h2>
              {wb.openCount > 0 && (
                <span className="eh-pill cl-open-pill">{wb.openCount} open</span>
              )}
              {wb.id && (
                <Link className="cl-open-link" to={`/trainer/workbooks/${wb.id}`}>
                  Open the master →
                </Link>
              )}
            </header>

            {wb.sections.map(sec => (
              <div className="cl-section" key={sec.id || 'unknown'}>
                <div className="cl-section-head">
                  <h3>{sec.title}</h3>
                  {/* Dismissing in bulk writes nothing, so it is safe. There is
                      deliberately no "all adopted": adopting edits the master,
                      and that should be a line someone has actually read. */}
                  {sec.openCount > 1 && sec.id && (
                    <div className="cl-section-bulk">
                      <button
                        type="button" className="ghost"
                        disabled={busyKey === `sec:${sec.id}`}
                        onClick={() => resolveExercise(wb.id, sec.id, 'not_needed')}
                      >
                        {busyKey === `sec:${sec.id}` ? 'Saving…' : `✕ All ${sec.openCount} not needed`}
                      </button>
                    </div>
                  )}
                </div>
                {sec.entries.map(r => (
                  <ChangeEntry
                    key={keyOf(r)}
                    row={r}
                    busy={busyKey === keyOf(r)}
                    onResolve={resolveOne}
                    blockLabel={r.block_order != null ? `Block ${r.block_order + 1}` : null}
                    lineDecisions={lines.get(keyOf(r)) || {}}
                    onChanged={reloadAll}
                  />
                ))}
              </div>
            ))}
          </section>
        ))}
      </main>
    </>
  );
}
