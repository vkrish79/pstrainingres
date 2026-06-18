import { useCallback, useEffect, useRef, useState } from 'react';

// Pointer-events drag for the card-based question types. Built on Pointer
// Events (not the HTML5 drag-and-drop API) so it works on participants'
// tablets/phones — HTML5 dragstart/drop don't fire on most touch browsers.
//
// It also doubles as a tap-to-place control: a press-release with no real
// movement is reported as a "tap" instead of a drag, so a card can be moved by
// tapping it then tapping a target. Drop targets are any DOM ancestor carrying
// a `data-dropzone="<id>"` attribute.
//
// Usage:
//   const drag = useCardDrag({ onDrop: (cardId, zoneId) => …, onTap: (cardId) => … });
//   <div {...drag.handlers(cardId)} />        // a draggable card
//   <div data-dropzone={bucketId} />          // a drop target
//   {drag.ghost}                              // the floating drag preview
const MOVE_THRESHOLD = 6; // px before a press counts as a drag, not a tap

export function useCardDrag({ onDrop, onTap, disabled = false }) {
  const [drag, setDrag] = useState(null); // { id, label, x, y } | null
  const stateRef = useRef({ id: null, startX: 0, startY: 0, moved: false, label: '' });

  const onPointerMove = useCallback((e) => {
    const st = stateRef.current;
    if (st.id == null) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (!st.moved && Math.hypot(dx, dy) < MOVE_THRESHOLD) return;
    st.moved = true;
    setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
  }, []);

  const onPointerUp = useCallback((e) => {
    const st = stateRef.current;
    if (st.id == null) return;
    const id = st.id;
    const moved = st.moved;
    stateRef.current = { id: null, startX: 0, startY: 0, moved: false, label: '' };
    setDrag(null);
    if (moved) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const zone = el?.closest?.('[data-dropzone]');
      if (zone) onDrop?.(id, zone.getAttribute('data-dropzone'));
    } else {
      onTap?.(id);
    }
  }, [onDrop, onTap]);

  // Window-level listeners while a press is active so a fast drag that outruns
  // the element still tracks. Pointer capture (set on down) keeps events coming
  // even when the finger leaves the card.
  useEffect(() => {
    if (!drag && stateRef.current.id == null) return undefined;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [drag, onPointerMove, onPointerUp]);

  const handlers = useCallback((id, label = '') => {
    if (disabled) return {};
    return {
      onPointerDown: (e) => {
        // Ignore secondary buttons; let inputs/buttons inside still work.
        if (e.button != null && e.button !== 0) return;
        stateRef.current = { id, startX: e.clientX, startY: e.clientY, moved: false, label };
        setDrag({ id, label, x: e.clientX, y: e.clientY });
        try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* no-op */ }
      },
      style: { touchAction: 'none' }, // stop the browser scrolling instead of dragging
    };
  }, [disabled]);

  const ghost = drag && stateRef.current.moved ? (
    <div
      className="card-drag-ghost"
      style={{ position: 'fixed', left: drag.x, top: drag.y, pointerEvents: 'none', zIndex: 1000, transform: 'translate(-50%, -50%)' }}
    >
      {drag.label}
    </div>
  ) : null;

  return { handlers, ghost, draggingId: drag?.id ?? null };
}
