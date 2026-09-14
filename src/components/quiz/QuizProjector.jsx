import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useQuizRun } from '../../hooks/useQuizRun.js';
import { createQuizMusic, QUIZ_MUSIC_THEMES } from '../../lib/quizMusic.js';
import QuizShape from './QuizShape.jsx';
import QuizJoinCode from './QuizJoinCode.jsx';
import QuizImage from './QuizImage.jsx';
import QuizPinField from './QuizPinField.jsx';
import { signedQuizAudioUrl } from '../../lib/quizAudio.js';
import { useQuizGuests } from '../../hooks/useQuizGuests.js';
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
// `guestRun` marks a run with no session behind it: the lobby then shows the
// names arriving instead of a line about signing in, because for a standalone
// run the wall is the only place anybody can see that they are in.
export default function QuizProjector({ runId, joinCode, onExit, guestRun = false }) {
  const { run, secondsLeft, reload } = useQuizRun(runId);
  // Only polled while the door is open — after Start the roster is fixed and
  // the list is a thing nobody is looking at.
  const { guests, remove: removeGuest } = useQuizGuests(runId, guestRun && run?.phase === 'lobby');
  const [counts, setCounts] = useState(null);
  const [reveal, setReveal] = useState([]);
  const [board, setBoard] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [podiumStep, setPodiumStep] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [closing, setClosing] = useState(false);
  const rollTimer = useRef(null);
  // The sound clip, if this question has one: its signed URL, and where the
  // playing of it has got to.
  const audioRef = useRef(null);
  const [clipUrl, setClipUrl] = useState(null);
  const [clipState, setClipState] = useState('idle');   // idle | playing | failed
  // Everyone's pins, and the target, once the window has closed.
  const [pins, setPins] = useState([]);

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
    // Reports whether it landed, so a caller that must not continue on failure
    // can tell. endForEveryone is that caller: exiting after a refused "ended"
    // would put the projector away and leave the room stuck, which is the bug.
    if (error) { setErr(error.message); return false; }
    await reload();
    return true;
  }, [runId, reload, music]);

  // Ending the run is what releases the handsets: quiz_set_phase('ended')
  // stamps ended_at, useActiveQuizRun stops reporting it, and the participant
  // finally gets the screen with a way back to their workbook on it.
  //
  // Exit only AFTER the phase change lands. Closing the projector first would
  // unmount this component mid-request and leave the run open — the very bug
  // this is fixing, with an extra step.
  const endForEveryone = useCallback(async () => {
    const landed = await setPhase('ended');
    if (!landed) return;          // the error is on screen; the room is still in it
    setClosing(false);
    onExit?.();
  }, [setPhase, onExit]);

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
  //
  // The pre-roll now has two places to land. A question carrying a clip goes
  // to 'listen', where there is no clock at all until the room has heard it;
  // everything else goes straight to the question as it always did. has_audio
  // is the one thing quiz_current will say about a question during 'ready' —
  // deliberately a flag and not the clip, because content delivered early can
  // be displayed early.
  useEffect(() => {
    if (secondsLeft === null || secondsLeft > 0 || busy) return;
    if (phase === 'ready') setPhase(run?.has_audio ? 'listen' : 'question', idx);
    // timeUp(), not sting('timeup'): the bed has to be let down as part of
    // the same gesture. Left to the phase change that follows, it is cut off
    // in a quarter of a second and the music appears to be yanked off the air.
    else if (phase === 'question') { music.timeUp(); setPhase('reveal'); }
  }, [phase, secondsLeft, busy, idx, setPhase, music, run?.has_audio]);

  // ── the sound clip ───────────────────────────────────────────────────
  // Signed when the listen phase opens, not before: the URL lives two hours
  // and a question nine places away may never be reached at all.
  useEffect(() => {
    if (phase !== 'listen' || !run?.audio_path) { setClipUrl(null); setClipState('idle'); return undefined; }
    let alive = true;
    setClipState('idle');
    signedQuizAudioUrl(run.audio_path)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error || !data) setClipState('failed');
        else setClipUrl(data);
      })
      .catch(() => { if (alive) setClipState('failed'); });
    return () => { alive = false; };
  }, [phase, run?.audio_path]);

  // Leaving the phase stops the clip dead. Without this a trainer who starts
  // the clock early is talking over their own audio, with no control on screen
  // to stop it — the element is gone and the sound is not.
  useEffect(() => {
    if (phase === 'listen') return undefined;
    const el = audioRef.current;
    if (el) { try { el.pause(); } catch { /* already gone */ } }
    return undefined;
  }, [phase]);

  // Where the room dropped their pins, once the window has closed. One call
  // rather than target-then-pins, so a circle can never appear with nothing in
  // it while the second request is still out.
  useEffect(() => {
    if (!['reveal', 'leaderboard', 'podium', 'ended'].includes(phase) || run?.kind !== 'pin') {
      setPins([]);
      return;
    }
    supabase.rpc('quiz_pin_reveal', { p_run_id: runId }).then(({ data }) => setPins(data || []));
  }, [phase, runId, idx, run?.kind]);

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
  const pinTarget = pins.find(p => p.is_target) || null;
  const droppedPins = pins.filter(p => !p.is_target);

  // The clip. NOT silenced by the music toggle: that switch is for the bed
  // under a question, and a trainer who turned the backing track off has not
  // asked for the question itself to be inaudible.
  async function playClip() {
    const el = audioRef.current;
    if (!el) return;
    music.unlock();      // the same click that unlocks audio at all
    try {
      setClipState('playing');
      await el.play();
    } catch {
      // Autoplay refusal, a codec the browser will not take, a dead network.
      // Whatever it is, the room must not be left looking at a silent screen
      // with nothing to press.
      setClipState('failed');
    }
  }

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
          {/* CLOSE USED TO LIE. It called onExit, which puts this screen away
              on the trainer's laptop and does nothing else — so the run stayed
              open and sixteen handsets stayed in the quiz with no way out,
              because their "Back to my workbook" button only appears once the
              run has ENDED. A trainer who abandoned a quiz left the room
              stranded and had no way of knowing.

              So Close now asks, and "End the quiz" is the answer that matches
              what pressing Close looks like it means. Hiding is still offered,
              because stepping off the projector to look something up and coming
              back is a real thing — but it now says out loud that the room is
              still in the quiz. */}
          {phase === 'ended' ? (
            <button type="button" className="ghost" onClick={onExit}>Close</button>
          ) : closing ? (
            <>
              <span className="qlive-confirm">End the quiz for everyone?</span>
              <button type="button" onClick={endForEveryone} disabled={busy}>End the quiz</button>
              <button type="button" className="ghost" onClick={onExit}>
                Just hide this — the room stays in the quiz
              </button>
              <button type="button" className="ghost" onClick={() => setClosing(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className="ghost" onClick={() => setClosing(true)}>Close</button>
          )}
        </div>
      </header>

      {phase === 'lobby' && !guestRun && (
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

      {/* THE STANDALONE LOBBY. The code on the left, the room filling up on the
          right — and the names are the whole point of it: somebody types one on
          a phone and watches the wall until it appears, which is the only
          confirmation they are going to get that they are in. */}
      {phase === 'lobby' && guestRun && (
        <div className="qlive-stage qlive-lobby">
          <div className="qlive-lobby-join">
            <QuizJoinCode joinCode={joinCode} guestRun />
          </div>
          <div className="qlive-lobby-room">
            <div className="qlive-lobby-head">
              <h1 className="qlive-big">Who's in</h1>
              <span className="qlive-lobby-count">
                {guests.length === 0 ? '' : `${guests.length} joined`}
              </span>
            </div>
            {/* An empty space here reads as broken. It has to say which kind of
                nothing this is. */}
            {guests.length === 0 ? (
              <p className="qlive-sub">Waiting for the first person…</p>
            ) : (
              <ul className="qlive-guests">
                {guests.map((g, i) => (
                  <li
                    key={g.id}
                    /* The newest name is lit for a moment, so a room watching the
                       wall sees their own arrive rather than hunting a grid. */
                    className={`qlive-guest${i === guests.length - 1 ? ' is-fresh' : ''}`}
                  >
                    <span className="qlive-guest-text">{g.display_name}</span>
                    {/* Somebody will type something they should not, in front of
                        everybody. One click is the whole remedy. */}
                    <button
                      type="button"
                      className="qlive-guest-x"
                      title={`Remove ${g.display_name}`}
                      aria-label={`Remove ${g.display_name}`}
                      onClick={() => removeGuest(g.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="qlive-lobby-go">
              <button
                type="button"
                className="qlive-go"
                disabled={busy || guests.length === 0}
                onClick={() => setPhase('ready', 0)}
              >
                Start the quiz
              </button>
              <span className="qlive-lobby-note">
                {guests.length === 0
                  ? 'Nobody has joined yet.'
                  : 'Nobody can join once it starts.'}
              </span>
            </div>
          </div>
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

      {/* LISTEN. The question is on the wall and the clock has not started.
          Nobody can answer during this phase — quiz_answer refuses anything
          that is not 'question' — which is exactly why the prompt is allowed
          to be up here, where the room can read it while the clip plays. */}
      {phase === 'listen' && (
        <div className="qlive-stage">
          <div className="qlive-qhead">
            <h1 className="qlive-prompt">{run?.prompt}</h1>
            <div className="qlive-listen-badge" aria-hidden="true">♪</div>
          </div>
          <QuizImage path={run?.image_path} className="qlive-figure" />

          <div className="qlive-listen">
            {/* The element is mounted, muted-by-nothing and never given
                `autoplay`: a browser will not start audio the user did not
                ask for, and a Play button that the room can see being pressed
                is better theatre than an autoplay that might not fire. */}
            {clipUrl && (
              <audio
                ref={audioRef}
                src={clipUrl}
                preload="auto"
                // THE CLOCK STARTS HERE. The browser says the clip finished;
                // the database decides what that means in seconds, because a
                // deadline computed in this laptop is ~32 seconds wrong.
                onEnded={() => setPhase('question', idx)}
                onError={() => setClipState('failed')}
              />
            )}

            {clipState === 'failed' ? (
              <p className="qlive-err qlive-listen-err">
                That clip would not play. Start the clock and ask the question without it.
              </p>
            ) : clipState === 'playing' ? (
              <p className="qlive-sub">Playing — the clock starts when it ends</p>
            ) : (
              <p className="qlive-sub">Listen first. Nobody can answer until the clip has finished.</p>
            )}

            {clipState !== 'playing' && clipState !== 'failed' && (
              <button type="button" className="qlive-go" disabled={!clipUrl || busy} onClick={playClip}>
                ▶ Play the clip
              </button>
            )}

            {/* ALWAYS AVAILABLE. `ended` is not a promise — a blocked
                autoplay, a file that 404s, a codec nobody expected — and a
                room parked in front of a silent wall with no way forward is
                the worst thing this phase can do. It is also the ordinary way
                to cut a long clip short. */}
            <button type="button" className="ghost qlive-skip" disabled={busy} onClick={() => setPhase('question', idx)}>
              {clipState === 'playing' ? 'Stop it and start the clock' : 'Start the clock now'}
            </button>
          </div>
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
          {/* A pin question's picture is on the wall AND in every hand — the
              only type where that is true, because the answer is a place on
              it. No target is drawn: this is the same component the reveal
              uses, and what it draws is entirely what it is handed. */}
          {run?.kind === 'pin' && (
            <QuizPinField path={run?.map_path} className="qlive-pin" label="Where the room is dropping pins" />
          )}
          {run?.kind === 'order' && (
            <p className="qlive-instruction">Tap the shapes in the right order</p>
          )}
          {run?.kind === 'pin' && (
            <p className="qlive-instruction">Drop your pin on your own screen</p>
          )}
          {/* The room has to know the stakes are open BEFORE it answers, and
              the stake buttons are on the handsets where a trainer cannot see
              them. This is the only announcement there is. */}
          {run?.allow_wager && (
            <p className="qlive-instruction qlive-instruction-wager">
              Wager round — raise your stake on your handset. 1× risks nothing.
            </p>
          )}
          {/* Keyed off the option COUNT rather than the kind: what makes the
              wall look empty is two answers, whatever type produced them.
              A pin question has no options at all, so there is no list. */}
          {run?.kind !== 'pin' && (
            <ul className={`qlive-opts${run?.kind === 'order' ? ' qlive-opts-list' : ''}${(run?.options ?? []).length === 2 ? ' qlive-opts-two' : ''}`}>
              {(run?.options ?? []).map((o, i) => (
                <li key={o.id} className={`qlive-opt qlive-opt-${i}`}>
                  <span className="qlive-badge"><QuizShape index={i} /></span>
                  <span className="qlive-label">{o.label}</span>
                </li>
              ))}
            </ul>
          )}
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
          {run?.kind === 'pin' ? (
            <>
              {/* THE PICTURE OF THE QUESTION. Not a bar chart: where the room
                  thought it was is the discussion, and a circle with four
                  pins clustered two inches to the left of it says more than
                  any percentage. Anonymous on purpose — the leaderboard is
                  where names belong, and it only ever shows the top five. */}
              <QuizPinField
                path={run?.map_path}
                className="qlive-pin"
                label="The answer, and where the room dropped their pins"
                target={pinTarget ? { x: Number(pinTarget.x), y: Number(pinTarget.y), rx: Number(pinTarget.rx), ry: Number(pinTarget.ry) } : null}
                pins={droppedPins.map(p => ({ x: Number(p.x), y: Number(p.y), was_correct: p.was_correct }))}
              />
              <p className="qlive-instruction">
                {droppedPins.filter(p => p.was_correct).length} of {droppedPins.length} inside the circle
              </p>
            </>
          ) : run?.kind === 'order' ? (
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
          <ul className={`qlive-opts qlive-opts-reveal${reveal.length === 2 ? ' qlive-opts-two' : ''}`}>
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
                  {/* A lost wager is the most interesting thing that can
                      happen on this board, so it is shown, not filtered out
                      by a `> 0` test that predates scores being able to fall. */}
                  {r.gained !== 0 && (
                    <span className={`qlive-gain${r.gained < 0 ? ' is-loss' : ''}`}>
                      {r.gained > 0 ? `+${r.gained}` : String(r.gained).replace('-', '−')}
                    </span>
                  )}
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
          <p className="qlive-sub">
            {guestRun
              /* Not a promise about the future — a statement about what has
                 already happened by the time this screen is drawn. */
              ? 'Everyone has been signed out and the names and answers are deleted.'
              : 'Scores are not recorded anywhere — it was a knowledge check.'}
          </p>
          <button type="button" className="qlive-go" onClick={onExit}>Close</button>
        </div>
      )}
    </div>
  );
}
