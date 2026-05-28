import { useCallback, useEffect, useRef, useState } from 'react';

// Slide-deck state + nav handlers shared by the participant workbook and the
// trainer "My copy" practice view. Wraps:
//   - slideIdx: which section is showing
//   - slideDir / animKey: drive the CSS slide-in animation in SlidesDeck
//   - goSlide(±1): step the deck and clamp at the edges
//   - jumpSlide(idx): non-stepping jumps (clicked a progress dot)
//   - onTouchStart / onTouchEnd: mobile swipe handlers (≥50px, horizontal)
//   - keyboard ←/→ paging while not typing in a field
//
// The viewMode argument lets the caller flip the hook on/off without
// unmounting it — keyboard listener is only attached in slides mode.
// `blockedByDrawer` is a hook escape hatch: pages with open drawers
// (notes/prep/monitor) pass true so the arrow keys don't fight the drawer.
const VIEW_MODE_STORAGE_PREFIX = 'pstrainingres.wb.viewMode';

export function loadViewMode(key) {
  try {
    return localStorage.getItem(`${VIEW_MODE_STORAGE_PREFIX}.${key}`) === 'slides' ? 'slides' : 'scroll';
  } catch {
    return 'scroll';
  }
}
export function saveViewMode(key, mode) {
  try { localStorage.setItem(`${VIEW_MODE_STORAGE_PREFIX}.${key}`, mode); }
  catch { /* private mode */ }
}

export function useSlides({ sections, viewMode, blockedByDrawer = false }) {
  const [slideIdx, setSlideIdx] = useState(0);
  const [slideDir, setSlideDir] = useState('forward');
  const [animKey, setAnimKey] = useState(0);

  // Clamp the slide index when the section list changes underneath us (a live
  // edit added/removed sections).
  useEffect(() => {
    if (viewMode !== 'slides') return;
    if (sections.length === 0) { if (slideIdx !== 0) setSlideIdx(0); return; }
    if (slideIdx >= sections.length) setSlideIdx(sections.length - 1);
  }, [viewMode, sections.length, slideIdx]);

  const goSlide = useCallback((delta) => {
    setSlideIdx(prev => {
      const next = Math.min(sections.length - 1, Math.max(0, prev + delta));
      if (next !== prev) {
        setSlideDir(delta > 0 ? 'forward' : 'backward');
        setAnimKey(k => k + 1);
      }
      return next;
    });
  }, [sections.length]);

  const jumpSlide = useCallback((targetIdx) => {
    if (targetIdx < 0 || targetIdx >= sections.length) return;
    setSlideIdx(prev => {
      if (targetIdx === prev) return prev;
      setSlideDir(targetIdx > prev ? 'forward' : 'backward');
      setAnimKey(k => k + 1);
      return targetIdx;
    });
  }, [sections.length]);

  const seedTo = useCallback((targetIdx) => {
    if (targetIdx < 0 || targetIdx >= sections.length) return;
    setSlideIdx(targetIdx);
    setAnimKey(k => k + 1);
  }, [sections.length]);

  // Keyboard: ←/→ pages the deck unless typing or a drawer is open.
  useEffect(() => {
    if (viewMode !== 'slides') return undefined;
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (blockedByDrawer) return;
      const t = e.target;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goSlide(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goSlide(1); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode, blockedByDrawer, goSlide]);

  // Touch swipe — track horizontal dominance + speed.
  const touchRef = useRef(null);
  const onTouchStart = useCallback((e) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, []);
  const onTouchEnd = useCallback((e) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 50) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.2) return; // mostly vertical → scroll
    if (Date.now() - start.t > 800) return; // too slow
    goSlide(dx < 0 ? 1 : -1);
  }, [goSlide]);

  return {
    slideIdx, slideDir, animKey,
    currentSection: sections[slideIdx] || null,
    goSlide, jumpSlide, seedTo,
    onTouchStart, onTouchEnd,
  };
}
