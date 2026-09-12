import { useEffect, useRef, useState } from 'react';

// A vote count that counts, rather than one that redraws.
//
// Going straight from 3 to 4 is a repaint — at the back of a room it reads as
// the screen having been replaced, not as somebody having voted. Rolling the
// number over ~300ms is what makes it read as an arrival, and it matters more
// than it sounds when the trainer is facing the room rather than the wall.
//
// Honours prefers-reduced-motion by simply being the number, because for
// someone who has asked for less motion a counting digit is exactly the kind
// of thing they asked for less of.
const DURATION_MS = 320;

export default function PollCount({ value }) {
  const [shown, setShown] = useState(value);
  // What is on screen right now, which is not necessarily what we last
  // animated to: an animation interrupted half way (a second vote landing
  // while the first is still rolling) has to continue from where the eye is,
  // not from where the previous tween was aiming.
  const shownRef = useRef(value);
  const frame = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const from = shownRef.current;
    if (reduce || from === value) {
      shownRef.current = value;
      setShown(value);
      return undefined;
    }

    const started = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - started) / DURATION_MS);
      const eased = 1 - (1 - t) ** 3;          // ease-out: quick off the mark, settles
      const next = Math.round(from + (value - from) * eased);
      shownRef.current = next;
      setShown(next);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value]);

  return <>{shown}</>;
}
