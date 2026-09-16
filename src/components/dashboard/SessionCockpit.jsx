import { useEffect, useState } from 'react';
import { ago, BEHIND_SHARE, sessionDay } from '../../lib/sessionPace.js';
import { useCountdown, assessmentState, STATE_LABEL } from '../../lib/assessmentTimer.js';
import { supabase } from '../../lib/supabase.js';
import { pollIsReady } from '../../hooks/usePolls.js';

// The session cockpit, stage 1: a row of gauges above the tabs and a panel
// beside the roster. Nothing here changes what the page can do — every number
// is read from what the dashboard has already loaded, and every button goes
// somewhere that already existed. It only changes what a trainer sees first:
// the room, rather than a row of PDFs.

// A small ring for a gauge. Drawn, not a library: two circles.
function Ring({ frac, tone }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, frac || 0));
  return (
    <svg className={`cockpit-ring tone-${tone}`} viewBox="0 0 40 40" aria-hidden="true">
      <circle className="cockpit-ring-track" cx="20" cy="20" r={r} />
      <circle
        className="cockpit-ring-arc"
        cx="20" cy="20" r={r}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - f)}
        transform="rotate(-90 20 20)"
      />
      <text x="20" y="23.5" textAnchor="middle">{Math.round(f * 100)}%</text>
    </svg>
  );
}

// The assessment, as a gauge. Clicking it opens the Assessment tab, which is
// where it is opened, locked and extended — this only reports.
//
// "started" is who has saved at least one assessment answer, as of page load.
function AssessmentGauge({ assessment, onOpen }) {
  const { label, expired, urgent } = useCountdown(assessment?.deadlineAt);
  if (!assessment?.id) {
    return (
      <button type="button" className="cockpit-gauge cockpit-gauge-button" onClick={onOpen} title="Open the Assessment tab">
        <div>
          <div className="cockpit-gauge-label">Assessment</div>
          <div className="cockpit-gauge-value is-muted">None</div>
          <div className="cockpit-gauge-hint">nothing attached</div>
        </div>
      </button>
    );
  }
  const state = assessmentState(assessment.unlockedAt, expired);
  return (
    <button
      type="button"
      className={`cockpit-gauge cockpit-gauge-button${urgent ? ' is-warn' : ''}`}
      onClick={onOpen}
      title="Open the Assessment tab"
    >
      <div>
        <div className="cockpit-gauge-label">Assessment</div>
        <div className={`cockpit-gauge-value state-${state}`}>
          {STATE_LABEL[state]}{state === 'open' && label && <small> · {label} left</small>}
        </div>
        <div className="cockpit-gauge-hint">{assessment.started} of {assessment.of} have started</div>
      </div>
    </button>
  );
}

// "Day 1 of 7", for the header. Nothing outside the session's dates would help
// more than a plain date, so it says that instead.
export function SessionDayLabel({ startsAt, endsAt }) {
  const day = sessionDay(startsAt, endsAt);
  if (!day) return null;
  if (day.before) return <span className="cockpit-day">Starts in {day.inDays} day{day.inDays === 1 ? '' : 's'}</span>;
  if (day.after) return <span className="cockpit-day">Ended</span>;
  return <span className="cockpit-day">Day {day.n} of {day.total}</span>;
}

// The time, as the room's wall clock would say it. Re-read every 15 seconds.
export function CockpitClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return (
    <time className="cockpit-clock" dateTime={now.toISOString()}>
      {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
    </time>
  );
}

// What is ready to run in this session, for the Go to keys: the quizzes added
// to it, and the polls in the library that are finished. One read each, on
// load — a trainer adding a quiz does it on the Quiz tab, which re-mounts this.
export function useCockpitReady(sessionId) {
  const [ready, setReady] = useState({ quizzes: null, polls: null });
  useEffect(() => {
    if (!sessionId) return undefined;
    let stop = false;
    (async () => {
      const [q, p] = await Promise.all([
        supabase.from('quizzes').select('id, title, quiz_questions ( id )').eq('session_id', sessionId).order('created_at'),
        supabase.from('polls').select('id, question, options'),
      ]);
      if (stop) return;
      setReady({
        quizzes: q.error ? null : (q.data || []).map(r => ({ title: r.title, questions: r.quiz_questions?.length ?? 0 })),
        polls: p.error ? null : (p.data || []).filter(pollIsReady).length,
      });
    })();
    return () => { stop = true; };
  }, [sessionId]);
  return ready;
}

function quizHint(quizzes) {
  if (quizzes == null) return 'Run a quiz';
  if (quizzes.length === 0) return 'None added yet';
  if (quizzes.length === 1) return `${quizzes[0].title} · ${quizzes[0].questions} Q`;
  return `${quizzes.length} quizzes ready`;
}
function pollHint(n) {
  if (n == null) return 'Ask the room';
  return n === 0 ? 'None ready yet' : `${n} ready`;
}

// What each coloured edge means, in words — for the Selected card and for a
// screen reader, which cannot see the colour.
export const TONE_LABEL = {
  ok: 'Working',
  warn: 'Quiet',
  bad: 'Behind pace',
  off: 'Offline',
  out: 'Dropped out',
};

// The class as tiles: one per person, a ring for how far they have got, and a
// coloured edge for what state they are in. The same data as the table, read
// from across a room instead of down a column. Clicking a tile selects that
// person; their details and actions appear in the panel beside it.
export function RoomTiles({ people, selectedId, onPick }) {
  return (
    <ul className="room-tiles" aria-label="Class">
      {people.map(x => (
        <li key={x.id}>
          <button
            type="button"
            className={`room-tile tone-${x.tone}${x.dropped ? ' is-dropped' : ''}`}
            aria-pressed={x.id === selectedId}
            onClick={() => onPick(x.id)}
            title={`${x.name} — ${TONE_LABEL[x.tone]}`}
          >
            <span className="room-tile-name">{x.name}</span>
            <Ring frac={x.total ? x.answered / x.total : 0} tone={x.tone} />
            <span className="room-tile-where">
              {x.dropped ? (x.p.deactivation_reason || 'Dropped out') : `${x.presence.label.replace(/^last · /, '')} · ${TONE_LABEL[x.tone]}`}
            </span>
            <span className="room-tile-meta">
              {x.answered}/{x.total} · {x.dropped ? 'dropped out' : ago(x.lastActive)}
              {x.noPrep && <span className="no-prep-tag">No prep</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// Names for a gauge hint: the first two, then "+N more".
function names(list) {
  if (!list.length) return 'Nobody';
  const shown = list.slice(0, 2).map(p => p.name).join(', ');
  return list.length > 2 ? `${shown} +${list.length - 2} more` : shown;
}

export function CockpitGauges({ stats, total, dropouts, assessment, onOpenAssessment }) {
  const { active, pace, behind, quiet, online } = stats;

  return (
    <section className="cockpit-gauges" aria-label="Class at a glance">
      <div className="cockpit-gauge">
        <Ring frac={active.length ? online.length / active.length : 0} tone="ok" />
        <div>
          <div className="cockpit-gauge-label">Online</div>
          <div className="cockpit-gauge-value">{online.length}<small> / {active.length}</small></div>
          <div className="cockpit-gauge-hint">
            {dropouts > 0 ? `${dropouts} dropped out` : 'in the workbook now'}
          </div>
        </div>
      </div>

      <div className="cockpit-gauge" title="Half the class has done at least this many">
        <Ring frac={total ? pace / total : 0} tone="gold" />
        <div>
          <div className="cockpit-gauge-label">Class pace</div>
          <div className="cockpit-gauge-value">{pace}<small> / {total}</small></div>
          <div className="cockpit-gauge-hint">where most people are</div>
        </div>
      </div>

      <div
        className={`cockpit-gauge${behind.length ? ' is-bad' : ''}`}
        title={`More than ${Math.round(BEHIND_SHARE * 100)}% below class pace`}
      >
        <div>
          <div className="cockpit-gauge-label">Behind pace</div>
          <div className="cockpit-gauge-value">{behind.length}</div>
          <div className="cockpit-gauge-hint">{names(behind)}</div>
        </div>
      </div>

      <div className={`cockpit-gauge${quiet.length ? ' is-warn' : ''}`} title="Online, but nothing answered and no move to another exercise for 10 minutes or more">
        <div>
          <div className="cockpit-gauge-label">Quiet 10 min+</div>
          <div className="cockpit-gauge-value">{quiet.length}</div>
          <div className="cockpit-gauge-hint">{names(quiet)}</div>
        </div>
      </div>

      <AssessmentGauge assessment={assessment} onOpen={onOpenAssessment} />
    </section>
  );
}

// More offline people than this and they fold into one line. Behind and quiet
// always show in full — they are the reason the card exists. A long offline
// list is mostly the end of the day, and it was pushing the Go to keys off
// the bottom of the screen.
const OFFLINE_FOLD = 3;

export function CockpitRail({ stats, ready, selectedCard, materialsCount, onGo, onCloseSession, onOpenMaterials, onPick }) {
  const { behind, quiet, offline, pace } = stats;
  const [showOffline, setShowOffline] = useState(false);
  const fold = offline.length > OFFLINE_FOLD && !showOffline;
  const alerts = [
    ...behind.map(p => ({ tone: 'bad', p, why: `${pace - p.answered} behind class pace` })),
    ...quiet.map(p => ({ tone: 'warn', p, why: p.lastActive ? `No answer or move for ${ago(p.lastActive).replace(' ago', '')}` : 'Online, nothing answered yet' })),
    ...(fold ? [] : offline.map(p => ({ tone: 'off', p, why: `Offline · last answer ${ago(p.lastTs)}` }))),
  ];

  return (
    <aside className="cockpit-rail" aria-label="Session controls">
      {selectedCard}
      <section className="cockpit-card">
        <h3 className="cockpit-card-title">Needs you</h3>
        {alerts.length === 0 && !fold ? (
          <p className="cockpit-empty">Nobody is behind or quiet right now.</p>
        ) : (
          <ul className="cockpit-alerts">
            {alerts.map(({ tone, p, why }) => (
              <li key={`${tone}-${p.id}`}>
                <button type="button" className="cockpit-alert" onClick={() => onPick(p.id)} title={`Open ${p.name}'s answers`}>
                  <span className={`cockpit-dot tone-${tone}`} aria-hidden="true" />
                  <span className="cockpit-alert-name">{p.name}</span>
                  <span className="cockpit-alert-why">{why}</span>
                </button>
              </li>
            ))}
            {fold && (
              <li>
                <button type="button" className="cockpit-alert" onClick={() => setShowOffline(true)}>
                  <span className="cockpit-dot tone-off" aria-hidden="true" />
                  <span className="cockpit-alert-name">{offline.length} offline</span>
                  <span className="cockpit-alert-why">
                    {offline.slice(0, 2).map(x => x.name).join(', ')}{offline.length > 2 ? ` +${offline.length - 2} more` : ''} · show them
                  </span>
                </button>
              </li>
            )}
            {showOffline && offline.length > OFFLINE_FOLD && (
              <li>
                <button type="button" className="cockpit-alert cockpit-alert-less" onClick={() => setShowOffline(false)}>
                  <span />
                  <span className="cockpit-alert-why">Fold the offline list</span>
                </button>
              </li>
            )}
          </ul>
        )}
      </section>

      {/* Ways IN, not one-press fires: a quiz has to be chosen and a poll given
          a length, and both of those live on their tabs. */}
      <section className="cockpit-card">
        <h3 className="cockpit-card-title">Go to</h3>
        <div className="cockpit-keys">
          <button type="button" className="cockpit-key is-primary" onClick={() => onGo('quiz')}>
            Quiz<small>{quizHint(ready?.quizzes)}</small>
          </button>
          <button type="button" className="cockpit-key" onClick={() => onGo('poll')}>
            Polls<small>{pollHint(ready?.polls)}</small>
          </button>
          <button type="button" className="cockpit-key" onClick={() => onGo('assessment')}>
            Assessment<small>Open or lock it</small>
          </button>
          <button type="button" className="cockpit-key" onClick={onCloseSession}>
            Close session<small>Runs the close check</small>
          </button>
        </div>
      </section>

      {materialsCount > 0 && (
        <section className="cockpit-card cockpit-materials">
          <span><strong>Materials</strong> · {materialsCount} handout{materialsCount === 1 ? '' : 's'}</span>
          <button type="button" className="ghost btn-sm" onClick={onOpenMaterials}>Open</button>
        </section>
      )}
    </aside>
  );
}
