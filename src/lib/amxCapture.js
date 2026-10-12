// Watch Amadeus: the browser side of sharing a tab and turning it into small
// JPEGs. Nothing here talks to the server; AmadeusShareContext sends what this
// produces.
//
// THE WORKBOOK TAB IS IN THE BACKGROUND THE WHOLE TIME. The participant shares
// from the workbook and then works in the ARD Web tab, so everything below has
// to keep running in a hidden tab:
//   • requestAnimationFrame stops there, so nothing uses it;
//   • page timers get throttled (to once a minute after ~5 min hidden), so the
//     tick comes from a dedicated Worker, whose timers are not;
//   • Chrome may stop painting a <video> nobody can see, so frames are read
//     from the track itself (MediaStreamTrackProcessor) where the browser has
//     it, with the <video> only as a fallback.

export function canShareScreen() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
}

// Ask the browser for a tab. The options steer the picker without forcing it:
// it opens on "Chrome tab" rather than "Entire screen" (where email and chats
// would be), leaves out the workbook tab itself, and offers "Share this tab
// instead" so a wrong pick can be corrected from the browser's own bar.
// Throws when the participant cancels the picker (NotAllowedError).
export async function pickTab() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser', frameRate: { ideal: 5, max: 10 } },
    audio: false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    preferCurrentTab: false,
  });
  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings?.() || {};
  return {
    stream,
    track,
    // 'browser' (a tab), 'window' or 'monitor' (the whole screen). The one
    // signal every Chromium browser gives; the label is NOT reliably the tab's
    // title, so nothing decides anything on it — it is only logged.
    surface: settings.displaySurface || null,
    label: track?.label || '',
  };
}

// Reads frames off a track and encodes them. One per share.
export function makeGrabber(track) {
  // The newest frame, kept as frames arrive. Tab capture only produces a frame
  // when the tab changes, so anything that WAITS for the next frame (as
  // ImageCapture.grabFrame does) hangs for as long as the screen is still —
  // which on a cryptic screen someone is reading is most of the time. Holding
  // the last one means a picture can be taken at any moment.
  let latest = null;
  let reading = false;
  let reader = null;
  if (typeof MediaStreamTrackProcessor !== 'undefined') {
    try {
      reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
      reading = true;
      (async () => {
        while (reading) {
          const { value, done } = await reader.read();
          if (done) break;
          if (latest) latest.close();
          latest = value;
        }
      })().catch(() => { reading = false; });
    } catch { reader = null; reading = false; }
  }

  // Fallback for browsers without the processor: a <video> always shows the
  // last frame it was given.
  let video = null;
  function ensureVideo() {
    if (video) return video;
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    video.play().catch(() => {});
    return video;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  function source() {
    if (reader) return latest ? { img: latest, w: latest.displayWidth, h: latest.displayHeight } : null;
    const v = ensureVideo();
    return v.videoWidth ? { img: v, w: v.videoWidth, h: v.videoHeight } : null;
  }

  // maxW: the widest to encode at; quality: JPEG 0–1; maxBytes: the payload
  // ceiling. Quality steps down first, then the width (a dense screen on a
  // high-DPI laptop may not fit at full width), before giving up.
  async function grab({ maxW, quality, maxBytes }) {
    for (const w of [maxW, Math.round(maxW * 0.75), Math.round(maxW * 0.55)]) {
      const out = encode(w, quality, maxBytes);
      if (out !== 'too-big') return out;
    }
    return null;
  }

  function encode(maxW, quality, maxBytes) {
    const src = source();
    if (!src || !src.w || !src.h) return null;
    const scale = Math.min(1, maxW / src.w);
    const w = Math.max(1, Math.round(src.w * scale));
    const h = Math.max(1, Math.round(src.h * scale));
    canvas.width = w; canvas.height = h;
    try { ctx.drawImage(src.img, 0, 0, w, h); } catch { return null; }
    let q = quality;
    let url = canvas.toDataURL('image/jpeg', q);
    while (url.length > maxBytes && q > 0.25) {
      q -= 0.15;
      url = canvas.toDataURL('image/jpeg', q);
    }
    if (url.length > maxBytes) return 'too-big';
    // The encoded picture is its own fingerprint: the same pixels encode to
    // the same bytes, and one new line of cryptic text changes them. (A coarse
    // downscaled fingerprint missed exactly that.)
    return { img: url, w, h, bytes: url.length, sig: url, sourceW: src.w, sourceH: src.h };
  }

  function close() {
    reading = false;
    if (reader) { reader.cancel().catch(() => {}); reader = null; }
    if (latest) { latest.close(); latest = null; }
    if (video) { video.pause(); video.srcObject = null; video = null; }
  }

  return { grab, close };
}

// A steady tick that survives a hidden tab: setInterval inside a Worker.
// Falls back to a page timer if a Worker can't be made (it still works, just
// slower once the tab has been hidden a while).
export function makeTicker(ms, onTick) {
  let worker = null;
  let timer = null;
  try {
    const src = `let t=null;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => onTick();
    worker.postMessage(ms);
  } catch {
    worker = null;
    timer = setInterval(onTick, ms);
  }
  return () => {
    if (worker) { worker.postMessage(0); worker.terminate(); }
    if (timer) clearInterval(timer);
  };
}
