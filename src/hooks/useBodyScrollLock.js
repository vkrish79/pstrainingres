import { useEffect } from 'react';

// Freeze background page scroll while a modal/drawer is open, restoring the
// previous overflow when the last lock releases. Ref-counted so stacked
// modals (one opening another) don't unlock the page prematurely.
//
// Call unconditionally (hooks rule) and gate with `active` — e.g. a component
// that returns null when closed passes `active={open}`.
let lockCount = 0;
let prevOverflow = '';

export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    if (lockCount === 0) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = prevOverflow;
    };
  }, [active]);
}
