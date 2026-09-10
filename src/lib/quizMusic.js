// Live Quiz — the sound of the clock.
//
// SYNTHESISED, not a file. A backing track would mean shipping a binary asset
// and answering a licensing question for something that has to loop under an
// arbitrary timer anyway. Web Audio gives a bed that follows the clock exactly
// and weighs nothing.
//
// PROJECTOR ONLY. Sixteen handsets playing the same loop a few hundred
// milliseconds apart is not sixteen times better, it is a mess — the room has
// one set of speakers and the trainer's machine drives them.
//
// Browsers refuse to start audio without a user gesture, which suits us: the
// trainer pressing "Start the quiz" IS that gesture, so the context is
// resumed there and never fights an autoplay policy.

const MUTE_KEY = 'quiz.music.muted';

// A minor pentatonic — five notes that cannot form a bad interval against each
// other, so an arpeggio wandering over them stays listenable for a whole quiz
// without anyone having composed anything.
const SCALE = [0, 3, 5, 7, 10];
const ROOT = 196.0; // G3

function readMuted() {
  // Storage throws outright in some contexts (private windows, blocked site
  // data), so a plain read is not safe.
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}
function writeMuted(v) {
  try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch { /* nothing to do */ }
}

export function createQuizMusic() {
  let ctx = null;
  let master = null;
  let timer = null;
  let step = 0;
  let muted = readMuted();

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;               // no Web Audio: the quiz still runs silent
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.22;
    master.connect(ctx.destination);
    return ctx;
  }

  // One note. Short envelope with an actual attack and release — a bare
  // oscillator switched on and off clicks, and a click every beat for twenty
  // seconds is torture.
  function note(freq, when, dur, type = 'triangle', level = 1) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.4 * level, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(master);
    o.start(when); o.stop(when + dur + 0.02);
  }

  // The beat. Tempo rises as the window closes — the last few seconds should
  // feel different from the first few, which is the whole job of the sound.
  function pulse(secondsLeft, total) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const urgency = total > 0 ? 1 - Math.max(0, Math.min(1, secondsLeft / total)) : 0;
    const octave = secondsLeft <= 5 ? 2 : 1;

    // Bass on every beat, so there is a floor under the arpeggio.
    note(ROOT / 2, t, 0.16, 'sine', 0.9 + urgency * 0.4);

    const semis = SCALE[step % SCALE.length];
    note(ROOT * octave * Math.pow(2, semis / 12), t + 0.02, 0.14, 'triangle', 0.5 + urgency * 0.5);
    step += 1;
  }

  return {
    get muted() { return muted; },

    setMuted(v) {
      muted = !!v;
      writeMuted(muted);
      if (master && ctx) {
        // Ramped, not switched: an instant gain change is an audible pop
        // through a room's speakers.
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(muted ? 0 : 0.22, ctx.currentTime, 0.05);
      }
    },

    // Called on the trainer's click, which is the gesture that lets audio play
    // at all. Safe to call more than once.
    async unlock() {
      const c = ensure();
      if (c && c.state === 'suspended') { try { await c.resume(); } catch { /* denied */ } }
    },

    // Runs the bed for a question. secondsLeftFn is read each beat rather than
    // captured, so the tempo follows the real clock — including the server
    // skew correction — instead of a countdown started here.
    startQuestion(total, secondsLeftFn) {
      this.stop();
      if (!ensure()) return;
      step = 0;
      const beat = () => {
        const left = secondsLeftFn();
        if (left === null || left <= 0) { this.stop(); return; }
        pulse(left, total);
        // 460ms down to 200ms as the clock runs out.
        const ms = left <= 5 ? 200 : 460 - (1 - left / total) * 200;
        timer = setTimeout(beat, Math.max(160, ms));
      };
      beat();
    },

    stop() {
      if (timer) { clearTimeout(timer); timer = null; }
    },

    // Short cues. Deliberately not melodies: they punctuate, and anything
    // longer would still be playing when the trainer starts talking.
    sting(kind) {
      if (!ensure()) return;
      const t = ctx.currentTime + 0.02;
      if (kind === 'reveal') {
        [0, 7, 12].forEach((s, i) => note(ROOT * Math.pow(2, s / 12), t + i * 0.07, 0.22, 'triangle'));
      } else if (kind === 'podium') {
        [0, 4, 7, 12, 16].forEach((s, i) => note(ROOT * Math.pow(2, s / 12), t + i * 0.13, 0.5, 'triangle'));
      } else if (kind === 'timeup') {
        note(ROOT / 2, t, 0.5, 'sawtooth', 0.7);
      }
    },

    close() {
      this.stop();
      if (ctx) { try { ctx.close(); } catch { /* already closed */ } ctx = null; master = null; }
    },
  };
}
