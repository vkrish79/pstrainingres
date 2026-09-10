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
//
// THE FIRST VERSION WAS INAUDIBLE. It ran correctly — a measured 20 oscillators
// per question — but at a master gain of 0.22 under note peaks of 0.4, in
// 140ms blips with nothing sustained underneath. Correct and unhearable is the
// same as broken. What fixes it is not only volume: there is now a held drone
// so something is always sounding, the notes ring properly, and the pre-roll
// ticks instead of sitting in silence.

const MUTE_KEY = 'quiz.music.muted';

// Loud enough to carry a room over a projector's fan. The mute button is
// right there, and a trainer will reach for the system volume before they
// reach for a rebuild.
const MASTER = 0.55;

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
  let drone = null;          // { oscs, gain } while a question is open
  let timer = null;
  let step = 0;
  let muted = readMuted();

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;               // no Web Audio: the quiz still runs silent
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER;
    // A gentle limiter. Drone plus arpeggio plus bass can stack past 1.0 on a
    // beat, and clipping through a room's speakers is a nasty crackle.
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    return ctx;
  }

  // One note. A real envelope: a bare oscillator switched on and off clicks,
  // and a click every beat for twenty seconds is torture.
  function note(freq, when, dur, type = 'triangle', level = 1) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.55 * level, when + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(master);
    o.start(when); o.stop(when + dur + 0.03);
  }

  // The held bed. Two slightly detuned oscillators through a lowpass, so there
  // is ALWAYS something sounding rather than silence between beats — which is
  // what made the first version impossible to notice.
  function startDrone() {
    stopDrone();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.4);
    f.connect(g); g.connect(master);
    const oscs = [0, 4].map((detune, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = ROOT / 2;
      o.detune.value = detune - (i * 8);
      o.connect(f); o.start();
      return o;
    });
    drone = { oscs, gain: g };
  }

  function stopDrone() {
    if (!drone || !ctx) return;
    const { oscs, gain } = drone;
    drone = null;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    oscs.forEach(o => { try { o.stop(t + 0.3); } catch { /* already stopped */ } });
  }

  // The beat. Tempo rises as the window closes — the last few seconds should
  // feel different from the first few, which is the whole job of the sound.
  function pulse(secondsLeft, total) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const urgency = total > 0 ? 1 - Math.max(0, Math.min(1, secondsLeft / total)) : 0;

    // A kick: a sine with the pitch dropping away under it.
    const k = ctx.createOscillator();
    const kg = ctx.createGain();
    k.type = 'sine';
    k.frequency.setValueAtTime(140, t);
    k.frequency.exponentialRampToValueAtTime(55, t + 0.13);
    kg.gain.setValueAtTime(0.0001, t);
    kg.gain.exponentialRampToValueAtTime(0.8, t + 0.01);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    k.connect(kg); kg.connect(master);
    k.start(t); k.stop(t + 0.25);

    // The tune over the top, an octave up once time is nearly gone.
    const octave = secondsLeft <= 5 ? 2 : 1;
    const semis = SCALE[step % SCALE.length];
    note(ROOT * octave * Math.pow(2, semis / 12), t + 0.03, 0.26, 'triangle', 0.55 + urgency * 0.45);
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
        master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.05);
      }
    },

    // Called on the trainer's click, which is the gesture that lets audio play
    // at all. Safe to call more than once.
    async unlock() {
      const c = ensure();
      if (c && c.state === 'suspended') { try { await c.resume(); } catch { /* denied */ } }
    },

    // The "get ready" countdown. One tick a second, climbing — silence here was
    // the other reason the music seemed absent: the first thing after pressing
    // Start was three seconds of nothing.
    startPreroll(secondsLeftFn) {
      this.stop();
      if (!ensure()) return;
      let n = 0;
      const tick = () => {
        const left = secondsLeftFn();
        if (left === null || left <= 0) { this.stop(); return; }
        note(ROOT * Math.pow(2, (7 + n * 2) / 12), ctx.currentTime + 0.02, 0.2, 'square', 0.7);
        n += 1;
        timer = setTimeout(tick, 700);
      };
      tick();
    },

    // Runs the bed for a question. secondsLeftFn is read each beat rather than
    // captured, so the tempo follows the real clock — including the server
    // skew correction — instead of a countdown started here.
    startQuestion(total, secondsLeftFn) {
      this.stop();
      if (!ensure()) return;
      step = 0;
      startDrone();
      const beat = () => {
        const left = secondsLeftFn();
        if (left === null || left <= 0) { this.stop(); return; }
        pulse(left, total);
        // 500ms down to 220ms as the clock runs out.
        const ms = left <= 5 ? 220 : 500 - (1 - left / total) * 220;
        timer = setTimeout(beat, Math.max(180, ms));
      };
      beat();
    },

    stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      stopDrone();
    },

    // Short cues. Deliberately not melodies: they punctuate, and anything
    // longer would still be playing when the trainer starts talking.
    sting(kind) {
      if (!ensure()) return;
      const t = ctx.currentTime + 0.02;
      if (kind === 'reveal') {
        [0, 7, 12].forEach((s, i) => note(ROOT * Math.pow(2, s / 12), t + i * 0.08, 0.32, 'triangle', 0.9));
      } else if (kind === 'podium') {
        [0, 4, 7, 12, 16, 19].forEach((s, i) => note(ROOT * Math.pow(2, s / 12), t + i * 0.14, 0.7, 'triangle', 0.95));
      } else if (kind === 'timeup') {
        note(ROOT / 2, t, 0.6, 'sawtooth', 0.9);
        note(ROOT / 2 * Math.pow(2, -1 / 12), t + 0.05, 0.6, 'sawtooth', 0.7);
      }
    },

    close() {
      this.stop();
      if (ctx) { try { ctx.close(); } catch { /* already closed */ } ctx = null; master = null; }
    },
  };
}
