// One row per cohort, one dot per paper, with the pass mark as a dashed line.
//
// This replaces reading a list of scores: the shape of a cohort — clustered
// just above the line, or spread from 20 to 100 — is the thing worth seeing,
// and a list can never show it.

import { useState } from 'react';
import { papersOf, assessmentStats, hasUnlistedPapers } from '../../lib/analyticsMetrics.js';

const TICKS = [0, 25, 50, 75, 100];
const SHOWN = 12;

function Row({ session }) {
  const papers = papersOf([session]).filter(p => p.pct != null).sort((a, b) => a.pct - b.pct);
  const st = assessmentStats([session]);
  const missed = st.absent + st.incomplete;
  const pm = session.assessment.passMark;
  // Dots at the same score would sit on top of each other; stack them.
  const seen = {};
  return (
    <>
      <div className="an-dot-lab">
        <b>{session.name}</b>
        <span>{String(session.date).slice(0, 10)} · {session.assessment.title}</span>
      </div>
      <div className="an-dot-strip">
        {[25, 50, 75].map(t => <i key={t} className="an-dot-gl" style={{ left: `${t}%` }} />)}
        {pm != null && <i className="an-dot-pm" style={{ left: `${pm}%` }} data-tip={`Pass mark ${pm}%`} />}
        {papers.map((p, i) => {
          const bucket = Math.round(p.pct / 3);
          const n = seen[bucket] = (seen[bucket] || 0) + 1;
          const off = n === 1 ? 0 : (n % 2 ? 1 : -1) * Math.ceil((n - 1) / 2) * 8;
          const state = p.state === 'pass' || p.state === 'fail' ? p.state : 'noresult';
          return (
            <i
              key={`${p.name}-${i}`}
              className={`an-dot ${state}`}
              style={{ left: `${p.pct}%`, top: `calc(50% + ${off}px)` }}
              data-tip={`${p.name} — ${p.pct}%, ${p.state === 'pass' ? 'passed' : p.state === 'fail' ? 'failed' : 'no pass mark set'}`}
            />
          );
        })}
        {!papers.length && <span className="an-dot-none">{hasUnlistedPapers(session) ? 'Scores recorded, names not' : 'Nobody sat this paper'}</span>}
      </div>
      <div className="an-dot-res">
        {pm == null ? <><b>—</b> no pass mark</> : <b>{st.pass}/{st.marked}</b>}
        {missed > 0 && <span>{missed} missed</span>}
      </div>
    </>
  );
}

export default function AnalyticsDotPlot({ sessions, single }) {
  const [all, setAll] = useState(false);
  const withPapers = sessions
    .filter(s => s.assessment)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const shown = single || all ? withPapers : withPapers.slice(0, SHOWN);

  if (!withPapers.length) return <p className="an-empty">No assessed sessions in this range.</p>;

  return (
    <>
      <div className="an-dots">
        {single ? <div /> : <div className="an-dot-hd">Cohort · paper</div>}
        <div className="an-dot-axis">
          {TICKS.map(t => <span key={t} style={{ left: `${t}%` }}>{t}%</span>)}
        </div>
        {single ? <div /> : <div className="an-dot-hd r">Passed</div>}
        {shown.map(s => <Row key={s.id} session={s} />)}
      </div>
      <div className="an-legend">
        <span><i className="an-key an-dot pass" />passed</span>
        <span><i className="an-key an-dot fail" />failed</span>
        <span><i className="an-key an-dot noresult" />paper has no pass mark</span>
        <span><i className="an-key pm" />pass mark</span>
        {!single && <span className="an-muted-sm">One dot per person who sat the paper</span>}
      </div>
      {!single && withPapers.length > SHOWN && (
        <button type="button" className="an-showall" onClick={() => setAll(v => !v)}>
          {all ? `Show the latest ${SHOWN}` : `Show all ${withPapers.length} cohorts`}
        </button>
      )}
    </>
  );
}
