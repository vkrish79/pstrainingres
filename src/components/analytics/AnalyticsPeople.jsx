// Names, in pages.
//
// The old page listed one row per person per session with no paging, so it
// grew with every session that closed. The list is the same data; what
// changed is that you now arrive at a filter and a search box, and the page
// is a fixed height whatever the history behind it.

import { useEffect, useMemo, useState } from 'react';
import { papersOf, hasUnlistedPapers, PAPER_STATES } from '../../lib/analyticsMetrics.js';

const PER_PAGE = 15;

const FILTERS = [
  { id: 'all', label: 'Everyone', match: () => true },
  { id: 'pass', label: 'Passed', match: p => p.state === 'pass' },
  { id: 'fail', label: 'Failed', match: p => p.state === 'fail' },
  { id: 'absent', label: 'Didn’t sit', match: p => p.state === 'absent' || p.state === 'incomplete' },
];

export default function AnalyticsPeople({ sessions }) {
  const [filterId, setFilterId] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  const papers = useMemo(() => papersOf(sessions), [sessions]);
  // A narrower date range means fewer pages; go back to the first one rather
  // than leaving a page number that no longer exists.
  useEffect(() => { setPage(0); }, [sessions]);
  const unlisted = useMemo(() => sessions.filter(hasUnlistedPapers), [sessions]);

  const filter = FILTERS.find(f => f.id === filterId) || FILTERS[0];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return papers
      .filter(filter.match)
      .filter(p => !needle || `${p.name} ${p.session.name}`.toLowerCase().includes(needle))
      .sort((a, b) => String(b.session.date).localeCompare(String(a.session.date)) || (b.pct ?? -1) - (a.pct ?? -1));
  }, [papers, filter, q]);

  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const current = Math.min(page, pages - 1);
  const slice = rows.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);

  return (
    <>
      <div className="an-ptools">
        <div className="an-seg light" role="group" aria-label="Filter people">
          {FILTERS.map(f => (
            <button
              key={f.id} type="button" aria-pressed={filterId === f.id}
              onClick={() => { setFilterId(f.id); setPage(0); }}
            >
              {f.label} <span className="num an-count">{papers.filter(f.match).length}</span>
            </button>
          ))}
        </div>
        <input
          id="an-people-search" className="an-search" type="search" value={q}
          placeholder="Find a person or session" aria-label="Find a person or session"
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
        />
      </div>

      <div className="an-tscroll">
        <table className="an-table">
          <thead>
            <tr><th>Person</th><th>Session</th><th>Date</th><th className="r">Score</th><th>Result</th></tr>
          </thead>
          <tbody>
            {slice.length ? slice.map((p, i) => (
              <tr key={`${p.session.id}-${p.name}-${i}`}>
                <td><b>{p.name}</b></td>
                <td>{p.session.name}</td>
                <td className="num">{String(p.session.date || '').slice(0, 10)}</td>
                <td className="r num">{p.pct == null ? '—' : `${p.pct}%`}</td>
                <td><span className={`an-pill ${p.state}`}>{PAPER_STATES[p.state]}</span></td>
              </tr>
            )) : (
              <tr><td colSpan={5}><div className="an-empty">No one matches.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="an-pager">
        <span className="num">
          {rows.length ? `${current * PER_PAGE + 1}–${Math.min(rows.length, current * PER_PAGE + PER_PAGE)} of ${rows.length}` : ''}
        </span>
        <button type="button" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={current === 0}>Previous</button>
        <button type="button" onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={current >= pages - 1}>Next</button>
      </div>

      {unlisted.length > 0 && (
        <p className="an-note">
          {unlisted.length} session{unlisted.length === 1 ? '' : 's'} closed before names were recorded with the scores.
          Those papers count in the figures above but cannot be listed here.
        </p>
      )}
    </>
  );
}
