// The rail: the shape of the numbers, beside the headline figures.
//
// Deliberately descriptive. Analytics drives no actions, so nothing here is a
// worklist — no "needs attention", no follow-ups. Each panel answers a
// question the gauges can't: how are the scores spread, how far did people
// get, how big are the classes, how long do sessions run, and what stands out.

import { Ring } from './marks.jsx';
import { median, sessionAvgPct } from '../../lib/analyticsMetrics.js';

const BANDS = 10;

// A score distribution IS a histogram — bars are the right form here, and the
// only bars left on the page.
function ScoreSpread({ pcts, passMark }) {
  if (!pcts.length) return <p className="an-muted-sm">No papers sat in this range.</p>;
  const bins = Array.from({ length: BANDS }, () => 0);
  pcts.forEach(p => { bins[Math.min(BANDS - 1, Math.floor(p / 10))] += 1; });
  const max = Math.max(...bins);
  const W = 260; const H = 110; const L = 4; const R = 4; const T = 20; const B = 18;
  const iw = W - L - R; const ih = H - T - B; const bw = iw / BANDS;
  return (
    <>
      <div className="an-gl-s">{pcts.length} papers · median <b className="num">{Math.round(median(pcts))}%</b></div>
      <svg className="an-hist" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="How the scores are spread">
        <line x1={L} x2={W - R} y1={T + ih} y2={T + ih} stroke="#ece8e0" />
        {bins.map((v, i) => {
          const h = (v / max) * ih;
          const x = L + i * bw + 1;
          return (
            <g key={i}>
              {v > 0 && (
                <path
                  d={`M${x} ${T + ih}V${T + ih - h + 3}q0 -3 3 -3h${bw - 8}q3 0 3 3V${T + ih}Z`}
                  fill="#1e3c5a"
                />
              )}
              <rect
                x={L + i * bw} y={T} width={bw} height={ih} fill="transparent"
                data-tip={`${i * 10}–${i === BANDS - 1 ? 100 : i * 10 + 9}% — ${v} paper${v === 1 ? '' : 's'}`}
              />
            </g>
          );
        })}
        {passMark != null && (
          <>
            <line
              x1={L + (passMark / 100) * iw} x2={L + (passMark / 100) * iw} y1={T - 4} y2={T + ih}
              stroke="#b5985a" strokeWidth="2" strokeDasharray="4 3"
            />
            <text
              className="an-ax" x={L + (passMark / 100) * iw + (passMark > 60 ? -5 : 5)} y={T - 8}
              textAnchor={passMark > 60 ? 'end' : 'start'} style={{ fill: '#8b7342', fontWeight: 700 }}
            >
              pass mark {passMark}%
            </text>
          </>
        )}
        {[0, 50, 100].map(t => (
          <text
            key={t} className="an-ax" x={L + (t / 100) * iw} y={H - 4}
            textAnchor={t === 0 ? 'start' : t === 100 ? 'end' : 'middle'}
          >
            {t}%
          </text>
        ))}
      </svg>
    </>
  );
}

function Reach({ label, value, people }) {
  return (
    <div className="an-gl-row">
      <Ring value={people ? (value / people) * 100 : null} size={34} />
      <div>
        <div className="an-gl-k">{label}</div>
        <div className="an-gl-s num">{value} of {people} people</div>
      </div>
    </div>
  );
}

function Fact({ label, value, detail }) {
  if (!value) return null;
  return (
    <li>
      <span className="an-fact-k">{label}</span>
      <b>{value}</b>
      <span className="an-gl-s">{detail}</span>
    </li>
  );
}

export default function AnalyticsGlance({ sessions, h }) {
  const closed = sessions.filter(s => s.isClosed);
  const a = h.assessment;
  const passMarks = sessions.filter(s => s.assessment?.passMark != null).map(s => s.assessment.passMark);
  const sizes = closed.map(s => s.participants);
  const maxSize = Math.max(1, ...sizes);

  const lengths = {
    one: closed.filter(s => s.trainingDays === 1).length,
    few: closed.filter(s => s.trainingDays > 1 && s.trainingDays <= 5).length,
    long: closed.filter(s => s.trainingDays > 5).length,
  };
  const blocks = closed.map(s => s.blockCount).filter(v => v != null);

  const top = (list, fn) => [...list].filter(s => fn(s) != null).sort((x, y) => fn(y) - fn(x))[0];
  const largest = top(closed, s => s.participants);
  const bestCompletion = top(closed.filter(s => s.participants >= 3), s => s.completionPct);
  const bestScore = top(sessions.filter(s => s.assessment), s => sessionAvgPct(s));
  const busiest = (key) => {
    const m = new Map();
    closed.forEach(s => { const v = s[key]; if (v) m.set(v, (m.get(v) || 0) + 1); });
    return [...m.entries()].sort((x, y) => y[1] - x[1])[0];
  };
  const trainer = busiest('trainerName');
  const city = busiest('cityName');

  // Stack dots for classes of the same size rather than overlapping them.
  const seen = {};

  return (
    <aside className="an-rail">
      <div className="an-panel">
        <h3>Score spread</h3>
        <ScoreSpread pcts={a.pcts} passMark={passMarks.length ? median(passMarks) : null} />
      </div>

      <div className="an-panel">
        <h3>How far people got</h3>
        <div className="an-gl-list">
          <Reach label="Finished every exercise" value={h.fullyCompleted} people={h.people} />
          <Reach label="Finished under half" value={h.belowHalf} people={h.people} />
          <Reach label="Never started" value={h.notStarted} people={h.people} />
        </div>
      </div>

      <div className="an-panel">
        <h3>Class size</h3>
        <div className="an-gl-s">
          median <b className="num">{h.medianClass ?? '—'}</b> · smallest {h.smallestClass ?? '—'} · largest {h.largestClass ?? '—'}
        </div>
        <div className="an-sz-strip">
          {closed.map(s => {
            const n = seen[s.participants] = (seen[s.participants] || 0) + 1;
            return (
              <i
                key={s.id} className="an-sz"
                style={{ left: `${(s.participants / maxSize) * 100}%`, bottom: `${2 + (n - 1) * 7}px` }}
                data-tip={`${s.name} — ${s.participants} people`}
              />
            );
          })}
        </div>
        <div className="an-sz-ax"><span>0</span><span>{maxSize}</span></div>
      </div>

      <div className="an-panel">
        <h3>Session length</h3>
        <div className="an-chips">
          <span><b className="num">{lengths.one}</b> one day</span>
          <span><b className="num">{lengths.few}</b> 2–5 days</span>
          <span><b className="num">{lengths.long}</b> 6+ days</span>
        </div>
        <div className="an-gl-s an-mt">
          Workbooks average <b className="num">{blocks.length ? Math.round(blocks.reduce((n, v) => n + v, 0) / blocks.length) : '—'}</b> exercises
        </div>
      </div>

      <div className="an-panel">
        <h3>Standouts</h3>
        <ul className="an-facts">
          <Fact label="Largest class" value={largest?.name} detail={largest ? `${largest.participants} people` : ''} />
          <Fact
            label="Highest completion" value={bestCompletion?.name}
            detail={bestCompletion ? `${Math.round(bestCompletion.completionPct)}% · classes of 3 or more` : ''}
          />
          <Fact
            label="Best average score" value={bestScore?.name}
            detail={bestScore ? `${Math.round(sessionAvgPct(bestScore))}% on ${bestScore.assessment.title}` : ''}
          />
          <Fact label="Most sessions" value={trainer?.[0]} detail={trainer ? `${trainer[1]} closed sessions` : ''} />
          <Fact label="Busiest city" value={city?.[0]} detail={city ? `${city[1]} closed sessions` : ''} />
        </ul>
      </div>

      <div className="an-panel">
        <h3>What&rsquo;s counted</h3>
        <p className="an-gl-s">
          Completion, &ldquo;under 50%&rdquo; and training days count closed sessions only.
          Pass rate counts papers with a pass mark that someone sat.
        </p>
      </div>
    </aside>
  );
}
