import { useEffect, useRef, useState } from 'react';
import QuizShape from '../quiz/QuizShape.jsx';
import PollCount from './PollCount.jsx';
import { usePollCounts } from '../../hooks/usePollCounts.js';
import '../../styles/poll-live.css';

// Which answers gained a vote just now, so the shape can acknowledge it.
//
// A trainer running a poll is looking at the room, not at the wall. A bar
// quietly getting longer in their peripheral vision is easy to miss; a shape
// that flinches is not. It clears itself, so nothing is left highlighted.
function useJustGained(rows) {
  const [gained, setGained] = useState(() => new Set());
  const previous = useRef(new Map());

  useEffect(() => {
    const bumped = new Set();
    for (const r of rows) {
      const before = previous.current.get(r.option_index);
      if (before !== undefined && r.votes > before) bumped.add(r.option_index);
      previous.current.set(r.option_index, r.votes);
    }
    if (bumped.size === 0) return undefined;
    setGained(bumped);
    const t = setTimeout(() => setGained(new Set()), 700);
    return () => clearTimeout(t);
  }, [rows]);

  return gained;
}

// The room-facing screen. Question at the top, bars underneath, and the votes
// go up AS THEY LAND.
//
// That is the whole difference from a quiz question, where showing the answers
// arriving would give the answer away. A poll has nothing to be right about, so
// there is nothing to protect — and watching the bars move is most of what
// makes a poll worth doing in a room rather than on paper.
//
// The bar lengths are scaled to the BIGGEST answer, not to the number of people
// in the room. On a wall at the back of a room what the trainer wants visible
// is which way the room leaned; the exact figure is the number at the end of
// the bar, which is precise and does not need a ruler.
//
//
// THE BARS RE-ORDER AS VOTES LAND, leader first. This is only safe because the
// SHAPE travels with its bar: a participant is told "hit the triangle", and the
// triangle is still the triangle wherever it has moved to. If the handset ever
// loses its shapes, this has to go with them.
//
// Ties keep the order they were written in, which is what stops two equal bars
// swapping places on every redraw.
//
// One cost, accepted knowingly: the wall is the only place showing which shape
// means which answer, so anybody still reading while the early votes land is
// reading a moving target. It lands hardest on the slowest voter in the room.
function rankOf(rows) {
  const order = rows.map(r => r.option_index)
    .sort((a, b) => {
      const av = rows.find(r => r.option_index === a)?.votes ?? 0;
      const bv = rows.find(r => r.option_index === b)?.votes ?? 0;
      return bv - av || a - b;
    });
  return new Map(order.map((optionIndex, slot) => [optionIndex, slot]));
}

export default function PollProjector({ run, onCloseVoting, onDismiss, onExit, busy }) {
  // Once voting shuts the numbers cannot move, and a closed poll sits on the
  // wall for as long as the discussion takes — so stop asking.
  const { rows, voted, people, most } = usePollCounts(run?.run_id, { live: run?.is_open });
  const gained = useJustGained(rows);
  const rank = rankOf(rows);

  const width = (n) => {
    if (!n) return 0;
    // A single vote among many still has to be visible from the back.
    return Math.max(6, Math.round((n / Math.max(most, 1)) * 100));
  };

  return (
    <div className="plive plive-projector">
      <button type="button" className="plive-exit" onClick={onExit} title="Back to the session">
        ✕
      </button>

      <div className="plive-wall">
        <h1 className="plive-question">{run?.question}</h1>

        {/* Height is set here because every row is taken out of the flow and
            positioned by its rank — otherwise the container would collapse. */}
        <div className="plive-bars" style={{ height: `calc(${rows.length} * var(--plive-row))` }}>
          {rows.map((r) => (
            <div
              className="plive-bar-row"
              key={r.option_index}
              style={{ transform: `translateY(calc(${rank.get(r.option_index) ?? 0} * var(--plive-row)))` }}
            >
              <span
                className={`plive-badge plive-opt-${r.option_index}`
                  + (gained.has(r.option_index) ? ' has-gained' : '')}
              >
                <QuizShape index={r.option_index} title={r.label} />
              </span>
              {/* The label sits ON the track and the fill runs behind it. With
                  the label inside the fill, an answer nobody has voted for
                  shows no text at all — so the room cannot see what it is
                  choosing between until somebody has already chosen. */}
              <div className="plive-track">
                <div
                  className={`plive-fill plive-opt-${r.option_index}`}
                  style={{ width: `${width(r.votes)}%` }}
                  aria-hidden="true"
                />
                <span className="plive-label">{r.label}</span>
              </div>
              <span className="plive-n"><PollCount value={r.votes} /></span>
            </div>
          ))}
        </div>

        <div className="plive-foot">
          {/* CASE 11: nobody has voted yet is a normal state, not an error. */}
          <span className="plive-tally">
            <PollCount value={voted} /> of {people} voted
          </span>
          {run?.is_open ? (
            <button type="button" className="btn" onClick={onCloseVoting} disabled={busy}>
              Close voting
            </button>
          ) : (
            <>
              <span className="plive-shut">Voting closed</span>
              <button type="button" className="btn" onClick={onDismiss} disabled={busy}>
                Take it down
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
