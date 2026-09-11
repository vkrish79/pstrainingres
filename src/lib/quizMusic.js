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

// THE ONE EXCEPTION TO 'SYNTHESISED, NOT FILES', and worth stating why.
//
// That rule was written about the four looping BEDS: four downloads, four
// licensing questions, for music that has to stretch to fit an arbitrary
// timer. All of that still holds.
//
// A drum roll is none of those things. It is one fixed-length one-shot, and
// it is the one sound here that synthesis is genuinely bad at: a roll is
// forty snare strokes a second whose character comes from the room around a
// real drum, and every attempt at it came out as a rattle, a hiss, or a
// creaking door. Some things are recordings.
//
// The file is NOT shipped with the app — see public/sounds/README.txt. If it
// is absent the podium falls back to the synthesised roll, so a missing file
// is a worse podium and never a broken one.
const ROLL_URL = '/sounds/drumroll.mp3';

const MUTE_KEY = 'quiz.music.muted';
const THEME_KEY = 'quiz.music.theme';

// Loud enough to carry a room over a projector's fan.
const MASTER = 0.55;
const ROOT = 196.0; // G3

// Each style keeps its own intervals below. They are all drawn from a minor
// pentatonic or its relatives — five notes that cannot form a bad interval
// against each other, so a repeating line stays listenable for a whole quiz
// without anyone having composed anything.
const hz = (semi, oct = 0) => ROOT * Math.pow(2, semi / 12) * Math.pow(2, oct);

// FOUR STYLES, ALL REPLACED. The first set were chiptune and game-show — a
// handheld console and a 1980s studio audience — which is charming for about
// nine seconds and then tells a room of adults that this is not for them.
// These are built from the vocabulary of music people actually hear now:
// four-on-the-floor, sidechained pads, filtered stabs, sub and risers.
export const QUIZ_MUSIC_THEMES = [
  { key: 'drive', label: 'Neon drive' },
  { key: 'stadium', label: 'Stadium' },
  { key: 'cinematic', label: 'Cinematic' },
  { key: 'deep', label: 'Deep focus' },
];

const DEFAULT_THEME = 'drive';

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
  // null = not looked for yet, false = looked and there isn't one, else the
  // decoded sample. Three states, because 'not tried' and 'tried and absent'
  // must not both read as falsy at the point where we decide to retry.
  let rollBuf = null;
  let rollLoading = null;
  // Where the roll peaks, in seconds. Measured once, off the recording.
  let rollEnd = 0;
  let drone = null;          // { oscs, gain } while a question is open
  let timer = null;
  let step = 0;
  // When the clock last ran out, on the audio clock. Used to keep the reveal
  // cue from landing on top of the time-up hit.
  let lastTimeUp = -99;
  let muted = readStore(MUTE_KEY, '0') === '1';
  // A trainer who picked 'arcade' last month has a key that no longer names
  // anything; the check below already handles that and drops them on the
  // default rather than into silence.
  let themeKey = QUIZ_MUSIC_THEMES.some(t => t.key === readStore(THEME_KEY, ''))
    ? readStore(THEME_KEY, '') : DEFAULT_THEME;

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

  // WHERE THE ROLL ACTUALLY PEAKS.
  //
  // A recording is not a tidy second and a half of build. A twelve-second
  // drum roll is a long crescendo, a hit, and then a decay into silence — so
  // "play the last 1.4 seconds" plays the silence. That is not a subtle
  // failure: it is no sound at all, which is exactly what it did.
  //
  // So don't take the end of the file, take the LOUDEST MOMENT in it and end
  // the window there. That one rule is right for both shapes a roll comes in:
  // one that crescendos into a crash peaks AT the crash, so we play the build
  // and stop where its own cymbal would have been — leaving ours to land
  // instead — and one that simply builds peaks at its end, which is the same
  // window we wanted anyway.
  //
  // The alternative was a number for someone to guess by ear, one podium at a
  // time. The file already knows the answer.
  function peakTimeOf(buf) {
    const data = buf.getChannelData(0);
    const block = Math.max(1, Math.floor(buf.sampleRate * 0.02));   // 20ms
    let bestAt = 0;
    let bestSum = -1;
    for (let i = 0; i + block <= data.length; i += block) {
      let sum = 0;
      for (let j = i; j < i + block; j++) sum += data[j] * data[j];
      if (sum > bestSum) { bestSum = sum; bestAt = i; }
    }
    return bestAt / buf.sampleRate;
  }

  // Fetched and decoded once, off the trainer's first click — the same click
  // that unlocks audio. Decoding at the moment the podium appears would put a
  // network round trip between the last question and the drum roll.
  function loadRoll() {
    if (rollBuf !== null || !ctx) return rollLoading;
    if (rollLoading) return rollLoading;
    rollLoading = (async () => {
      try {
        const res = await fetch(ROLL_URL);
        if (!res.ok) { rollBuf = false; return; }
        rollBuf = await ctx.decodeAudioData(await res.arrayBuffer());
        rollEnd = peakTimeOf(rollBuf);
        // Said out loud, because if the roll is ever inaudible or lands in the
        // wrong place again, these two numbers are the entire diagnosis.
        // eslint-disable-next-line no-console
        console.info(`[quiz] drum roll: ${rollBuf.duration.toFixed(2)}s, peaks at ${rollEnd.toFixed(2)}s`);
      } catch {
        // Missing, unreadable, or not audio the browser knows. All the same
        // answer: there is no sample, use the synth.
        rollBuf = false;
      }
    })();
    return rollLoading;
  }

  // Plays the sample so that its PEAK lands exactly when the plinth does,
  // whatever length the recording happens to be: a long roll starts partway
  // in, a short one starts late. That is what makes this work without anyone having
  // to trim a file to 1.05 seconds — the swell always resolves on the beat.
  function playRoll(when, seconds, level = 0.9) {
    if (!rollBuf) return false;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = rollBuf;
    const usable = Math.max(seconds, rollEnd);
    const offset = Math.max(0, usable - seconds);
    const startAt = when + Math.max(0, seconds - usable);
    g.gain.value = level;
    src.connect(g); g.connect(master);
    src.start(startAt, offset);
    // Cut on the landing. A roll still running under the crash is a roll that
    // did not resolve.
    src.stop(when + seconds + 0.03);
    return true;
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
    // level is kept because duck() has to know what to swell BACK to — read
    // off the gain node it would read whatever the last duck left behind.
    drone = { oscs, gain: g, filter: f, level };
  }

  // THE CLOCK RUNNING OUT IS AN ENDING, NOT A STOP.
  //
  // stopDrone below is the right thing when the bed is genuinely being
  // abandoned — the trainer closes the question early, or leaves the screen —
  // and its quarter-second fade is meant to be quick enough not to drag.
  // Used at time-up it is what makes the music appear to be yanked off the
  // air mid-phrase.
  //
  // This lets it down instead: over a second, and CLOSING as it goes. A pad
  // that only loses volume sounds switched off; one that also loses its top
  // end sounds like it is walking away.
  function releaseDrone(seconds) {
    if (!drone || !ctx) return;
    const { oscs, gain, filter } = drone;
    // Detached FIRST. The phase change that follows a time-up calls stop(),
    // and without this that stop would find the drone still attached and cut
    // the tail off a quarter of a second in — the exact bug this replaces.
    drone = null;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    filter.frequency.cancelScheduledValues(t);
    filter.frequency.setValueAtTime(Math.max(filter.frequency.value, 60), t);
    filter.frequency.exponentialRampToValueAtTime(110, t + seconds * 0.9);
    oscs.forEach(o => { try { o.stop(t + seconds + 0.12); } catch { /* already stopped */ } });
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

  // ── the modern kit ─────────────────────────────────────────────────────
  // What separated this from sounding like a handheld console was never the
  // notes, it was the voices and the space around them: square waves, one
  // sound at a time, and a bed that sat still. Below: filtered saw stabs, real
  // claps and hats, a sub that moves air, and the sidechain pump that is the
  // single most recognisable thing about modern dance music.

  // SIDECHAIN. Every kick shoves the pad out of the way and lets it swell back
  // in. It is the reason a club record breathes, it costs one gain ramp, and
  // without it a kick and a pad played together are just two sounds at once.
  function duck(when, depth = 0.45, release = 0.3) {
    if (!drone) return;
    const g = drone.gain.gain;
    const base = Math.max(drone.level, 0.0001);
    g.cancelScheduledValues(when);
    g.setValueAtTime(Math.max(base * (1 - depth), 0.0001), when);
    g.exponentialRampToValueAtTime(base, when + release);
  }

  // Two bursts a hair apart, because one is a hiss and two is a clap — the
  // early reflection is what the ear hears as hands rather than noise.
  function clap(when, level = 0.5) {
    noise(when, 0.013, 1500, level * 0.55, 'bandpass');
    noise(when + 0.014, 0.12, 1900, level, 'bandpass');
  }

  function hat(when, level = 0.22, dur = 0.03) {
    noise(when, dur, 8200, level, 'highpass');
  }

  // A chord stab: detuned saws through a lowpass that slams shut. The closing
  // filter is the whole character — held open it is an organ, and swept it is
  // the sound every dance record has opened with for thirty years.
  function stab(when, freqs, dur = 0.22, level = 0.45, cutoff = 2400) {
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 7;
    f.frequency.setValueAtTime(cutoff, when);
    f.frequency.exponentialRampToValueAtTime(Math.max(cutoff * 0.2, 180), when + dur);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level, when + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    f.connect(g); g.connect(master);
    freqs.forEach((fr, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      // Detuned against each other rather than in tune: two saws a few cents
      // apart is a synth, two saws exactly in tune is one thin saw.
      o.detune.value = (i % 2 ? 9 : -9);
      o.connect(f); o.start(when); o.stop(when + dur + 0.04);
    });
  }

  // Sub. Felt more than heard on a decent set of speakers, and inaudible on a
  // laptop — which is fine: it is the floor under everything else, not a part.
  function sub(when, freq = 55, dur = 0.55, level = 0.8) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.6, when);
    o.frequency.exponentialRampToValueAtTime(freq, when + 0.09);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(master);
    o.start(when); o.stop(when + dur + 0.03);
  }

  // Noise climbing through a bandpass. Saved for the last seconds of a
  // question, where it does the job a countdown number cannot: it tells the
  // room something is about to happen without anyone reading anything.
  function riser(when, dur = 1.4, level = 0.26) {
    if (!noiseBuf) noise(when, 0.001, 1000, 0.0001);   // builds the buffer
    const s = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    s.buffer = noiseBuf;
    s.loop = true;
    f.type = 'bandpass';
    f.Q.value = 3.5;
    f.frequency.setValueAtTime(400, when);
    f.frequency.exponentialRampToValueAtTime(7000, when + dur);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level, when + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(when); s.stop(when + dur + 0.05);
  }

  // A CRASH CYMBAL. What the end of the clock actually wanted: not a soft
  // landing but a hit, with a long metallic ring over the bed walking away
  // underneath it.
  //
  // Loops the shared buffer, because that buffer is half a second long and a
  // crash rings for two — played straight it would run out of samples and go
  // silent a quarter of the way through the decay.
  //
  // Three parts, and all three are needed: a highpass so it is air rather
  // than rumble, a resonant peak up top so it reads as METAL and not as hiss,
  // and a short mid burst at the front for the stick hitting the thing.
  function crash(when, level = 0.8, dur = 2) {
    if (!noiseBuf) noise(when, 0.001, 1000, 0.0001);   // builds the buffer
    const src = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    const peak = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = noiseBuf;
    src.loop = true;
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    peak.type = 'peaking';
    peak.frequency.value = 7200;
    peak.Q.value = 0.8;
    peak.gain.value = 9;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(hp); hp.connect(peak); peak.connect(g); g.connect(master);
    src.start(when); src.stop(when + dur + 0.05);
    // The strike.
    noise(when, 0.09, 1300, level * 0.55, 'bandpass');
  }

  // ONE STROKE OF A SNARE.
  //
  // A DIFFERENT SLICE OF NOISE EVERY TIME, and that is the whole trick. The
  // first version started the same half-second buffer from sample zero on
  // every stroke — forty times a second, which is not noise any more, it is a
  // waveform repeating at 40Hz. A repeating waveform has a PITCH, and that
  // pitch sliding as the strokes tightened was the creaking door. Reading
  // from a random offset costs nothing and fixes it outright.
  //
  // Broadband, too: a snare is wires hissing across a whole spectrum, so it
  // is a highpass with a gentle Q. The narrow bandpass the roll used to
  // borrow from noise() is a tuned resonator, which is a creak by design.
  function snareStroke(when, level) {
    if (!noiseBuf) noise(when, 0.001, 1000, 0.0001);   // builds the buffer
    const src = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = noiseBuf;
    hp.type = 'highpass';
    hp.frequency.value = 900;
    hp.Q.value = 0.7;
    lp.type = 'lowpass';          // takes the fizz off the very top
    lp.frequency.value = 9000;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(master);
    src.start(when, Math.random() * 0.35, 0.09);
    src.stop(when + 0.1);
    // The shell the wires are stretched across. Quiet, and the reason a roll
    // sounds like a drum rather than like escaping steam.
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = 190;
    og.gain.setValueAtTime(0.0001, when);
    og.gain.exponentialRampToValueAtTime(level * 0.3, when + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
    o.connect(og); og.connect(master);
    o.start(when); o.stop(when + 0.05);
  }

  // A DRUM ROLL, the kind that runs up to a name being read out.
  //
  // Strokes, not a loop with a tremolo on it — but they have to be FAST
  // enough to fuse. Below about twenty-five a second the ear counts them and
  // hears a rattle; above thirty they blur into the continuous rrrrr that is
  // actually what a roll sounds like. This runs 28 up to 45.
  //
  // Everything is scheduled AHEAD on the audio clock rather than fired from
  // setTimeout. stop() runs on every phase change and would cut a JS-timed
  // roll off mid-way; it cannot touch notes already handed to Web Audio.
  function drumroll(when, dur = 1.05, level = 0.5) {
    let t = when;
    let i = 0;
    while (t < when + dur) {
      const progress = (t - when) / dur;
      const gap = 0.036 - progress * 0.014;
      // A hair of jitter. Machine-perfect spacing is a buzz; a drummer is
      // never quite even, and that unevenness is most of what says 'played'.
      const jitter = 1 + (Math.random() - 0.5) * 0.14;
      // Two hands: one is always slightly weaker than the other.
      const hand = i % 2 ? 0.86 : 1;
      snareStroke(t, level * (0.3 + progress * 0.7) * hand);
      t += gap * jitter;
      i += 1;
    }
  }

  // A braam: low detuned saws that swell. The cinematic one lives on these.
  function braam(when, freq, dur = 1.1, level = 0.5) {
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300, when);
    f.frequency.linearRampToValueAtTime(1400, when + dur * 0.35);
    f.frequency.linearRampToValueAtTime(400, when + dur);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level, when + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    f.connect(g); g.connect(master);
    [-14, 0, 11].forEach(cents => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(f); o.start(when); o.stop(when + dur + 0.05);
    });
  }

  // ── the four styles ────────────────────────────────────────────────────
  // Each one owns its beat, its pre-roll tick, its tempo curve and its stings.
  // They share the primitives above so a change to the envelope shape or the
  // limiter reaches all of them at once.
  //
  // `ms` is the length of the current beat in seconds, handed in by
  // startQuestion. Themes need it to place anything BETWEEN beats — an offbeat
  // hat, a bass on the and — and the beat length moves with the clock, so it
  // cannot be a constant.

  const THEMES = {
    // Four on the floor, an offbeat bass, and a pad that ducks on every kick.
    // The default: it is the one that makes a room sit up without anybody
    // deciding it is silly.
    drive: {
      drone: { freq: ROOT / 2, cutoff: 480, level: 0.14, type: 'sawtooth' },
      onStart() { step = 0; },
      beat(t, { urgency, secondsLeft, ms }) {
        kick(t, 0.95, 150, 46, 0.24);
        duck(t, 0.5, ms * 0.85);

        // The bass plays the AND, never the beat — it is the kick's echo, and
        // the gap where the downbeat would be is what makes it drive.
        const bass = [0, 0, 10, 7, 0, 0, 5, 3];
        note(hz(bass[step % bass.length], -1), t + ms * 0.5, ms * 0.42, 'sawtooth', 0.55);

        hat(t + ms * 0.5, 0.2 + urgency * 0.16);
        if (step % 2 === 1) hat(t + ms * 0.25, 0.1);

        // A chord every other bar, so the loop has somewhere to arrive.
        if (step % 8 === 0) stab(t, [hz(0), hz(3), hz(7)], ms * 0.7, 0.4, 2400 + urgency * 1800);
        if (step % 8 === 4) stab(t, [hz(-2), hz(3), hz(5)], ms * 0.7, 0.36, 2200 + urgency * 1800);

        // The pad opens as the clock closes. Filter sweeps are how this music
        // says "nearly there" — it does not need to get faster to get tenser.
        if (drone) drone.filter.frequency.setTargetAtTime(480 + urgency * 2600, ctx.currentTime, 0.3);
        if (secondsLeft <= 4 && step % 4 === 0) riser(t, Math.min(1.5, secondsLeft), 0.2);
      },
      interval: (left, total) => (left <= 5 ? 300 : 470 - (1 - left / total) * 110),
      preroll: (t, n) => {
        kick(t, 0.9, 150, 46, 0.24);
        stab(t, [hz(0, 1), hz(3, 1), hz(7, 1)], 0.3, 0.3 + n * 0.06, 2000 + n * 700);
      },
      sting: {
        reveal: t => { stab(t, [hz(0, 1), hz(7, 1), hz(12, 1)], 0.5, 0.55, 4200); sub(t, 55, 0.45, 0.6); },
        timeup: t => { crash(t, 0.85, 2.1); sub(t, 41, 0.9, 0.85); stab(t + 0.02, [hz(-1), hz(2), hz(6)], 0.7, 0.4, 1400); },
        podium: t => [[0, 7, 12], [3, 10, 15], [5, 12, 17], [7, 14, 19]].forEach((ch, i) =>
          stab(t + i * 0.19, ch.map(s => hz(s, 1)), 0.5, 0.5, 3600)),
      },
    },

    // Broadcast sport: a clap the size of a stand, brass-ish stabs, hats
    // rolling underneath. The celebratory one.
    stadium: {
      drone: { freq: ROOT / 2, cutoff: 700, level: 0.12, type: 'sawtooth' },
      onStart() { step = 0; },
      beat(t, { urgency, secondsLeft, ms }) {
        kick(t, 0.9, 160, 50, 0.22);
        duck(t, 0.35, ms * 0.8);
        // Backbeat. A clap on two and four is the oldest trick there is and
        // the one a room claps along to without being asked.
        if (step % 2 === 1) clap(t, 0.5 + urgency * 0.2);
        hat(t + ms * 0.5, 0.18);
        hat(t + ms * 0.75, 0.1 + urgency * 0.12);

        const horn = [0, 0, 7, 5, 3, 5, 7, 10];
        if (step % 2 === 0) {
          stab(t, [hz(horn[step % horn.length]), hz(horn[step % horn.length] + 7)],
            ms * 0.55, 0.4 + urgency * 0.15, 2600);
        }
        if (drone) drone.filter.frequency.setTargetAtTime(700 + urgency * 2200, ctx.currentTime, 0.3);
        if (secondsLeft <= 4 && step % 4 === 0) riser(t, Math.min(1.5, secondsLeft), 0.22);
      },
      interval: (left, total) => (left <= 5 ? 320 : 500 - (1 - left / total) * 130),
      preroll: (t, n) => { kick(t, 0.9, 160, 50, 0.22); clap(t, 0.3 + n * 0.12); },
      sting: {
        reveal: t => { clap(t, 0.7); stab(t, [hz(0, 1), hz(4, 1), hz(7, 1)], 0.45, 0.55, 4000); },
        timeup: t => { crash(t, 0.9, 2.3); sub(t, 44, 0.8, 0.8); },
        podium: t => {
          [0, 4, 7, 12].forEach((s, i) => stab(t + i * 0.17, [hz(s, 1), hz(s + 7, 1)], 0.55, 0.5, 3800));
          [0, 1, 2, 3, 4, 5].forEach(i => clap(t + 0.7 + i * 0.13, 0.45));
        },
      },
    },

    // Cinematic. Sub booms, a rising bed and a braam at the turn — the sound
    // a trailer uses to make a countdown feel like consequences.
    cinematic: {
      drone: { freq: ROOT / 4, cutoff: 240, level: 0.18, type: 'sawtooth' },
      onStart() { step = 0; },
      beat(t, { urgency, secondsLeft, ms }) {
        sub(t, 41, Math.min(0.7, ms * 1.4), 0.75 + urgency * 0.2);
        // A dry tick between the booms. It is a clock without being a clock
        // noise — the thing that keeps this tense rather than merely big.
        noise(t + ms * 0.5, 0.035, 3000, 0.22 + urgency * 0.25, 'highpass');
        if (step % 8 === 0) braam(t, hz(0, -1), Math.min(1.6, ms * 3), 0.4 + urgency * 0.2);
        if (step % 8 === 4) braam(t, hz(3, -1), Math.min(1.4, ms * 2.6), 0.32 + urgency * 0.2);
        if (drone) {
          drone.filter.frequency.setTargetAtTime(240 + urgency * 900, ctx.currentTime, 0.5);
          drone.oscs.forEach(o => o.detune.setTargetAtTime(urgency * 450, ctx.currentTime, 0.5));
        }
        if (secondsLeft <= 5 && step % 3 === 0) riser(t, Math.min(2, secondsLeft), 0.3);
      },
      // The widest tempo range of the four: it starts almost still and ends
      // hammering, which is the whole idea.
      interval: (left, total) => (left <= 5 ? 280 : 860 - (1 - left / total) * 480),
      preroll: (t, n) => { sub(t, 41, 0.5, 0.7); if (n === 0) braam(t, hz(0, -1), 1.6, 0.35); },
      sting: {
        reveal: t => { sub(t, 55, 0.5, 0.7); braam(t, hz(7, -1), 0.9, 0.45); },
        timeup: t => { crash(t, 0.8, 2.6); sub(t, 33, 1.2, 0.9); braam(t, hz(-1, -1), 1.3, 0.5); },
        podium: t => [0, 5, 7, 12].forEach((s, i) => braam(t + i * 0.28, hz(s, -1), 1.4, 0.45)),
      },
    },

    // Minimal and rolling. The one to pick when the trainer wants to talk over
    // it — modern rather than quiet, so it does not sound like the sound has
    // failed.
    deep: {
      drone: { freq: ROOT / 2, cutoff: 360, level: 0.1, type: 'triangle' },
      onStart() { step = 0; },
      beat(t, { urgency, ms }) {
        kick(t, 0.7, 130, 44, 0.2);
        duck(t, 0.3, ms * 0.8);
        hat(t + ms * 0.5, 0.13);
        // A rolling offbeat figure, low and soft. Movement without anything to
        // listen to, which is exactly the brief.
        const fig = [0, 3, 0, 7, 0, 5, 0, 3];
        note(hz(fig[step % fig.length], -1), t + ms * 0.5, ms * 0.45, 'triangle', 0.4);
        if (step % 8 === 0) stab(t, [hz(0), hz(3), hz(10)], ms * 0.8, 0.16, 1200);
        if (drone) drone.filter.frequency.setTargetAtTime(360 + urgency * 700, ctx.currentTime, 0.5);
      },
      // Barely moves. Rushing this one would make it sound broken rather than
      // urgent, and its whole job is to stay out of the way.
      interval: (left, total) => (left <= 5 ? 400 : 500 - (1 - left / total) * 90),
      preroll: t => { kick(t, 0.6, 130, 44, 0.2); hat(t + 0.24, 0.12); },
      sting: {
        reveal: t => stab(t, [hz(0), hz(3), hz(7), hz(10)], 0.8, 0.28, 1800),
        // Still the restrained one — a smaller crash, not no crash.
        timeup: t => { crash(t, 0.6, 1.7); sub(t, 44, 0.9, 0.6); stab(t, [hz(0), hz(3), hz(7)], 1.1, 0.2, 900); },
        podium: t => [0, 3, 7, 10, 12].forEach((s, i) => stab(t + i * 0.16, [hz(s), hz(s + 7)], 0.7, 0.3, 2200)),
      },
    },
  };

  const theme = () => THEMES[themeKey] ?? THEMES[DEFAULT_THEME];

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
      loadRoll();   // not awaited: the quiz must not wait on a sound file
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
      lastTimeUp = -99;
      th.onStart();
      if (th.drone) startDrone(th.drone);
      const beat = () => {
        const left = secondsLeftFn();
        if (left === null || left <= 0) { this.stop(); return; }
        const urgency = total > 0 ? 1 - Math.max(0, Math.min(1, left / total)) : 0;
        // Worked out BEFORE the beat, not after, because a theme placing an
        // offbeat hat or a bass on the and needs to know how long this beat
        // is — and the beat length moves with the clock.
        const ms = Math.max(140, th.interval(left, total));
        th.beat(ctx.currentTime + 0.02, { urgency, secondsLeft: left, total, ms: ms / 1000 });
        step += 1;
        timer = setTimeout(beat, ms);
      };
      beat();
    },

    stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      stopDrone();
    },

    // Time's up. Not stop() plus a sting: the beat stops, the bed is let down
    // over a second, and the theme's landing plays across the top of it — so
    // the last thing the room hears is the music arriving somewhere rather
    // than being unplugged.
    timeUp() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (!ensure()) return;
      lastTimeUp = ctx.currentTime;
      releaseDrone(1.15);
      const fn = theme().sting.timeup;
      if (fn) fn(ctx.currentTime + 0.02);
    },

    // The podium, driven by the same timers as the plinths so the sound and
    // the staging cannot drift apart. A roll runs up to each arrival and the
    // arrival lands on a crash — third, second, first, each one bigger.
    podiumRoll(seconds = 1.05) {
      if (!ensure()) return;
      const at = ctx.currentTime + 0.02;
      // The recording if there is one; the synth is the safety net, not an
      // alternative — it is the one that sounded like a door.
      if (!playRoll(at, seconds, 0.9)) drumroll(at, seconds, 0.5);
    },

    podiumLand(place) {
      if (!ensure()) return;
      const t = ctx.currentTime + 0.02;
      if (place === 1) {
        // The winner gets the cymbal AND the theme's fanfare over it. This is
        // the last sound of the whole quiz; it is allowed to be the biggest.
        crash(t, 0.95, 2.8);
        const fn = theme().sting.podium;
        if (fn) fn(t + 0.06);
      } else {
        // Second louder than third, so the three arrivals build.
        crash(t, 0.5 + (3 - place) * 0.12, 1.5);
        sub(t, 48, 0.5, 0.55);
      }
    },

    // Short cues. Deliberately not melodies: they punctuate, and anything
    // longer would still be playing when the trainer starts talking.
    sting(kind) {
      if (!ensure()) return;
      // The reveal cue fires when the phase flips, which after a natural
      // time-up is a fraction of a second later — straight over the landing
      // that is still ringing. Two punctuation marks in the same breath is a
      // mess, and the landing already IS the punctuation. So the reveal cue
      // stands down here, and still sounds when the trainer closed the
      // question early, which is the case that has no landing of its own.
      if (kind === 'reveal' && ctx.currentTime - lastTimeUp < 1.7) return;
      const fn = theme().sting[kind];
      if (fn) fn(ctx.currentTime + 0.02);
    },

    close() {
      this.stop();
      if (ctx) { try { ctx.close(); } catch { /* already closed */ } ctx = null; master = null; noiseBuf = null; }
    },
  };
}
