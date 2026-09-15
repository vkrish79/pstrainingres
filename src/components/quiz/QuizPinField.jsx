import { useEffect, useRef, useState } from 'react';
import { signedQuizMapUrl } from '../../lib/quizImages.js';
// The pin styles live with the run's sheet because three of this component's
// four uses are in the run. Imported HERE rather than left to the page, so the
// fourth — the editor, which loads none of that sheet — cannot end up with an
// unstyled map and a circle in the top-left corner.
import '../../styles/quiz-live.css';

// A LOCATION PIN, not a dot. The tip is the answer: the marker is anchored so
// that the point of the teardrop sits exactly on the coordinate, which is also
// why it is drawn pointing down rather than as a symmetrical blob — a blob has
// no obvious anchor and every person reading it picks a different one.
function PinMarker() {
  return (
    <svg className="qpin-marker" viewBox="0 0 24 32" aria-hidden="true" focusable="false">
      <path
        d="M12 0.8C5.9 0.8 1 5.7 1 11.8c0 8.2 11 19.4 11 19.4s11-11.2 11-19.4C23 5.7 18.1 0.8 12 0.8z"
        fill="currentColor" stroke="rgba(0,0,0,.45)" strokeWidth="1" strokeLinejoin="round" />
      <circle cx="12" cy="11.6" r="4.2" fill="#fff" />
    </svg>
  );
}

// The picture a pin is dropped on, and everything drawn over it.
//
// ONE COMPONENT, FOUR JOBS: the trainer marking the target in the editor, the
// participant tapping an answer, the wall showing the map while the clock
// runs, and the reveal showing the target with every pin in the room on it.
// They differ only in what is passed in, and keeping them one component is
// what guarantees a pin drawn at (0.31, 0.62) sits over the same rooftop in
// all four — which is the whole promise a drop-pin question makes.
//
// COORDINATES ARE NORMALISED against the DISPLAYED image, read from the <img>
// element's own rectangle rather than the wrapper's. The wrapper can be wider
// than the picture inside it — a centred image in a flex column is exactly
// that — and a tap measured against the box instead of the bitmap lands
// somewhere the participant did not touch, by a margin that grows with the
// gap. Nothing about that failure looks wrong on screen.
//
//
// THE GESTURE IS A PRESS AND A DRAG, not a click, and that is the whole
// difference between this working in a room and not. Tried in a live one and
// reported back as "sloppy and non-responsive", for three reasons that all
// have the same shape — the phone was never given a gesture it could answer
// immediately:
//
//   * a `click` handler means the browser holds every tap for as long as it
//     takes to rule out a scroll and a double-tap zoom, and a tap that drifts
//     a pixel is ruled a scroll and swallowed entirely;
//   * one network round trip per tap, with taps during the trip DROPPED, so
//     the second tap of an adjustment did nothing at all;
//   * no way to nudge — tap, wait, tap, wait, on a map the size of a palm.
//
// Pointer events with capture fix all three at once: the pin lands under the
// finger on `pointerdown` with no round trip and no waiting, follows it while
// it moves, and goes to the server ONCE, on release. `touch-action: none` in
// the CSS is the other half — without it the browser is still entitled to
// decide the gesture was a scroll after all.
export default function QuizPinField({
  path,
  onPick,                 // ({ x, y, aspect }) => void — absent means read-only
  target,                 // { x, y, rx, ry } — the answer, only ever at the reveal
  pins = [],              // [{ x, y, was_correct }] — everyone else's
  myPin = null,           // { x, y } — this person's own, while they answer
  busy = false,
  className = '',
  label = 'Map',
}) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  // Where the finger is RIGHT NOW. Drawn in preference to myPin, so the pin
  // tracks the hand rather than the network.
  const [live, setLive] = useState(null);
  // Where the keyboard crosshair is. Null until an arrow key is pressed, so a
  // pointer user never sees a cursor they did not ask for.
  const [cursor, setCursor] = useState(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null);       // the pointer id we captured, or null

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setFailed(false);
    if (!path) return undefined;
    signedQuizMapUrl(path)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error || !data) setFailed(true);
        else setUrl(data);
      })
      .catch((e) => {
        console.warn('[quiz] could not sign map url', path, e);
        if (alive) setFailed(true);
      });
    return () => { alive = false; };
  }, [path]);

  // A new question, or the window closing, must not leave a pin stuck under a
  // finger that has long gone.
  useEffect(() => { setLive(null); dragRef.current = null; }, [path]);

  // The aspect ratio of the picture AS DISPLAYED. The radius of the target is
  // stored as two numbers, one per axis, so that a circle on screen stays a
  // circle on a phone, a laptop and a projector; this is where the second one
  // comes from. See 20260922000001_quiz_pin.sql.
  function measure() {
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return rect;
  }

  function pointAt(clientX, clientY) {
    const rect = measure();
    if (!rect) return null;
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
      aspect: rect.width / rect.height,
    };
  }

  const interactive = !!onPick && !busy;

  function onPointerDown(e) {
    if (!interactive) return;
    const p = pointAt(e.clientX, e.clientY);
    if (!p) return;
    // Capture, so a finger that slides off the picture keeps being followed
    // and the release still lands here rather than nowhere.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported; the rest still works */ }
    dragRef.current = e.pointerId;
    setCursor(null);
    setLive(p);
  }

  function onPointerMove(e) {
    if (dragRef.current !== e.pointerId) return;
    const p = pointAt(e.clientX, e.clientY);
    if (p) setLive(p);
  }

  // ONE send, on release. Everything before this was local.
  function onPointerUp(e) {
    if (dragRef.current !== e.pointerId) return;
    dragRef.current = null;
    const p = pointAt(e.clientX, e.clientY) || live;
    setLive(null);
    if (p && onPick) onPick(p);
  }

  function onPointerCancel(e) {
    if (dragRef.current !== e.pointerId) return;
    dragRef.current = null;
    // Cancelled rather than released — a system gesture took over. Commit what
    // was under the finger anyway: losing an answer to an incoming phone call
    // is worse than recording one the person had already positioned.
    const p = live;
    setLive(null);
    if (p && onPick) onPick(p);
  }

  // A map that can only be pointed at is a map some people cannot answer.
  // Arrows move a crosshair, Enter or Space drops the pin there — coarse, but
  // it is the difference between a hard question and an impossible one.
  function onKeyDown(e) {
    if (!interactive) return;
    const at = cursor ?? myPin ?? { x: 0.5, y: 0.5 };
    const step = e.shiftKey ? 0.005 : 0.02;
    let { x, y } = at;
    if (e.key === 'ArrowLeft') x -= step;
    else if (e.key === 'ArrowRight') x += step;
    else if (e.key === 'ArrowUp') y -= step;
    else if (e.key === 'ArrowDown') y += step;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const rect = measure();
      if (rect) onPick({ x: at.x, y: at.y, aspect: rect.width / rect.height });
      return;
    } else return;
    e.preventDefault();
    setCursor({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
  }

  if (!path) return null;

  // What to draw as "mine": the finger wins over the server.
  const mine = live || myPin;

  return (
    <div
      className={`qpin ${className}${interactive ? ' is-live' : ''}${live ? ' is-dragging' : ''}`}
      {...(onPick ? {
        role: 'application',
        tabIndex: 0,
        'aria-label': `${label} — press the picture to place your pin, drag to move it, or use the arrow keys and press Enter`,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel,
        onKeyDown,
      } : {})}
    >
      {/* THE FRAME IS THE COORDINATE SYSTEM, and it exists because the marks
          used to be drawn against a different box from the one the taps were
          measured against. Taps are read from the <img> rectangle; the marks
          were positioned as a percentage of the OUTER wrapper — which the
          handset stretches to the full column (flex: 1 1 auto; width: 100%)
          while the picture keeps its own shape. Every pin was displaced by
          the gap between the two, which on a phone is most of the screen.

          This element shrink-wraps the bitmap and holds the overlays, so the
          box that is measured and the box that is drawn on are the same box
          by construction rather than by coincidence. */}
      {url && !failed && (
        <span className="qpin-frame">
          <img ref={imgRef} className="qpin-img" src={url} alt={label} onError={() => setFailed(true)} draggable="false" />

          {/* Drawn only once the bitmap is up: a circle floating over an empty
              box is a mark with nothing to mean anything against. */}
          {target && target.x != null && (
            <span
              className="qpin-target"
              style={{
                left: `${(target.x - target.rx) * 100}%`,
                top: `${(target.y - target.ry) * 100}%`,
                width: `${target.rx * 200}%`,
                height: `${target.ry * 200}%`,
              }}
            />
          )}

          {pins.map((p, i) => (
            <span
              key={i}
              className={`qpin-dot${p.was_correct === true ? ' is-right' : p.was_correct === false ? ' is-wrong' : ''}`}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            />
          ))}

          {/* YOUR PIN. A marker whose TIP is the answer, so it is anchored by
              its point rather than its middle — and a second, small mark is
              drawn at that exact point while the finger is down, because the
              marker itself is under the thumb at the moment you most need to
              see precisely where it is going. */}
          {mine && (
            <span
              className={`qpin-mine${live ? ' is-held' : ''}`}
              style={{ left: `${mine.x * 100}%`, top: `${mine.y * 100}%` }}
            >
              <PinMarker />
            </span>
          )}
          {mine && live && (
            <span className="qpin-tip" style={{ left: `${mine.x * 100}%`, top: `${mine.y * 100}%` }} />
          )}

          {cursor && interactive && (
            <span className="qpin-cursor" style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }} />
          )}
        </span>
      )}
      {failed && <span className="qimg-missing">Picture unavailable</span>}
    </div>
  );
}
