import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useQuizRun } from '../../hooks/useQuizRun.js';
import '../../styles/quiz-live.css';

const LETTERS = ['A', 'B', 'C', 'D'];

// The screen on the wall. Big enough to read from the back of a room, and it
// never shows anything a participant should not already be seeing — the answer
// arrives only at the reveal, at the same moment for everyone.
export default function QuizProjector({ runId, onExit }) {
  const { run, secondsLeft, reload } = useQuizRun(runId);
  const [counts, setCounts] = useState(null);
  const [reveal, setReveal] = useState([]);
  const [board, setBoard] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const phase = run?.phase;
  const idx = run?.current_index ?? -1;
  const total = run?.total_questions ?? 0;

  const setPhase = useCallback(async (p, index) => {
    setErr(''); setBusy(true);
    const args = { p_run_id: runId, p_phase: p };
    if (index !== undefined) args.p_index = index;
    const { error } = await supabase.rpc('quiz_set_phase', args);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await reload();
  }, [runId, reload]);

  // Live "11 of 16 answered" while a question is open.
  useEffect(() => {
    if (phase !== 'question') { setCounts(null); return undefined; }
    let stop = false;
    const tick = async () => {
      const { data } = await supabase.rpc('quiz_answer_counts', { p_run_id: runId });
      if (!stop) setCounts(Array.isArray(data) ? data[0] : data);
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => { stop = true; clearInterval(t); };
  }, [phase, runId, idx]);

  // The clock drives both transitions, not the trainer.
  //
  // 'ready' -> 'question' when the pre-roll runs out: the countdown on screen
  // is a promise that the question arrives when it hits zero, and there is no
  // button for it because there should not be one.
  //
  // 'question' -> 'reveal' when the window closes: leaving that to the trainer
  // means the room waits on someone who is watching the room, not the clock —
  // and answers are refused by the server the moment it expires anyway, so a
  // screen still showing the question would just be lying.
  //
  // Only the projector does this. Sixteen participants racing to advance the
  // phase would be sixteen writes; quiz_can_host refuses them all, but the
  // trainer's browser is the one that should be driving regardless.
  useEffect(() => {
    if (secondsLeft === null || secondsLeft > 0 || busy) return;
    if (phase === 'ready') setPhase('question', idx);
    else if (phase === 'question') setPhase('reveal');
  }, [phase, secondsLeft, busy, idx, setPhase]);

  useEffect(() => {
    if (!['reveal', 'leaderboard', 'podium', 'ended'].includes(phase)) { setReveal([]); return; }
    supabase.rpc('quiz_reveal', { p_run_id: runId }).then(({ data }) => setReveal(data || []));
  }, [phase, runId, idx]);

  useEffect(() => {
    if (!['leaderboard', 'podium', 'ended'].includes(phase)) { setBoard([]); return; }
    supabase.rpc('quiz_leaderboard', { p_run_id: runId }).then(({ data }) => setBoard(data || []));
  }, [phase, runId, idx]);

  const answered = counts?.answered ?? 0;
  const players = counts?.players ?? 0;
  const totalVotes = reveal.reduce((n, o) => n + (o.votes || 0), 0);
  const isLast = idx >= total - 1;

  return (
    <div className="qlive qlive-projector">
      <header className="qlive-bar">
        <span className="qlive-step">
          {idx >= 0 ? `Question ${idx + 1} of ${total}` : `${total} question${total === 1 ? '' : 's'}`}
        </span>
        <div className="qlive-bar-tools">
          {err && <span className="qlive-err">{err}</span>}
          <button type="button" className="ghost" onClick={onExit}>Close</button>
        </div>
      </header>

      {phase === 'lobby' && (
        <div className="qlive-stage qlive-centre">
          <h1 className="qlive-big">Ready when you are</h1>
          <p className="qlive-sub">
            Everyone in this session is already in. They will see the question on their
            own screen at the same moment it appears here.
          </p>
          <button type="button" className="qlive-go" disabled={busy} onClick={() => setPhase('ready', 0)}>
            Start the quiz
          </button>
        </div>
      )}

      {phase === 'ready' && (
        <div className="qlive-stage qlive-centre">
          <h1 className="qlive-count">{Math.ceil(secondsLeft ?? 0)}</h1>
          <p className="qlive-sub">Get ready — question {idx + 1} of {total}</p>
          {/* The question is deliberately NOT on screen yet, and has not been
              sent to anyone. Content delivered early can be displayed early. */}
        </div>
      )}

      {phase === 'question' && (
        <div className="qlive-stage">
          <div className="qlive-qhead">
            <h1 className="qlive-prompt">{run?.prompt}</h1>
            <div className="qlive-timer" aria-label="Seconds remaining">{Math.ceil(secondsLeft ?? 0)}</div>
          </div>
          <ul className="qlive-opts">
            {(run?.options ?? []).map((o, i) => (
              <li key={o.id} className={`qlive-opt qlive-opt-${i}`}>
                <span className="qlive-letter">{LETTERS[i]}</span>
                <span className="qlive-label">{o.label}</span>
              </li>
            ))}
          </ul>
          <p className="qlive-tally">{answered} of {players} answered</p>
          <button type="button" className="ghost qlive-skip" disabled={busy} onClick={() => setPhase('reveal')}>
            Close it now
          </button>
        </div>
      )}

      {phase === 'reveal' && (
        <div className="qlive-stage">
          <h1 className="qlive-prompt">{run?.prompt}</h1>
          <ul className="qlive-opts qlive-opts-reveal">
            {reveal.map((o, i) => (
              <li key={o.option_id} className={`qlive-opt qlive-opt-${i}${o.is_correct ? ' is-right' : ' is-wrong'}`}>
                <span className="qlive-letter">{LETTERS[i]}</span>
                <span className="qlive-label">{o.label}</span>
                <span className="qlive-votes">{o.votes}</span>
                {/* Share of the room, so a question everyone missed is obvious
                    at a glance — that is the one worth talking about. */}
                <span
                  className="qlive-bar-fill"
                  style={{ width: totalVotes ? `${(o.votes / totalVotes) * 100}%` : '0%' }}
                />
              </li>
            ))}
          </ul>
          <button type="button" className="qlive-go" disabled={busy} onClick={() => setPhase('leaderboard')}>
            Show the leaderboard
          </button>
        </div>
      )}

      {phase === 'leaderboard' && (
        <div className="qlive-stage">
          <h1 className="qlive-big">Leaderboard</h1>
          {/* Top five only. Real names are on a wall, and nobody should be
              publicly shown in last place. Everyone sees their own rank on
              their own screen. */}
          <ol className="qlive-board">
            {board.slice(0, 5).map(r => (
              <li key={r.participant_id}>
                <span className="qlive-place">{r.place}</span>
                <span className="qlive-name">{r.full_name}</span>
                <span className="qlive-pts">{r.points}</span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="qlive-go"
            disabled={busy}
            onClick={() => (isLast ? setPhase('podium') : setPhase('ready', idx + 1))}
          >
            {isLast ? 'Finish' : `Next question (${idx + 2} of ${total})`}
          </button>
        </div>
      )}

      {phase === 'podium' && (
        <div className="qlive-stage qlive-centre">
          <h1 className="qlive-big">Well done</h1>
          <ol className="qlive-podium">
            {/* Second, first, third — so the winner stands in the middle. */}
            {[board[1], board[0], board[2]].map((r, i) => r ? (
              <li key={r.participant_id} className={`qlive-plinth p${[2, 1, 3][i]}`}>
                <span className="qlive-medal">{[2, 1, 3][i]}</span>
                <span className="qlive-name">{r.full_name}</span>
                <span className="qlive-pts">{r.points}</span>
              </li>
            ) : <li key={`empty-${i}`} className="qlive-plinth empty" />)}
          </ol>
          <button type="button" className="ghost" disabled={busy} onClick={() => setPhase('ended')}>
            End the quiz
          </button>
        </div>
      )}

      {phase === 'ended' && (
        <div className="qlive-stage qlive-centre">
          <h1 className="qlive-big">That's the quiz</h1>
          <p className="qlive-sub">Scores are not recorded anywhere — it was a knowledge check.</p>
          <button type="button" className="qlive-go" onClick={onExit}>Close</button>
        </div>
      )}
    </div>
  );
}
