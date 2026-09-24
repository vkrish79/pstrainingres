// One row per session, one column per measure.
//
// Class names are an-heat-*, NOT the cockpit's .heat-* — that board is rows of
// people inside one session and its rules would fight this one.
//
// Colour follows magnitude: a single hue, light to dark. Anything below half
// also gets a red dot, so the warning does not live in colour alone.

import { useState } from 'react';
import {
  assessmentStats, sessionAvgPct, sessionPassRate, monthLabel,
} from '../../lib/analyticsMetrics.js';
import AnalyticsDotPlot from './AnalyticsDotPlot.jsx';

const COLS = [
  { k: 'people', l: 'People' },
  { k: 'completion', l: 'Completion' },
  { k: 'below', l: 'Under 50%' },
  { k: 'dropped', l: 'Dropped' },
  { k: 'avg', l: 'Avg score' },
  { k: 'pass', l: 'Pass rate' },
];

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function mix(a, b, t) {
  const A = hex(a); const B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}
// Magnitude: pale sand → midnight.
function seq(v) {
  const t = Math.max(0, Math.min(1, v / 100));
  return { background: mix('#f4efe6', '#1e3c5a', Math.pow(t, 1.35)), color: t > 0.62 ? '#fff' : '#1e3c5a' };
}
// A count of people who struggled, scaled by how much of the class it is.
function countCell(n, of) {
  if (!n) return { background: '#f7f5f0', color: '#9aa4ae' };
  const t = Math.min(1, 0.25 + (n / Math.max(1, of)) * 0.9);
  return { background: mix('#fbeee9', '#c2503c', t * 0.85), color: t > 0.6 ? '#fff' : '#8f3526' };
}

function value(s, k) {
  switch (k) {
    case 'people': return s.participants;
    case 'completion': return s.completionPct;
    case 'below': return s.belowThreshold;
    case 'dropped': return s.dropouts;
    case 'avg': return sessionAvgPct(s);
    case 'pass': return sessionPassRate(s);
    case 'date': return String(s.date || '');
    default: return null;
  }
}

function Cells({ s }) {
  const avg = sessionAvgPct(s);
  const pass = sessionPassRate(s);
  const st = assessmentStats([s]);
  return (
    <>
      <td><div className="an-cell plain" data-tip={`${s.participants} people`}>{s.participants}</div></td>
      <td>
        {!s.isClosed ? <div className="an-cell plain"><span className="an-pill live">still open</span></div>
          : s.completionPct == null ? <div className="an-cell na" data-tip="This session closed before completion was recorded">—</div>
            : (
              <div className="an-cell" style={seq(s.completionPct)} data-tip={`Completion ${Math.round(s.completionPct)}% — the average share of exercises finished`}>
                {Math.round(s.completionPct)}%
                {s.completionPct < 50 && <i className="an-flag" />}
              </div>
            )}
      </td>
      <td>
        {!s.isClosed ? <div className="an-cell na">—</div>
          : (
            <div className="an-cell" style={countCell(s.belowThreshold, s.participants)} data-tip={`${s.belowThreshold} of ${s.participants} finished under 50% of the exercises`}>
              {s.belowThreshold}
            </div>
          )}
      </td>
      <td>
        <div className="an-cell" style={countCell(s.dropouts, s.participants)} data-tip={`${s.dropouts || 0} dropped out`}>{s.dropouts || 0}</div>
      </td>
      <td>
        {avg == null
          ? <div className="an-cell na" data-tip={s.assessment ? 'Nobody sat the paper' : 'No assessment in this session'}>—</div>
          : <div className="an-cell" style={seq(avg)} data-tip={`Average ${Math.round(avg)}% on ${s.assessment.title}`}>{Math.round(avg)}%</div>}
      </td>
      <td>
        {pass == null
          ? (
            <div className="an-cell na" data-tip={!s.assessment ? 'No assessment in this session' : s.assessment.passMark == null ? 'This paper has no pass mark' : 'Nobody sat the paper'}>
              —
            </div>
          )
          : (
            <div className="an-cell" style={seq(pass)} data-tip={`${st.pass} of ${st.marked} passed · pass mark ${s.assessment.passMark}%`}>
              {Math.round(pass)}%
              {pass < 50 && <i className="an-flag" />}
            </div>
          )}
      </td>
    </>
  );
}

export default function AnalyticsHeatBoard({ sessions, tall }) {
  const [sort, setSort] = useState({ k: 'date', dir: -1 });
  const [open, setOpen] = useState(null);

  const rows = [...sessions].sort((a, b) => {
    const x = value(a, sort.k); const y = value(b, sort.k);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });

  const click = k => setSort(s => (s.k === k ? { k, dir: -s.dir } : { k, dir: -1 }));
  const head = (k, l, cls) => (
    <th key={k} className={cls}>
      <button type="button" onClick={() => click(k)} aria-pressed={sort.k === k}>
        {l}{sort.k === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );

  let lastMonth = '';
  const body = [];
  for (const s of rows) {
    const month = String(s.date || '').slice(0, 7);
    if (sort.k === 'date' && month && month !== lastMonth) {
      lastMonth = month;
      body.push(
        <tr key={`m-${month}`} className="an-heat-month"><td colSpan={7}>{monthLabel(month, true)}</td></tr>,
      );
    }
    const isOpen = open === s.id;
    body.push(
      <tr
        key={s.id} className={`an-heat-row${isOpen ? ' open' : ''}`} tabIndex={0} aria-expanded={isOpen}
        onClick={() => setOpen(isOpen ? null : s.id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(isOpen ? null : s.id); } }}
      >
        <td className="an-heat-nm">
          <b>{s.name}</b>
          <span>
            {String(s.date || '').slice(0, 10)} · {s.typeName || 'Untyped'}
            {s.trainerName ? ` · ${s.trainerName}` : ''}{s.cityName ? ` · ${s.cityName}` : ''}
          </span>
        </td>
        <Cells s={s} />
      </tr>,
    );
    if (isOpen) {
      body.push(
        <tr key={`d-${s.id}`} className="an-heat-drawer">
          <td colSpan={7}>
            <div className="an-drawbox">
              {s.assessment
                ? <AnalyticsDotPlot sessions={[s]} single />
                : (
                  <span className="an-muted-sm">
                    No assessment in this session. Completion {s.completionPct == null ? 'was not recorded' : `${Math.round(s.completionPct)}%`};
                    {' '}{s.belowThreshold || 0} finished under 50% of the exercises.
                  </span>
                )}
            </div>
          </td>
        </tr>,
      );
    }
  }

  return (
    <>
      <div className={`an-heat-scroll${tall ? ' tall' : ''}`}>
        <table className="an-heat">
          <thead><tr>{head('date', 'Session', 'l')}{COLS.map(c => head(c.k, c.l))}</tr></thead>
          <tbody>{body}</tbody>
        </table>
      </div>
      <div className="an-legend">
        <span><i className="an-key ramp" />0% → 100%</span>
        <span><i className="an-key" style={{ background: '#dc8f7f' }} />people under 50% or dropped out</span>
        <span><i className="an-key dot-crit" />below 50%</span>
        <span><i className="an-key na" />no assessment</span>
        <span className="an-muted-sm">Click a session to see its scores · click a column to sort</span>
      </div>
    </>
  );
}
