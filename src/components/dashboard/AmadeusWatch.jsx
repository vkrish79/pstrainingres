import { useEffect, useState } from 'react';
import Block from '../blocks/Block.jsx';
import { TONE_LABEL } from './SessionCockpit.jsx';
import '../../styles/amadeus-watch.css';

// Watch Amadeus on the session dashboard: the small picture on a tile, the
// Room's controls, and the watch view. Data comes from useAmadeusWatch.

function ageText(at) {
  if (!at) return '';
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
}

function clockOf(at) {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function agoOf(at) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min ${s % 60}s`;
}

// state: { status: 'sharing' | 'paused' | 'off', thumb, thumbAt }
export function AmadeusThumb({ state, size = 'tile' }) {
  if (state.status === 'off') {
    return <span className={`amx-thumb is-none is-${size}`}>Not sharing Amadeus</span>;
  }
  if (!state.thumb) {
    return <span className={`amx-thumb is-none is-${size}`}>{state.status === 'paused' ? 'Paused' : 'Sharing · picture on its way'}</span>;
  }
  return (
    <span className={`amx-thumb is-${size}${state.status === 'paused' ? ' is-paused' : ''}`}>
      <img src={state.thumb} alt="" />
      {state.status === 'paused'
        ? <span className="amx-thumb-flag">Paused</span>
        : <span className="amx-thumb-age">{ageText(state.thumbAt)}</span>}
    </span>
  );
}

// Above the class: how many are sharing, ask everyone, pictures on/off.
export function AmadeusRoomControls({ sharing, of, pictures, onPictures, onAskAll }) {
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (!asked) return undefined;
    const t = setTimeout(() => setAsked(false), 2500);
    return () => clearTimeout(t);
  }, [asked]);
  return (
    <span className="amx-room" role="group" aria-label="Amadeus">
      <span className="amx-room-count" data-tip="Participants sharing their ARD Web tab">
        🖥 Sharing <b>{sharing}</b> of {of}
      </span>
      {sharing < of && (
        <button type="button" className="ghost amx-room-ask" onClick={() => { onAskAll(); setAsked(true); }}
          data-tip="Shows a “please share” card in everyone's workbook">
          {asked ? 'Asked ✓' : 'Ask everyone to share'}
        </button>
      )}
      <label className="amx-room-pics" data-tip="Show a picture of their Amadeus on each tile">
        <input type="checkbox" checked={pictures} onChange={e => onPictures(e.target.checked)} /> Pictures
      </label>
    </span>
  );
}

// One person's Amadeus, big, with the exercise they're on beside it.
export function AmadeusWatchPane({
  selected, state, frame, onAsk, onBack, onOpenAnswers,
  stepPeople, stepAt, stepPrev, stepNext, stepTo, selectedParticipantId,
  section, blocks, answers, history = [],
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const [asked, setAsked] = useState(false);
  // Looking back (A6): the time of the picture being shown, or null for live.
  // Held as a time rather than a position, so pictures arriving while you look
  // don't move what you're looking at.
  const [backAt, setBackAt] = useState(null);
  useEffect(() => { setAsked(false); setBackAt(null); }, [selectedParticipantId]);

  const fresh = frame && Date.now() - frame.at < 4000;
  const img = frame?.img || state.thumb || null;
  const looking = backAt != null && history.length > 0;
  let backIdx = -1;
  if (looking) {
    backIdx = 0;
    for (let i = 0; i < history.length; i++) if (history[i].at <= backAt) backIdx = i;
  }
  const shown = looking ? history[backIdx] : null;
  const sectionBlocks = section ? blocks.filter(b => b.section_id === section.id) : [];

  return (
    <aside className="answers-pane amx-watch">
      <header className="answers-pane-header">
        <button type="button" className="ghost answers-back" onClick={onBack} title="Back to the class (Esc)">&larr; Back to the class</button>
        <div className="answers-stepper" role="group" aria-label="Step through participants">
          <button type="button" className="answers-step" onClick={() => stepTo(stepPrev)} disabled={!stepPrev} title="Previous person (←)" aria-label="Previous person">‹ Prev</button>
          <div className="answers-who">
            <h2>{selected.full_name} · Amadeus</h2>
            {stepAt >= 0 && <span className="answers-count">{stepAt + 1} of {stepPeople.length}</span>}
          </div>
          <button type="button" className="answers-step" onClick={() => stepTo(stepNext)} disabled={!stepNext} title="Next person (→)" aria-label="Next person">Next ›</button>
        </div>
        <span className={`amx-live${fresh && !looking ? '' : ' is-wait'}`}>
          {looking ? 'LOOKING BACK' : state.status === 'paused' ? 'PAUSED' : fresh ? 'LIVE' : state.status === 'sharing' ? 'CONNECTING…' : 'NOT SHARING'}
        </span>
        <button type="button" className="ghost" onClick={onOpenAnswers}>All their answers</button>
      </header>
      <nav className="answers-strip" aria-label="Participants">
        {stepPeople.map(x => (
          <button key={x.id} type="button" className="answers-chip" aria-pressed={x.id === selectedParticipantId}
            onClick={() => stepTo(x.id)} title={`${x.name} — ${TONE_LABEL[x.tone]}`}>
            <span className={`cockpit-dot tone-${x.tone}`} aria-hidden="true" />
            {x.hand && <span aria-label="Asked for help">✋</span>}
            {x.name}
          </button>
        ))}
      </nav>
      <div className="amx-watch-body">
        <div className="amx-watch-screen">
          {looking ? (
            <div className="amx-watch-img is-back">
              <img src={shown.img} alt={`${selected.full_name}'s Amadeus at ${clockOf(shown.at)}`} />
            </div>
          ) : state.status === 'off' ? (
            <div className="amx-watch-empty">
              <p><strong>{selected.full_name}</strong> isn't sharing Amadeus.</p>
              <button type="button" onClick={() => { onAsk(); setAsked(true); }} disabled={asked}>
                {asked ? 'Asked ✓' : `Ask ${selected.full_name} to share`}
              </button>
              <p className="muted">A card appears in their workbook. Only you see what they share.</p>
            </div>
          ) : img ? (
            <div className={`amx-watch-img${state.status === 'paused' ? ' is-paused' : ''}`}>
              <img src={img} alt={`${selected.full_name}'s Amadeus`} />
              {state.status === 'paused' && <span className="amx-thumb-flag">Paused</span>}
            </div>
          ) : (
            <div className="amx-watch-empty"><p className="muted">Waiting for the first picture…</p></div>
          )}
          {history.length > 1 && (
            <div className="amx-scrub">
              <span className="amx-scrub-end">{clockOf(history[0].at)}</span>
              <input
                type="range"
                min={0}
                max={history.length}
                value={looking ? backIdx : history.length}
                onChange={e => {
                  const v = Number(e.target.value);
                  setBackAt(v >= history.length ? null : history[v].at);
                }}
                // ← → move the slider here, not to the next person.
                onKeyDown={e => e.stopPropagation()}
                aria-label="Look back through the last 10 minutes"
              />
              <span className="amx-scrub-end">Live</span>
              <span className="amx-scrub-what">
                {looking
                  ? <>Showing <b>{clockOf(shown.at)}</b> · {agoOf(shown.at)} ago</>
                  : <span className="muted">Drag back to see the last {Math.max(1, Math.round((Date.now() - history[0].at) / 60000))} min</span>}
              </span>
              {looking && <button type="button" className="ghost" onClick={() => setBackAt(null)}>Back to live</button>}
            </div>
          )}
        </div>
        <div className="amx-watch-side">
          <h3>{section ? section.title : 'Their answers'}</h3>
          {!section && <p className="muted">Not in the workbook right now. “All their answers” shows everything.</p>}
          {sectionBlocks.map(b => (
            <div key={b.id} className="answers-block">
              <Block block={b} value={answers[b.id]?.value} onChange={() => {}} readOnly />
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ── The Screens grid: everyone's Amadeus at once ──────────────────────────
// Raised hands first (longest waiting first), then the class in its own order,
// then everyone not sharing. Only status changes move a square, so the grid
// doesn't reshuffle while you're reading it.
const WALL_SIZES = { S: 180, M: 260, L: 380 };
const WALL_STALE_MS = 30000;

export function AmadeusWall({ people, stateOf, onOpen, onAsk, size, onSize, full, onFull }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const [asked, setAsked] = useState({});

  // Esc leaves the full-window grid (the page's own Esc only acts while an
  // answers or watch pane is open, so the two never fight).
  useEffect(() => {
    if (!full) return undefined;
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); onFull(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full, onFull]);

  const live = people.filter(x => !x.dropped);
  const rank = x => (x.hand ? 0 : stateOf(x.id).status === 'off' ? 2 : 1);
  const ordered = live
    .map((x, i) => ({ x, i }))
    .sort((a, b) => rank(a.x) - rank(b.x)
      || (a.x.hand && b.x.hand ? a.x.hand.raised_at.localeCompare(b.x.hand.raised_at) : 0)
      || a.i - b.i)
    .map(({ x }) => x);
  const sharing = live.filter(x => stateOf(x.id).status !== 'off').length;

  const grid = (
    <ul className="amx-wall-grid" style={{ '--sq': `${WALL_SIZES[size] || WALL_SIZES.M}px` }} aria-label="Everyone's Amadeus">
      {ordered.map(x => {
        const st = stateOf(x.id);
        const stale = st.status === 'sharing' && st.thumbAt && Date.now() - st.thumbAt > WALL_STALE_MS;
        const age = st.thumbAt ? Math.max(0, Math.round((Date.now() - st.thumbAt) / 1000)) : null;
        const where = x.hand
          ? `Asked for help · ${x.hand.section_title || ''}`.replace(/ · $/, '')
          : st.status === 'paused' ? 'Paused'
            : st.status === 'off' ? x.presence.label.replace(/^last · /, '')
              : `${x.presence.label.replace(/^last · /, '')}${age != null ? ` · ${age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`}` : ''}`;
        return (
          <li key={x.id} className={`amx-sq${x.hand ? ' has-hand' : ''}${st.status === 'off' ? ' is-off' : ''}${st.status === 'paused' ? ' is-paused' : ''}${stale ? ' is-stale' : ''}`}>
            <div className="amx-sq-head">
              <b>{x.hand && '✋ '}{x.name}</b>
              <span>{where}</span>
            </div>
            {st.status === 'off' ? (
              <div className="amx-sq-img is-empty">
                <span>Not sharing</span>
                <button type="button" className="ghost" disabled={asked[x.id]}
                  onClick={() => { onAsk(x.id); setAsked(a => ({ ...a, [x.id]: true })); }}>
                  {asked[x.id] ? 'Asked ✓' : 'Ask to share'}
                </button>
              </div>
            ) : (
              <button type="button" className="amx-sq-img" onClick={() => onOpen(x.id)} data-tip={`Watch ${x.name}'s Amadeus`}>
                {st.thumb ? <img src={st.thumb} alt={`${x.name}'s Amadeus`} /> : <span>Picture on its way…</span>}
                {st.status === 'paused' && <span className="amx-thumb-flag">Paused</span>}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );

  const bar = (
    <div className="amx-wall-bar">
      {/* Above the class the Room controls already count; full window hides them. */}
      {full && <span className="amx-room-count">🖥 Sharing <b>{sharing}</b> of {live.length}</span>}
      <span className="amx-wall-sizes" role="group" aria-label="Square size">
        {Object.keys(WALL_SIZES).map(k => (
          <button key={k} type="button" aria-pressed={size === k} onClick={() => onSize(k)}>{k}</button>
        ))}
      </span>
      <button type="button" className="ghost amx-wall-full-btn" onClick={() => onFull(!full)}
        data-tip={full ? 'Back to the cockpit (Esc)' : 'Fill the window with the screens'}>
        {full ? '✕ Exit full window' : '⛶ Full window'}
      </button>
    </div>
  );

  if (full) {
    return (
      <div className="amx-wall-full" role="dialog" aria-label="Everyone's Amadeus">
        <div className="amx-wall-full-head"><h2>Screens</h2>{bar}</div>
        {grid}
      </div>
    );
  }
  return <div className="amx-wall">{bar}{grid}</div>;
}
