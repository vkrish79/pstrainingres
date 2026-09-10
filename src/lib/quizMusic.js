// Live Quiz — the sound of the clock.
//
// SYNTHESISED, not files. Four styles would be four downloads and four
// licensing questions, for something that has to loop under an arbitrary timer
// anyway. Web Audio gives beds that follow the clock exactly and weigh nothing.
//
// PROJECTOR ONLY. Sixteen handsets playing the same loop a few hundred
// milliseconds apart is not sixteen times better, it is a mess — the room has
// one set of speakers and the trainer's machine drives them.
//
// Browsers refuse to start audio without a user gesture, which suits us: the
// trainer pressing "Start the quiz" IS that gesture, so the context is resumed
// there and never fights an autoplay policy.
//
// THE FIRST VERSION WAS INAUDIBLE. It ran correctly — the right number of
// oscillators, a running context — at ~0.09 peak in 140ms blips with silence
// between. Correct and unhearable is the same as broken, which is why the
// harness now measures the SIGNAL rather than counting calls.

const MUTE_KEY = 'quiz.music.muted';
const THEME_KEY = 'quiz.music.theme';

// Loud enough to carry a room over a projector's fan.
const MASTER = 0.55;
const ROOT = 196.0; // G3

// Each style keeps its own intervals below. They are all drawn from a minor
// pentatonic or its relatives — five notes that cannot form a bad interval
// against each other, so a repeating line stays listenable for a whole quiz
// without anyone having composed anything.

export const QUIZ_MUSIC_THEMES = [
  { key: 'tension', label: 'Game-show tension' },
  { key: 'arcade', label: 'Arcade' },
  { key: 'lounge', label: 'Lounge groove' },
  { key: 'pulse', label: 'Heartbeat' },
];

function readStore(key, fallback) {
  // Storage throws outright in some contexts (private windows, blocked site
  // data), so a plain read is not safe.
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writeStore(key, v) {
  try { localStorage.setItem(key, v); } catch { /* nothing to do */ }
}

export function createQuizMusic() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let drone = null;          // { oscs, gain } while a question is open
  let timer = null;
  let step = 0;
  let muted = readStore(MUTE_KEY, '0') === '1';
  let themeKey = QUIZ_MUSIC_THEMES.some(t => t.key === readStore(THEME_KEY, ''))
    ? readStore(THEME_KEY, '') : 'tension';

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;               // no Web Audio: the quiz still runs silent
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER;
    // A gentle limiter. Drone plus kick plus melody can stack past 1.0 on a
    // beat, and clipping through a room's speakers is a nasty crackle.
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    return ctx;
  }

  // ── primitives every theme is built from ───────────────────────────────

  // A pitched note with a real envelope. A bare oscillator switched on and off
  // clicks, and a click every beat for twenty seconds is torture.
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

  // A kick: a sine with the pitch falling away under it.
  function kick(when, level = 1, from = 140, to = 55, dur = 0.22) {
    const k = ctx.createOscillator();
    const g = ctx.createGain();
    k.type = 'sine';
    k.frequency.setValueAtTime(from, when);
    k.frequency.exponentialRampToValueAtTime(to, when + dur * 0.6);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.85 * level, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    k.connect(g); g.connect(master);
    k.start(when); k.stop(when + dur + 0.02);
  }

  // Filtered noise — a brush, a hat, a tick. Built once and reused: allocating
  // a second of random samples on every beat is wasteful and audible as jitter.
  function noise(when, dur, freq, level = 0.5, type = 'bandpass') {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = 1.2;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(when); s.stop(when + dur + 0.02);
  }

  // A held pad. Something must always be sounding, or the gaps between beats
  // read as silence — which is what made the first version impossible to hear.
  function startDrone({ freq = ROOT / 2, cutoff = 700, level = 0.16, type = 'sawtooth' } = {}) {
    stopDrone();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(level, ctx.currentTime + 0.4);
    f.connect(g); g.connect(master);
    const oscs = [0, -8].map(detune => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(f); o.start();
      return o;
    });
    drone = { oscs, gain: g, filter: f };
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

  // ── the four styles ────────────────────────────────────────────────────
  // Each one owns its beat, its pre-roll tick, its tempo curve and its stings.
  // They share the primitives above so a change to the envelope shape or the
  // limiter reaches all of them at once.

  const THEMES = {
    // A clock under a rising held note. Serious; the room goes quiet.
    tension: {
      drone: { freq: ROOT / 2, cutoff: 600, level: 0.15 },
      onStart() { /* the drone alone carries it */ },
      beat(t, { urgency, secondsLeft }) {
        // The tick IS the melody here — sharp, dry, unmistakably a clock.
        noise(t, 0.05, 2600, 0.5 + urgency * 0.4, 'highpass');
        kick(t, 0.55 + urgency * 0.35);
        // The drone climbs as the window closes, which is the tension.
        if (drone) {
          drone.oscs.forEach(o => o.detune.setTargetAtTime(urgency * 700, ctx.currentTime, 0.4));
          drone.filter.frequency.setTargetAtTime(600 + urgency * 900, ctx.currentTime, 0.4);
        }
        if (secondsLeft <= 5) noise(t + 0.12, 0.04, 3200, 0.45, 'highpass');
      },
      interval: (left, total) => (left <= 5 ? 300 : 620 - (1 - left / total) * 260),
      preroll: (t, n) => { noise(t, 0.06, 2400, 0.55, 'highpass'); note(ROOT * Math.pow(2, (n * 3) / 12), t, 0.18, 'sawtooth', 0.35); },
      sting: {
        reveal: t => { note(ROOT * 2, t, 0.3, 'sawtooth', 0.85); note(ROOT * Math.pow(2, 7 / 12) * 2, t + 0.14, 0.45, 'sawtooth', 0.85); },
        timeup: t => { note(ROOT / 2, t, 0.7, 'sawtooth', 0.9); note(ROOT / 2 * Math.pow(2, -1 / 12), t + 0.06, 0.7, 'sawtooth', 0.7); },
        podium: t => [0, 7, 12, 19].forEach((s, i) => note(ROOT * Math.pow(2, s / 12), t + i * 0.16, 0.8, 'sawtooth', 0.8)),
      },
    },

    // Bright 8-bit. Reads as a game rather than a test.
    arcade: {
      // A quiet square-wave pad after all. The first version had no drone and
      // notes SHORTER than the gaps between them, which measured at a third of
      // the others' energy and only 34% of the time sounding — switching to it
      // felt like the volume had dropped, and a chiptune loop should be a
      // continuous tune, not beeps with holes in.
      drone: { freq: ROOT / 2, cutoff: 1200, level: 0.09, type: 'square' },
      onStart() { step = 0; },
      beat(t, { urgency }) {
        // A bouncing bass under a square-wave riff — the two together are what
        // make it read as a tune rather than beeping. Both ring past the next
        // beat, so the line joins up instead of stuttering.
        const bassPat = [0, 0, 7, 5];
        const leadPat = [12, 15, 19, 15, 12, 10, 12, 7];
        note(ROOT / 2 * Math.pow(2, bassPat[step % bassPat.length] / 12), t, 0.26, 'square', 0.75);
        note(ROOT * Math.pow(2, leadPat[step % leadPat.length] / 12), t + 0.01, 0.24, 'square', 0.7 + urgency * 0.3);
        if (step % 2 === 1) noise(t, 0.04, 5000, 0.35, 'highpass');
      },
      interval: (left, total) => (left <= 5 ? 150 : 260 - (1 - left / total) * 90),
      preroll: (t, n) => [0, 4, 7].forEach((s, i) => note(ROOT * Math.pow(2, (s + n * 2) / 12), t + i * 0.05, 0.1, 'square', 0.6)),
      sting: {
        reveal: t => { note(ROOT * 2, t, 0.09, 'square', 0.9); note(ROOT * 3, t + 0.09, 0.22, 'square', 0.9); },
        timeup: t => [0, -2, -4].forEach((s, i) => note(ROOT * Math.pow(2, s / 12), t + i * 0.09, 0.16, 'square', 0.8)),
        podium: t => [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => note(ROOT * Math.pow(2, s / 12), t + i * 0.1, 0.3, 'square', 0.85)),
      },
    },

    // A walking bass and brushes. Present, but easy to talk over.
    lounge: {
      drone: { freq: ROOT / 2, cutoff: 420, level: 0.1, type: 'triangle' },
      onStart() { step = 0; },
      beat(t) {
        // A walking line rather than a repeated root — that is what makes it a
        // groove instead of a pulse.
        const walk = [0, 3, 5, 7, 5, 3];
        note(ROOT / 2 * Math.pow(2, walk[step % walk.length] / 12), t, 0.34, 'triangle', 0.6);
        // Brushed backbeat: soft, filtered, only on the off beats.
        if (step % 2 === 1) noise(t, 0.13, 1800, 0.22, 'bandpass');
        else noise(t, 0.07, 900, 0.12, 'bandpass');
      },
      // Deliberately steady. Rushing a lounge groove makes it sound broken
      // rather than urgent, so it lifts only slightly at the end.
      interval: (left, total) => (left <= 5 ? 380 : 460 - (1 - left / total) * 80),
      preroll: (t) => { note(ROOT / 2, t, 0.3, 'triangle', 0.5); noise(t, 0.1, 1500, 0.18, 'bandpass'); },
      sting: {
        reveal: t => [0, 4, 7, 11].forEach(s => note(ROOT * Math.pow(2, s / 12), t, 0.7, 'triangle', 0.45)),
        timeup: t => note(ROOT / 2, t, 0.8, 'triangle', 0.6),
        podium: t => [0, 4, 7, 11, 14].forEach((s, i) => note(ROOT * Math.pow(2, s / 12), t + i * 0.12, 1.0, 'triangle', 0.5)),
      },
    },

    // Rhythm only. Nothing to get tired of over ten questions.
    pulse: {
      drone: { freq: ROOT / 4, cutoff: 260, level: 0.13 },
      onStart() { step = 0; },
      beat(t, { urgency }) {
        // Two thumps, like a heartbeat, not one.
        kick(t, 0.9, 120, 45, 0.26);
        kick(t + 0.17, 0.5 + urgency * 0.3, 100, 40, 0.2);
      },
      // The acceleration IS the whole idea, so it is the widest range of the four.
      interval: (left, total) => (left <= 5 ? 260 : 900 - (1 - left / total) * 560),
      preroll: t => kick(t, 0.8, 130, 50, 0.28),
      sting: {
        reveal: t => { kick(t, 0.9, 160, 50, 0.3); note(ROOT, t + 0.05, 0.6, 'sine', 0.5); },
        timeup: t => kick(t, 1, 90, 35, 0.6),
        podium: t => [0, 1, 2, 3].forEach(i => kick(t + i * 0.22, 0.9 - i * 0.1, 150 - i * 20, 45, 0.3)),
      },
    },
  };

  const theme = () => THEMES[themeKey] ?? THEMES.tension;

  return {
    get muted() { return muted; },
    get theme() { return themeKey; },

    setMuted(v) {
      muted = !!v;
      writeStore(MUTE_KEY, muted ? '1' : '0');
      if (master && ctx) {
        // Ramped, not switched: an instant gain change is an audible pop
        // through a room's speakers.
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.05);
      }
    },

    // Changing style mid-question restarts the loop so the trainer hears the
    // choice immediately — auditioning by ear is the only way to pick one.
    setTheme(key, restart) {
      if (!THEMES[key]) return;
      themeKey = key;
      writeStore(THEME_KEY, key);
      if (timer && typeof restart === 'function') restart();
    },

    // Called on the trainer's click, which is the gesture that lets audio play
    // at all. Safe to call more than once.
    async unlock() {
      const c = ensure();
      if (c && c.state === 'suspended') { try { await c.resume(); } catch { /* denied */ } }
    },

    // The "get ready" countdown. Silence here was half the reason the music
    // seemed absent: the first thing after pressing Start was nothing at all.
    startPreroll(secondsLeftFn) {
      this.stop();
      if (!ensure()) return;
      let n = 0;
      const tick = () => {
        const left = secondsLeftFn();
        if (left === null || left <= 0) { this.stop(); return; }
        theme().preroll(ctx.currentTime + 0.02, n);
        n += 1;
        timer = setTimeout(tick, 700);
      };
      tick();
    },

    // Runs the bed for a question. secondsLeftFn is read each beat rather than
    // captured, so the tempo follows the real clock — including the server skew
    // correction — instead of a countdown started here.
    startQuestion(total, secondsLeftFn) {
      this.stop();
      if (!ensure()) return;
      const th = theme();
      step = 0;
      th.onStart();
      if (th.drone) startDrone(th.drone);
      const beat = () => {
        const left = secondsLeftFn();
        if (left === null || left <= 0) { this.stop(); return; }
        const urgency = total > 0 ? 1 - Math.max(0, Math.min(1, left / total)) : 0;
        th.beat(ctx.currentTime + 0.02, { urgency, secondsLeft: left, total });
        step += 1;
        timer = setTimeout(beat, Math.max(140, th.interval(left, total)));
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
      const fn = theme().sting[kind];
      if (fn) fn(ctx.currentTime + 0.02);
    },

    close() {
      this.stop();
      if (ctx) { try { ctx.close(); } catch { /* already closed */ } ctx = null; master = null; noiseBuf = null; }
    },
  };
}
