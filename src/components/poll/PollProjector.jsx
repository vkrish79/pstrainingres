import QuizShape from '../quiz/QuizShape.jsx';
import { usePollCounts } from '../../hooks/usePollCounts.js';
import '../../styles/poll-live.css';

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
export default function PollProjector({ run, onCloseVoting, onDismiss, onExit, busy }) {
  // Once voting shuts the numbers cannot move, and a closed poll sits on the
  // wall for as long as the discussion takes — so stop asking.
  const { rows, voted, people, most } = usePollCounts(run?.run_id, { live: run?.is_open });

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

        <div className="plive-bars">
          {rows.map((r) => (
            <div className="plive-bar-row" key={r.option_index}>
              <span className={`plive-badge plive-opt-${r.option_index}`}>
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
              <span className="plive-n">{r.votes}</span>
            </div>
          ))}
        </div>

        <div className="plive-foot">
          {/* CASE 11: nobody has voted yet is a normal state, not an error. */}
          <span className="plive-tally">
            {voted} of {people} voted
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
