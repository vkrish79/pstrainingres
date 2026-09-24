// Analytics, rebuilt as a cockpit deck (mockup: docs/analytics-cockpit-next.md).
//
// What this page is NOT: a worklist. Nothing here asks anyone to do anything;
// it reports what happened. That is why there is no "needs attention" rail and
// no follow-up list — the rail carries the shape of the numbers instead.
//
// Structure: five gauges, four tabs, and a descriptive rail. It stays the same
// length however many sessions have closed, which the old one-row-per-person
// results list did not.

import { useMemo, useState } from 'react';
import { useSessionRollup } from '../hooks/useSessionRollup.js';
import { headline, GROUPINGS } from '../lib/analyticsMetrics.js';
import TopBar from '../components/TopBar.jsx';
import AnalyticsGauges from '../components/analytics/AnalyticsGauges.jsx';
import AnalyticsOverview from '../components/analytics/AnalyticsOverview.jsx';
import AnalyticsHeatBoard from '../components/analytics/AnalyticsHeatBoard.jsx';
import AnalyticsDotPlot from '../components/analytics/AnalyticsDotPlot.jsx';
import AnalyticsPeople from '../components/analytics/AnalyticsPeople.jsx';
import AnalyticsGlance from '../components/analytics/AnalyticsGlance.jsx';
import AnalyticsExportDialog from '../components/analytics/AnalyticsExportDialog.jsx';
import '../styles/dashboard.css';
import '../styles/analytics.css';

const NONE = '__none__';

// The range scopes the QUERY, not just the drawing — see useSessionRollup.
const RANGES = [
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: '180', label: 'Last 6 months', days: 180 },
  { id: 'all', label: 'All time', days: null },
];

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'cohorts', label: 'Cohorts' },
  { id: 'assess', label: 'Assessments' },
  { id: 'people', label: 'People' },
];

export default function AnalyticsPage() {
  const [rangeId, setRangeId] = useState('all');
  const range = RANGES.find(r => r.id === rangeId) || RANGES[2];
  const { loading, error, sessions } = useSessionRollup({ sinceDays: range.days });

  const [typeFilter, setTypeFilter] = useState('all');
  const [tab, setTab] = useState('overview');
  const [groupId, setGroupId] = useState(GROUPINGS[0].id);
  const [exporting, setExporting] = useState(false);

  const typeOptions = useMemo(() => {
    const m = new Map();
    let untyped = false;
    for (const s of sessions) {
      if (s.typeId) m.set(s.typeId, s.typeName || '(unknown type)');
      else untyped = true;
    }
    const opts = [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    if (untyped) opts.push({ id: NONE, name: 'Untyped' });
    return opts;
  }, [sessions]);

  const filtered = useMemo(() => (
    typeFilter === 'all' ? sessions : sessions.filter(s => (s.typeId ?? NONE) === typeFilter)
  ), [sessions, typeFilter]);

  const h = useMemo(() => headline(filtered), [filtered]);
  const papers = h.assessment.sat + h.assessment.absent + h.assessment.incomplete;

  return (
    <>
      <TopBar />
      <main className="page an-page">
        <div className="an-head">
          <div>
            <h1 className="an-title">Analytics</h1>
            <p className="an-sub">
              {loading ? 'Reading sessions…' : (
                <>
                  {filtered.length} session{filtered.length === 1 ? '' : 's'} · {h.closed} closed · {papers} assessment paper{papers === 1 ? '' : 's'}
                </>
              )}
            </p>
          </div>
          <div className="an-head-tools">
            {typeOptions.length > 0 && (
              <select
                id="an-type" className="form-input an-type" value={typeFilter}
                aria-label="Session type" onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="all">All types</option>
                {typeOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            <div className="an-seg light" role="group" aria-label="Date range">
              {RANGES.map(r => (
                <button key={r.id} type="button" aria-pressed={rangeId === r.id} onClick={() => setRangeId(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>
            <button
              type="button" className="an-xlbtn" onClick={() => setExporting(true)}
              disabled={loading || !filtered.length}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M8 2v8m0 0l-3-3m3 3l3-3M3 12.5h10" fill="none" stroke="currentColor"
                  strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
                />
              </svg>
              Download for Excel
            </button>
          </div>
        </div>

        {error && <p className="error">{error}</p>}
        {loading && <p className="muted">Loading…</p>}

        {!loading && !error && sessions.length === 0 && (
          <p className="muted">
            {range.days ? 'No sessions in this date range. Try a longer range.' : 'No sessions yet. Create one to start tracking volume here.'}
          </p>
        )}

        {!loading && !error && sessions.length > 0 && (
          <>
            <AnalyticsGauges h={h} />

            <div className="an-deck">
              <div className="an-panel an-main">
                <div className="an-panel-head">
                  <div className="an-seg light" role="tablist" aria-label="Analytics views">
                    {TABS.map(t => (
                      <button
                        key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id}
                        onClick={() => setTab(t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <span className="an-muted-sm">{filtered.length} sessions in range</span>
                </div>

                {tab === 'overview' && <AnalyticsOverview sessions={filtered} groupId={groupId} onGroup={setGroupId} />}
                {tab === 'cohorts' && <AnalyticsHeatBoard sessions={filtered} />}
                {tab === 'assess' && <AnalyticsDotPlot sessions={filtered} />}
                {tab === 'people' && <AnalyticsPeople sessions={filtered} />}
              </div>

              <AnalyticsGlance sessions={filtered} h={h} />
            </div>
          </>
        )}

        {exporting && (
          <AnalyticsExportDialog
            sessions={filtered}
            rangeId={range.id === 'all' ? 'all-time' : `${range.days}-days`}
            rangeLabel={range.label}
            onClose={() => setExporting(false)}
          />
        )}
      </main>
    </>
  );
}
