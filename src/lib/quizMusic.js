// Live Quiz — the sound of the clock.
//
// RECORDED TRACKS. The music under a question is one of three licensed
// recordings (RECORDED, below). Until 2026-10 there were four synthesised
// styles instead — beds built note by note that sped up with the clock; they
// were retired in favour of the recordings, and only their short cues remain.
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

// THE DRUM ROLL is a recording too, but a separate one, and for a different
// reason: it is the podium's build, not music under a question.
//
// A drum roll is a sound synthesis is genuinely bad at. It is one fixed-length one-shot, and
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

// The cues' notes are drawn from a minor pentatonic or its relatives: five
// notes that cannot form a bad interval against each other.
const hz = (semi, oct = 0) => ROOT * Math.pow(2, semi / 12) * Math.pow(2, oct);

// The trainer's choices on the projector. Keys of retired styles ('drive',
// 'deep', …) still sit in some trainers' localStorage; the check in
// createQuizMusic drops them on the default rather than into silence.
export const QUIZ_MUSIC_THEMES = [
  { key: 'rec-countdown', label: 'Countdown', group: 'recorded', note: 'ends on zero' },
  { key: 'rec-news', label: 'News desk', group: 'recorded', note: 'loops' },
  { key: 'rec-thinking', label: 'Thinking time', group: 'recorded', note: 'loops' },
];

// RECORDED TRACKS. A recording cannot stretch to an arbitrary timer or get
// tenser as it runs out, so each is fitted to the clock in the one way its
// shape allows:
//
//   'end'  — Countdown is ~88s of music that swells and fades. It is started
//            late, so its ending lands as the clock reaches zero. A question
//            longer than that repeats the steady middle once, crossfaded, and
//            the ending still lands on zero.
//   'loop' — the two beds pick up where the last question left them (so the
//            room does not hear the same opening ten times a quiz) and wrap
//            round with a crossfade, because neither file joins end to start.
//
// What a recording cannot do itself comes from CUES (below): the count-in, the
// reveal cue, the time's-up landing, the podium fanfare, and a soft tick over
// the last five seconds so the end of a question still feels like one.
//
// Files live in public/sounds/quiz/ (see the README there). Each downloads only
// when picked — normally at "Start the quiz", during the count-in. A question
// that opens before its track has arrived, or whose track cannot load, runs
// with the tick alone: a quieter quiz, never a broken one.
const RECORDED = {
  // level: against MASTER, set by measurement (.verify/quiz-tracks.mjs) so the
  // three sit at a similar loudness through a room's speakers. Countdown is
  // mastered hotter than the two loops, so it is turned down further.
  'rec-countdown': { url: '/sounds/quiz/countdown.mp3', mode: 'end', end: 88, middle: [10, 80], preview: 60, level: 0.5 },
  'rec-news': { url: '/sounds/quiz/news-desk.mp3', mode: 'loop', preview: 4, level: 0.75 },
  'rec-thinking': { url: '/sounds/quiz/thinking-time.mp3', mode: 'loop', preview: 4, level: 0.75 },
};
const XFADE = 1.5;        // seconds, every join between two parts of a track

export function isRecordedTheme(key) {
  return !!RECORDED[key];
}

const DEFAULT_THEME = 'rec-countdown';

function readStore(key, fallback) {
  // Storage throws outright in some contexts (private windows, blocked site
  // data), so a plain read is not safe.
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writeStore(key, v) {
  try { localStorage.setItem(key, v); } catch { /* nothing to do */ }
}

// onTrackStatus(key, 'loading' | 'ready' | 'failed') reports a track's
// download, so the projector can say "Loading…" or that it could not load.
export function createQuizMusic({ onTrackStatus = () => {} } = {}) {
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
  let timer = null;
  // When the clock last ran out, on the audio clock. Used to keep the reveal
  // cue from landing on top of the time-up hit.
  let lastTimeUp = -99;
  let muted = readStore(MUTE_KEY, '0') === '1';
  // A trainer who picked 'arcade' last month has a key that no longer names
  // anything; the check below already handles that and drops them on the
  // default rather than into silence.
  let themeKey = QUIZ_MUSIC_THEMES.some(t => t.key === readStore(THEME_KEY, ''))
    ? readStore(THEME_KEY, '') : DEFAULT_THEME;
  // Recorded tracks: decoded buffers (false = tried and failed), downloads in
  // flight, where each loop stopped, and the bed now playing.
  const trackBuf = {};
  const trackLoad = {};
  const trackPos = {};
  let bed = null;      // { key, mode, voices: [{ src, gain }], segs: [{ when, offset }], timers: [] }
  let preview = null;  // the lobby audition, one voice

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

  // ── recorded tracks ────────────────────────────────────────────────────

  function loadTrack(key) {
    const spec = RECORDED[key];
    if (!spec || !ensure()) return Promise.resolve(null);
    if (trackBuf[key] !== undefined) return Promise.resolve(trackBuf[key] || null);
    if (trackLoad[key]) return trackLoad[key];
    onTrackStatus(key, 'loading');
    trackLoad[key] = (async () => {
      try {
        const res = await fetch(spec.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        trackBuf[key] = buf;
        console.info(`[quiz] track ${key}: ${buf.duration.toFixed(1)}s`);
        onTrackStatus(key, 'ready');
        return buf;
      } catch (e) {
        trackBuf[key] = false;
        console.warn(`[quiz] track ${key} could not be loaded (${e?.message || e}); the quiz runs without music`);
        onTrackStatus(key, 'failed');
        return null;
      } finally {
        trackLoad[key] = null;
      }
    })();
    return trackLoad[key];
  }

  // One stretch of a recording: starts at `when`, `offset` seconds into the
  // file, for `playFor` seconds (null = to the end), with a fade at each end so
  // no join clicks.
  function voice(buf, when, offset, playFor, fadeIn = 0.05, fadeOut = 0, level = 0.75) {
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    src.connect(gain); gain.connect(master);
    const len = playFor ?? (buf.duration - offset);
    const end = when + len;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(level, when + Math.max(0.02, fadeIn));
    if (fadeOut > 0) {
      gain.gain.setValueAtTime(level, Math.max(when + fadeIn, end - fadeOut));
      gain.gain.linearRampToValueAtTime(0.0001, end);
    }
    src.start(when, Math.max(0, offset));
    src.stop(end + 0.05);
    return { src, gain };
  }

  // A loop from `offset` to the end of the file, with the next pass queued to
  // fade in over the last XFADE seconds of this one.
  function loopFrom(b, buf, when, offset, fadeIn) {
    const left = buf.duration - offset;
    b.voices.push(voice(buf, when, offset, left, fadeIn, XFADE, b.level));
    b.segs.push({ when, offset });
    const nextAt = when + left - XFADE;
    // Queued half a second ahead, on the audio clock, so a busy tab cannot make
    // the join late.
    const wait = Math.max(0, (nextAt - 0.5 - ctx.currentTime) * 1000);
    b.timers.push(setTimeout(() => { if (bed === b) loopFrom(b, buf, nextAt, 0, XFADE); }, wait));
  }

  function startBed(key, secondsLeft) {
    const buf = trackBuf[key];
    const spec = RECORDED[key];
    const t0 = ctx.currentTime + 0.05;
    const b = { key, mode: spec.mode, level: spec.level, voices: [], segs: [], timers: [] };
    bed = b;
    if (spec.mode === 'end') {
      const end = Math.min(spec.end, buf.duration);
      if (secondsLeft <= end) {
        const off = end - secondsLeft;
        // Plays on past zero into the track's own fade; timeUp lets it ring.
        b.voices.push(voice(buf, t0, off, null, off > 0 ? 0.4 : 0.05, 0, b.level));
      } else {
        // Longer than the music: jump back inside the steady middle once, so
        // the remaining run still reaches `end` exactly at zero.
        // One repeat covers up to hi - lo (70s) extra; questions stop at 120s,
        // so at most 32s is ever needed.
        const [lo, hi] = spec.middle;
        const extra = secondsLeft - end;
        const jumpTo = Math.max(lo, hi - extra);
        b.voices.push(voice(buf, t0, 0, hi, 0.05, XFADE, b.level));
        b.voices.push(voice(buf, t0 + hi - XFADE, jumpTo - XFADE, null, XFADE, 0, b.level));
      }
    } else {
      const pos = (trackPos[key] || 0) % buf.duration;
      // A clean start from the top; a soft one when resuming mid-phrase.
      loopFrom(b, buf, t0, pos, pos > 0.5 ? 0.6 : 0.05);
    }
  }

  // Detached first: a time-up is followed by a phase change that calls stop(),
  // which must not cut a fade that is already running.
  function stopBed(fade = 0.25) {
    if (!bed || !ctx) return;
    const b = bed;
    bed = null;
    b.timers.forEach(t => t && clearTimeout(t));
    const now = ctx.currentTime;
    if (b.mode === 'loop' && trackBuf[b.key]) {
      const seg = [...b.segs].reverse().find(sg => sg.when <= now) || b.segs[0];
      if (seg) trackPos[b.key] = (seg.offset + Math.max(0, now - seg.when)) % trackBuf[b.key].duration;
    }
    b.voices.forEach(({ src, gain }) => {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + fade);
      try { src.stop(now + fade + 0.05); } catch { /* not started or already stopped */ }
    });
  }

  function stopPreview() {
    if (!preview || !ctx) return;
    const { src, gain } = preview;
    preview = null;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    try { src.stop(now + 0.25); } catch { /* already stopped */ }
  }

  // The last five seconds of a recorded bed: one soft tick a second, read off
  // the real clock like every built-in beat.
  function tick(when) {
    noise(when, 0.03, 3400, 0.32, 'highpass');
    note(hz(12, 1), when, 0.05, 'sine', 0.12);
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

  // ── the kit the cues are made of ───────────────────────────────────────
  // Hats, filtered saw stabs, a sub and a crash — what is left of the kit the
  // retired styles were built from, kept for the cues and the podium.

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

  // ── the cues ────────────────────────────────────────────────────────────
  // The short sounds around the music, the same for every track. Kept from the
  // retired style that suited a recording playing underneath (it was called
  // Deep focus): restrained, so they punctuate rather than compete.
  const CUES = {
    // The "get ready" count-in, one per tick of the pre-roll.
    preroll: t => { kick(t, 0.6, 130, 44, 0.2); hat(t + 0.24, 0.12); },
    sting: {
      reveal: t => stab(t, [hz(0), hz(3), hz(7), hz(10)], 0.8, 0.28, 1800),
      timeup: t => { crash(t, 0.6, 1.7); sub(t, 44, 0.9, 0.6); stab(t, [hz(0), hz(3), hz(7)], 1.1, 0.2, 900); },
      podium: t => [0, 3, 7, 10, 12].forEach((s, i) => stab(t + i * 0.16, [hz(s), hz(s + 7)], 0.7, 0.3, 2200)),
    },
  };

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

    // Changing track mid-question restarts the music so the trainer hears the
    // choice immediately — choosing by ear is the only way to pick one.
    setTheme(key, restart) {
      if (!RECORDED[key]) return;
      themeKey = key;
      writeStore(THEME_KEY, key);
      stopPreview();
      loadTrack(key);
      if ((timer || bed) && typeof restart === 'function') restart();
    },

    // What picking a track in the lobby plays, so choosing is not guesswork:
    // six seconds of it (or the reveal cue, if it cannot be loaded).
    async audition() {
      if (!ensure()) return;
      const key = themeKey;
      const spec = RECORDED[key];
      if (!spec) return;
      const buf = await loadTrack(key);
      // Picked something else meanwhile, or a question opened: say nothing.
      if (!buf || themeKey !== key || timer || bed) { if (!buf) this.sting('reveal'); return; }
      stopPreview();
      const off = Math.max(0, Math.min(spec.preview, buf.duration - 7));
      preview = voice(buf, ctx.currentTime + 0.05, off, 6, 0.3, 1.2, spec.level);
    },

    // Called on the trainer's click, which is the gesture that lets audio play
    // at all. Safe to call more than once.
    async unlock() {
      const c = ensure();
      if (c && c.state === 'suspended') { try { await c.resume(); } catch { /* denied */ } }
      loadRoll();   // not awaited: the quiz must not wait on a sound file
      loadTrack(themeKey);
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
        CUES.preroll(ctx.currentTime + 0.02, n);
        n += 1;
        timer = setTimeout(tick, 700);
      };
      tick();
    },

    // Runs the music for a question: the chosen track, fitted to the clock
    // (startBed), and a soft tick over the last five seconds. secondsLeftFn is
    // read on every check rather than captured, so the tick follows the real
    // clock — including the server skew correction.
    //
    // A track that has not arrived yet starts downloading here and this
    // question has the tick alone; the next one will have the music.
    startQuestion(total, secondsLeftFn) {
      this.stop();
      if (!ensure()) return;
      lastTimeUp = -99;
      const key = themeKey;
      if (trackBuf[key]) startBed(key, Math.max(1, secondsLeftFn() ?? total));
      else loadTrack(key);
      let lastTick = null;
      const watch = () => {
        const left = secondsLeftFn();
        if (left === null || left <= 0) { timer = null; return; }
        const whole = Math.ceil(left);
        if (whole <= 5 && whole !== lastTick) { lastTick = whole; tick(ctx.currentTime + 0.02); }
        timer = setTimeout(watch, 120);
      };
      watch();
    },

    stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      stopBed();
      stopPreview();
    },

    // Time's up. Not stop() plus a sting: the beat stops, the bed is let down
    // over a second, and the theme's landing plays across the top of it — so
    // the last thing the room hears is the music arriving somewhere rather
    // than being unplugged.
    timeUp() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (!ensure()) return;
      lastTimeUp = ctx.currentTime;
      if (bed) {
        // Countdown's own fade IS the landing, so it is let ring and no hit is
        // added. A loop is let down over a second under the landing.
        const ending = bed.mode === 'end';
        stopBed(ending ? 2.5 : 1.1);
        if (ending) return;
      }
      const fn = CUES.sting.timeup;
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
        const fn = CUES.sting.podium;
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
      const fn = CUES.sting[kind];
      if (fn) fn(ctx.currentTime + 0.02);
    },

    close() {
      this.stop();
      if (ctx) { try { ctx.close(); } catch { /* already closed */ } ctx = null; master = null; noiseBuf = null; }
    },
  };
}
