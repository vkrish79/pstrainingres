import { useEffect, useRef, useState } from 'react';

// Which sections have JUST crossed into 100% — the moment, not the state.
//
// Two things it deliberately does not do:
//   * It never fires on arrival. The first pass only records a baseline, so an
//     exercise that was already finished when the page loaded stays quiet; the
//     animation marks the act of finishing, not the fact of being finished.
//   * It never fires for a section with nothing to fill (total === 0), which
//     would otherwise "complete" the moment it rendered.
//
// `stats` is the sectionStats array ({ id, total, pct }). Ids are held for
// `holdMs` and then released, so the CSS animation runs once and the class is
// gone before anything can re-trigger it.
export function useJustCompleted(stats, holdMs = 1200) {
  const prevRef = useRef(null);
  const [justDone, setJustDone] = useState(() => new Set());

  useEffect(() => {
    const now = new Map((stats || []).map(s => [s.id, s.total > 0 && s.pct === 100]));
    const prev = prevRef.current;
    prevRef.current = now;
    if (!prev) return undefined; // first pass: baseline only

    // Only a real transition counts: known-and-incomplete -> complete. A section
    // seen for the first time (prev has no entry) is a load, not a completion.
    const crossed = [];
    for (const [id, done] of now) if (done && prev.get(id) === false) crossed.push(id);
    if (!crossed.length) return undefined;

    setJustDone(s => {
      const next = new Set(s);
      crossed.forEach(id => next.add(id));
      return next;
    });
    const t = setTimeout(() => {
      setJustDone(s => {
        const next = new Set(s);
        crossed.forEach(id => next.delete(id));
        return next;
      });
    }, holdMs);
    return () => clearTimeout(t);
  }, [stats, holdMs]);

  return justDone;
}
