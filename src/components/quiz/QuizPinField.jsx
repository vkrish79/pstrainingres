import { useEffect, useRef, useState } from 'react';
import { signedQuizMapUrl } from '../../lib/quizImages.js';
// The pin styles live with the run's sheet because three of this component's
// four uses are in the run. Imported HERE rather than left to the page, so the
// fourth — the editor, which loads none of that sheet — cannot end up with an
// unstyled map and a circle in the top-left corner.
import '../../styles/quiz-live.css';

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
  // Where the keyboard crosshair is. Null until an arrow key is pressed, so a
  // pointer user never sees a cursor they did not ask for.
  const [cursor, setCursor] = useState(null);
  const imgRef = useRef(null);

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

  // The aspect ratio of the picture AS DISPLAYED. The radius of the target is
  // stored as two numbers, one per axis, so that a circle on screen stays a
  // circle on a phone, a laptop and a projector; this is where the second one
  // comes from. See 20260922000001_quiz_pin.sql.
  function measure() {
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return rect;
  }

  function pickAt(clientX, clientY) {
    if (!onPick || busy) return;
    const rect = measure();
    if (!rect) return;
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    onPick({ x, y, aspect: rect.width / rect.height });
  }

  function drop(x, y) {
    if (!onPick || busy) return;
    const rect = measure();
    if (!rect) return;
    onPick({ x, y, aspect: rect.width / rect.height });
  }

  // A map that can only be clicked is a map some people cannot answer. Arrows
  // move a crosshair, Enter or Space drops the pin there — coarse, but it is
  // the difference between a hard question and an impossible one.
  function onKeyDown(e) {
    if (!onPick || busy) return;
    const at = cursor ?? myPin ?? { x: 0.5, y: 0.5 };
    const step = e.shiftKey ? 0.005 : 0.02;
    let { x, y } = at;
    if (e.key === 'ArrowLeft') x -= step;
    else if (e.key === 'ArrowRight') x += step;
    else if (e.key === 'ArrowUp') y -= step;
    else if (e.key === 'ArrowDown') y += step;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      drop(at.x, at.y);
      return;
    } else return;
    e.preventDefault();
    setCursor({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
  }

  if (!path) return null;

  const interactive = !!onPick && !busy;

  return (
    <div
      className={`qpin ${className}${interactive ? ' is-live' : ''}`}
      {...(onPick ? {
        role: 'application',
        tabIndex: 0,
        'aria-label': `${label} — click, or use the arrow keys and press Enter, to drop your pin`,
        onClick: e => pickAt(e.clientX, e.clientY),
        onKeyDown,
      } : {})}
    >
      {url && !failed && (
        <img ref={imgRef} className="qpin-img" src={url} alt={label} onError={() => setFailed(true)} draggable="false" />
      )}
      {failed && <span className="qimg-missing">Picture unavailable</span>}

      {/* Drawn only once the bitmap is up: a circle floating over an empty
          box is a mark with nothing to mean anything against. */}
      {url && !failed && (
        <>
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

          {myPin && (
            <span className="qpin-mine" style={{ left: `${myPin.x * 100}%`, top: `${myPin.y * 100}%` }} />
          )}

          {cursor && interactive && (
            <span className="qpin-cursor" style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }} />
          )}
        </>
      )}
    </div>
  );
}
