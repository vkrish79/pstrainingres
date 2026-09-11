import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useQuizRun } from '../../hooks/useQuizRun.js';
import { createQuizMusic, QUIZ_MUSIC_THEMES } from '../../lib/quizMusic.js';
import QuizShape from './QuizShape.jsx';
import QuizJoinCode from './QuizJoinCode.jsx';
import QuizImage from './QuizImage.jsx';
import QuizFlame from './QuizFlame.jsx';
import QuizMedal from './QuizMedal.jsx';
import { ordinal } from '../../lib/ordinal.js';
import '../../styles/quiz-live.css';

// How long the drum roll runs between the trainer asking for a place and that
// place arriving. Third, second, first — the order an award ceremony uses,
// because the winner landing last is the only arrangement with any suspense
// in it.
//
// The podium used to run itself on a timer. It does not any more: a
// ceremony is paced by the person running the room, who can see whether
// everyone is looking at the screen yet, and a wall that reveals the winner
// while the trainer is still talking has taken the moment away from them.
const PODIUM_ROLL_MS = 1400;

// The screen on the wall. It carries the question and the four answers — the
// handsets show only shapes — and it never shows anything a participant should
// not already be seeing: the answer arrives at the reveal, at the same moment
// for everyone.
export default function QuizProjector({ runId, joinCode, onExit }) {
  const { run, secondsLeft, reload } = useQuizRun(runId);
  const [counts, setCounts] = useState(null);
  const [reveal, setReveal] = useState([]);
  const [board, setBoard] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [podiumStep, setPodiumStep] = useState(0);
  const [rolling, setRolling] = useState(false);
  const rollTimer = useRef(null);

  const music = useMemo(() => createQuizMusic(), []);
  const [muted, setMuted] = useState(() => music.muted);
  const [themeKey, setThemeKey] = useState(() => music.theme);
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
      // The podium is NOT a cue fired here. It is a roll and three landings
      // timed against the plinths, and it lives in the staging effect below
      // so the two cannot drift apart.
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
    // timeUp(), not sting('timeup'): the bed has to be let down as part of
    // the same gesture. Left to the phase change that follows, it is cut off
    // in a quarter of a second and the music appears to be yanked off the air.
    else if (phase === 'question') { music.timeUp(); setPhase('reveal'); }
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

  // Nothing is revealed on arriving at the podium — an empty stage, waiting
  // for the trainer. Leaving it also clears any roll still counting down, or
  // a plinth lands on a screen that has moved on.
  useEffect(() => {
    if (phase === 'podium') return undefined;
    setPodiumStep(0);
    setRolling(false);
    return undefined;
  }, [phase]);

  useEffect(() => () => { if (rollTimer.current) clearTimeout(rollTimer.current); }, []);

  const answered = counts?.answered ?? 0;
  const players = counts?.players ?? 0;
  const totalVotes = reveal.reduce((n, o) => n + (o.votes || 0), 0);
  const isLast = idx >= total - 1;
  const top3 = [board[0], board[1], board[2]];

  // The next place still to be revealed, SKIPPING any nobody is standing in.
  // With two players there is no third place, and a drum roll into a cymbal
  // crash over an empty step is a joke at the room's expense.
  function nextReveal() {
    let step = podiumStep + 1;
    while (step <= 3 && !top3[(4 - step) - 1]) step += 1;
    return step <= 3 ? { step, place: 4 - step } : null;
  }

  // Roll first, then the place lands on it. The click is the cue to the room
  // that something is coming; the roll is the second in which they look up.
  function revealNext() {
    const next = nextReveal();
    if (!next || rolling) return;
    music.unlock();
    setRolling(true);
    music.podiumRoll(PODIUM_ROLL_MS / 1000);
    rollTimer.current = setTimeout(() => {
      setPodiumStep(next.step);
      music.podiumLand(next.place);
      setRolling(false);
    }, PODIUM_ROLL_MS);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    music.setMuted(next);
  }

  // Restart whatever is currently playing so the new style is heard at once.
  // Picking music from a written description is guesswork; picking it by ear
  // during a real question is not.
  function restartCurrent() {
    if (phase === 'question') {
      const limit = run?.phase_ends_at && run?.phase_started_at
        ? (new Date(run.phase_ends_at) - new Date(run.phase_started_at)) / 1000
        : 20;
      music.startQuestion(limit, () => secondsRef.current);
    } else if (phase === 'ready') {
      music.startPreroll(() => secondsRef.current);
    }
  }

  function pickTheme(key) {
    setThemeKey(key);
    music.unlock();
    music.setTheme(key, restartCurrent);
    // Off the clock there is no loop to restart, so play the reveal cue as a
    // sample — otherwise choosing a style in the lobby is silent guesswork.
    if (phase !== 'question' && phase !== 'ready') music.sting('reveal');
  }

  return (
    <div className="qlive qlive-projector">
      <header className="qlive-bar">
        <span className="qlive-step">
          {idx >= 0 ? `Question ${idx + 1} of ${total}` : `${total} question${total === 1 ? '' : 's'}`}
        </span>
        <div className="qlive-bar-tools">
          {err && <span className="qlive-err">{err}</span>}
          <label className="qlive-music-pick">
            <span className="qlive-vis-hidden">Music style</span>
            <select
              className="ghost"
              value={themeKey}
              disabled={muted}
              onChange={e => pickTheme(e.target.value)}
              title={muted ? 'Turn the music on to change the style' : 'Change the music style'}
            >
              {QUIZ_MUSIC_THEMES.map(t => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </label>
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
            Their screens show four shapes — the question and the answers are here,
            on this screen. Anyone not signed in yet can scan to join.
          </p>
          <QuizJoinCode joinCode={joinCode} />
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
          {/* Between the prompt and the answers, which is where the layout
              always left room — see the v2 note in live-quiz-plan.html. The
              picture takes the slack in the middle of the column and the
              options keep their place at the bottom of the screen. */}
          <QuizImage path={run?.image_path} className="qlive-figure" />
          {run?.kind === 'order' && (
            <p className="qlive-instruction">Tap the shapes in the right order</p>
          )}
          <ul className={`qlive-opts${run?.kind === 'order' ? ' qlive-opts-list' : ''}`}>
            {(run?.options ?? []).map((o, i) => (
              <li key={o.id} className={`qlive-opt qlive-opt-${i}`}>
                <span className="qlive-badge"><QuizShape index={i} /></span>
                <span className="qlive-label">{o.label}</span>
              </li>
            ))}
          </ul>
          {/* How full the room is, as a bar rather than only a number: a
              trainer glancing up needs to know whether to wait or to talk,
              and "11 of 16" makes them do arithmetic to find out.

              NOT green while it fills. Green is the reveal's colour for a
              right answer, and a green bar climbing during the question
              would read as the room getting it right. It turns green only
              when the bar is full, where it means everyone is in and
              nothing about who was correct. */}
          <div className="qlive-answered">
            <div className="qlive-answered-track">
              <div
                className={`qlive-answered-fill${players > 0 && answered >= players ? ' is-full' : ''}`}
                style={{ width: players ? `${(answered / players) * 100}%` : '0%' }}
              />
            </div>
            <p className="qlive-tally">
              {players > 0 && answered >= players
                ? "Everyone's in"
                : `${answered} of ${players} answered`}
            </p>
          </div>
          <button type="button" className="ghost qlive-skip" disabled={busy} onClick={() => setPhase('reveal')}>
            Close it now
          </button>
        </div>
      )}

      {phase === 'reveal' && (
        <div className="qlive-stage">
          <h1 className="qlive-prompt">{run?.prompt}</h1>
          {/* Still here at the reveal, but small. "The answer was the blue
              one" means nothing to a room that can no longer see what it was
              a question about — and the distribution bars are what the eye
              needs most, so the picture gives way to them. */}
          <QuizImage path={run?.image_path} className="qlive-figure qlive-figure-sm" />
          {run?.kind === 'order' ? (
            <>
              <p className="qlive-instruction">The right order was</p>
              <ol className="qlive-opts qlive-opts-list qlive-opts-answer">
                {reveal.slice().sort((a, b) => (a.correct_rank ?? 0) - (b.correct_rank ?? 0)).map(o => (
                  <li key={o.option_id} className={`qlive-opt qlive-opt-${o.order_index} is-right`}>
                    <span className="qlive-seq-num">{(o.correct_rank ?? 0) + 1}</span>
                    <span className="qlive-badge"><QuizShape index={o.order_index} /></span>
                    <span className="qlive-label">{o.label}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
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
          )}
          <button type="button" className="qlive-go" disabled={busy} onClick={() => setPhase('leaderboard')}>
            Show the leaderboard
          </button>
        </div>
      )}

      {phase === 'leaderboard' && (
        <div className="qlive-stage qlive-stage-board">
          {/* No heading. A board of names, places and points beside a "next
              question" button is not something a room needs labelling, and
              the word was taking the top of the screen to say so. */}
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
                  <span className={`qlive-place${r.place <= 3 ? ` p${r.place}` : ''}`}>{r.place}</span>
                  <span
                    className={`qlive-move ${moved > 0 ? 'up' : moved < 0 ? 'down' : 'flat'}`}
                    aria-label={moved > 0 ? `Up ${moved}` : moved < 0 ? `Down ${-moved}` : 'No change'}
                  >
                    {/* Nothing at all when nobody moved. The dash that used to
                        sit here was a mark the eye had to stop on to discover
                        it meant no news. */}
                    {moved > 0 ? `▲ ${moved}` : moved < 0 ? `▼ ${-moved}` : ''}
                  </span>
                  <span className="qlive-name">{r.full_name}</span>
                  {/* A streak of one is just a correct answer. Two is a run. */}
                  {r.streak >= 2 && <QuizFlame streak={r.streak} />}
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
              if (!r) return <li key={`empty-${place}`} className="qlive-podium-slot empty" />;
              return (
                <li
                  key={r.participant_id}
                  className={`qlive-podium-slot${podiumStep >= arrivesAt ? ' is-in' : ''}`}
                >
                  {/* Name and SCORE stand above the step, not inside it. The
                      score is the achievement, so it is the biggest thing on
                      the screen — it used to be the smallest, tucked under the
                      name at the bottom of the block. */}
                  <span className="qlive-podium-name">{r.full_name}</span>
                  <span className="qlive-podium-score">{r.points}</span>
                  <span className={`qlive-plinth p${place}`}>
                    <QuizMedal place={place} />
                  </span>
                </li>
              );
            })}
          </ol>
          {nextReveal() ? (
            <button
              type="button"
              className="qlive-go"
              disabled={rolling}
              onClick={revealNext}
            >
              {rolling ? 'Drum roll…' : `Reveal ${ordinal(nextReveal().place)} place`}
            </button>
          ) : (
            <button type="button" className="ghost" disabled={busy} onClick={() => setPhase('ended')}>
              End the quiz
            </button>
          )}
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
