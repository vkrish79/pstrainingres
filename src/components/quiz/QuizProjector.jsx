import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useQuizRun } from '../../hooks/useQuizRun.js';
import { createQuizMusic } from '../../lib/quizMusic.js';
import QuizShape from './QuizShape.jsx';
import '../../styles/quiz-live.css';

// How long each podium plinth waits before the next appears. Third, second,
// first — the order an award ceremony uses, because the winner landing last is
// the only arrangement with any suspense in it.
const PODIUM_STEP_MS = 1100;

// The screen on the wall. It carries the question and the four answers — the
// handsets show only shapes — and it never shows anything a participant should
// not already be seeing: the answer arrives at the reveal, at the same moment
// for everyone.
export default function QuizProjector({ runId, onExit }) {
  const { run, secondsLeft, reload } = useQuizRun(runId);
  const [counts, setCounts] = useState(null);
  const [reveal, setReveal] = useState([]);
  const [board, setBoard] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [podiumStep, setPodiumStep] = useState(0);

  const music = useMemo(() => createQuizMusic(), []);
  const [muted, setMuted] = useState(() => music.muted);
  // Read by the music loop on every beat, so the tempo follows the corrected
  // server clock rather than a countdown started when the question opened.
  const secondsRef = useRef(secondsLeft);
  secondsRef.current = secondsLeft;

  const phase = run?.phase;
  const idx = run?.current_index ?? -1;
  const total = run?.total_questions ?? 0;

  useEffect(() => () => music.close(), [music]);

  const setPhase = useCallback(async (p, index) => {
    setErr(''); setBusy(true);
    // Every phase change comes from a trainer's click, which is also the user
    // gesture browsers demand before any audio may play.
    music.unlock();
    const args = { p_run_id: runId, p_phase: p };
    if (index !== undefined) args.p_index = index;
    const { error } = await supabase.rpc('quiz_set_phase', args);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await reload();
  }, [runId, reload, music]);

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

  // The music follows the phase: a bed under the question, a sting at the
  // reveal, a flourish at the podium, silence everywhere else. Nothing plays
  // over a trainer who is talking.
  useEffect(() => {
    if (phase === 'question') {
      const limit = run?.phase_ends_at && run?.phase_started_at
        ? (new Date(run.phase_ends_at) - new Date(run.phase_started_at)) / 1000
        : 20;
      music.startQuestion(limit, () => secondsRef.current);
    } else if (phase === 'ready') {
      // The pre-roll used to be silent, so the first thing after pressing
      // Start was three seconds of nothing — half the reason the music seemed
      // not to be working at all.
      music.startPreroll(() => secondsRef.current);
    } else {
      music.stop();
      if (phase === 'reveal') music.sting('reveal');
      if (phase === 'podium') music.sting('podium');
    }
    return () => music.stop();
  }, [phase, idx, music, run?.phase_ends_at, run?.phase_started_at]);

  // The clock drives both transitions, not the trainer.
  //
  // 'ready' -> 'question' when the pre-roll runs out: the countdown on screen
  // is a promise that the question arrives when it hits zero, and there is no
  // button for it because there should not be one.
  //
  // 'question' -> 'reveal' when the window closes: leaving that to the trainer
  // means the room waits on someone who is watching the room, not the clock —
  // and the server refuses answers the moment it expires anyway, so a screen
  // still showing the question would just be lying.
  useEffect(() => {
    if (secondsLeft === null || secondsLeft > 0 || busy) return;
    if (phase === 'ready') setPhase('question', idx);
    else if (phase === 'question') { music.sting('timeup'); setPhase('reveal'); }
  }, [phase, secondsLeft, busy, idx, setPhase, music]);

  useEffect(() => {
    if (!['reveal', 'leaderboard', 'podium', 'ended'].includes(phase)) { setReveal([]); return; }
    supabase.rpc('quiz_reveal', { p_run_id: runId }).then(({ data }) => setReveal(data || []));
  }, [phase, runId, idx]);

  // quiz_standings, not quiz_leaderboard: the board between questions has to
  // show what CHANGED — who climbed, who is on a run — and a list of totals
  // says nothing a photograph of a scoreboard would not.
  useEffect(() => {
    if (!['leaderboard', 'podium', 'ended'].includes(phase)) { setBoard([]); return; }
    supabase.rpc('quiz_standings', { p_run_id: runId }).then(({ data }) => setBoard(data || []));
  }, [phase, runId, idx]);

  // Podium: 3rd, then 2nd, then 1st. Skipped when the viewer has asked for
  // reduced motion — they get the finished podium immediately rather than
  // nothing, because the content matters and only the staging is decoration.
  useEffect(() => {
    if (phase !== 'podium') { setPodiumStep(0); return undefined; }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduced) { setPodiumStep(3); return undefined; }
    setPodiumStep(0);
    const timers = [1, 2, 3].map(n => setTimeout(() => setPodiumStep(n), n * PODIUM_STEP_MS));
    return () => timers.forEach(clearTimeout);
  }, [phase]);

  const answered = counts?.answered ?? 0;
  const players = counts?.players ?? 0;
  const totalVotes = reveal.reduce((n, o) => n + (o.votes || 0), 0);
  const isLast = idx >= total - 1;
  const top3 = [board[0], board[1], board[2]];

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    music.setMuted(next);
  }

  return (
    <div className="qlive qlive-projector">
      <header className="qlive-bar">
        <span className="qlive-step">
          {idx >= 0 ? `Question ${idx + 1} of ${total}` : `${total} question${total === 1 ? '' : 's'}`}
        </span>
        <div className="qlive-bar-tools">
          {err && <span className="qlive-err">{err}</span>}
          <button
            type="button"
            className="ghost"
            onClick={toggleMute}
            aria-pressed={muted}
            title={muted ? 'Turn the music on' : 'Turn the music off'}
          >
            {muted ? 'Music off' : 'Music on'}
          </button>
          <button type="button" className="ghost" onClick={onExit}>Close</button>
        </div>
      </header>

      {phase === 'lobby' && (
        <div className="qlive-stage qlive-centre">
          <h1 className="qlive-big">Ready when you are</h1>
          <p className="qlive-sub">
            Everyone in this session is already in. Their screens show four shapes —
            the question and the answers are here, on this screen.
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
                <span className="qlive-badge"><QuizShape index={i} /></span>
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
                <span className="qlive-badge"><QuizShape index={i} /></span>
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
              publicly shown in last place. Everyone sees their own rank, and
              their own streak, on their own screen. */}
          <ol className="qlive-board">
            {board.slice(0, 5).map((r, i) => {
              // prev_place 0 means there was no previous question, so there is
              // no movement to claim — not "held first place".
              const moved = r.prev_place > 0 ? r.prev_place - r.place : 0;
              return (
                <li
                  key={r.participant_id}
                  className={`qlive-row${moved > 0 ? ' has-climbed' : ''}`}
                  // Staggered so the board fills in rather than appearing all
                  // at once — the eye can follow one row at a time.
                  style={{ animationDelay: `${i * 110}ms` }}
                >
                  <span className="qlive-place">{r.place}</span>
                  <span
                    className={`qlive-move ${moved > 0 ? 'up' : moved < 0 ? 'down' : 'flat'}`}
                    aria-label={moved > 0 ? `Up ${moved}` : moved < 0 ? `Down ${-moved}` : 'No change'}
                  >
                    {moved > 0 ? `▲ ${moved}` : moved < 0 ? `▼ ${-moved}` : '–'}
                  </span>
                  <span className="qlive-name">{r.full_name}</span>
                  {/* A streak of one is just a correct answer. Two is a run. */}
                  {r.streak >= 2 && (
                    <span className="qlive-streak" title={`${r.streak} correct in a row`}>
                      {r.streak} in a row
                    </span>
                  )}
                  {r.gained > 0 && <span className="qlive-gain">+{r.gained}</span>}
                  <span className="qlive-pts">{r.points}</span>
                </li>
              );
            })}
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
          {/* Laid out 2nd / 1st / 3rd so the winner ends in the middle and
              tallest, but REVEALED third, second, first — podiumStep counts how
              many have arrived, and each plinth knows which step is its own. */}
          <ol className="qlive-podium">
            {[1, 0, 2].map(rank => {
              const r = top3[rank];
              const place = rank + 1;
              const arrivesAt = 4 - place;   // 3rd on step 1, 2nd on 2, 1st on 3
              if (!r) return <li key={`empty-${place}`} className="qlive-plinth empty" />;
              return (
                <li
                  key={r.participant_id}
                  className={`qlive-plinth p${place}${podiumStep >= arrivesAt ? ' is-in' : ''}`}
                >
                  <span className="qlive-medal">{place}</span>
                  <span className="qlive-name">{r.full_name}</span>
                  <span className="qlive-pts">{r.points}</span>
                </li>
              );
            })}
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
