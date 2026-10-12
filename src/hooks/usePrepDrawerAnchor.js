import { useEffect, useLayoutEffect, useRef } from 'react';

// The prep drawer's geometry and focus while it is open on the workbook page:
// the page canvas pushed left, the drawer pinned to the exercise rail's top,
// and focus handed back to the 🎯 Prep button when it closes.
export function usePrepDrawerAnchor(prepOpen, sidebarRef, prepBtnRef) {
  // Push the page canvas left while the prep drawer is open (desktop). The
  // fixed drawer fills the gap. Cleaned up on close / unmount.
  useEffect(() => {
    document.body.classList.toggle('prep-drawer-pushed', prepOpen);
    return () => document.body.classList.remove('prep-drawer-pushed');
  }, [prepOpen]);

  // Anchor the drawer BEFORE it is allowed to paint open.
  //
  // The drawer is fixed by top AND bottom, so its top is not a position but a
  // dimension: rewriting it resizes the panel. Previously nothing wrote
  // --page-prep-top until the tracker's first frame, which lands AFTER the open
  // has started — so the drawer painted its first frame at the CSS fallback of
  // 80px (near the top of the window), then was yanked down to the rail on the
  // next frame. It didn't slide, it slid-dropped-and-shrank.
  //
  // useLayoutEffect runs after the DOM is updated but before the browser paints,
  // so the measurement below is in place for the drawer's very first frame.
  useLayoutEffect(() => {
    if (!prepOpen) return;
    const el = sidebarRef.current;
    if (el) {
      const top = Math.max(60, Math.round(el.getBoundingClientRect().top));
      document.body.style.setProperty('--page-prep-top', `${top}px`);
    }
  }, [prepOpen, sidebarRef]);

  // Keep the prep drawer pixel-locked to the exercise sidebar's top so it tucks
  // under the sticky bar exactly like the nav panel does. A per-frame rAF loop
  // re-reads the sidebar's live top, so no layout shift — scroll, sticky
  // pin/unpin, or async reflow (materials thumbnails loading) — can knock the
  // two out of alignment. We only write the CSS var when the value actually
  // changes, so it's cheap.
  //
  // It deliberately does NOT run during the slide. The anchor is already correct
  // (set pre-paint above), and the canvas is animating its margin for those
  // 300ms — measuring a layout that is still settling is how a write lands
  // mid-slide and resizes the drawer.
  useEffect(() => {
    if (!prepOpen) return undefined;
    let raf = 0;
    let easeTimer = 0;
    let last = null;
    let lastScrollY = window.scrollY;
    const loop = () => {
      const el = sidebarRef.current;
      if (el) {
        const top = Math.max(60, Math.round(el.getBoundingClientRect().top));
        if (top !== last) {
          // Two kinds of move, opposite treatment. Scrolling writes small
          // deltas many times a second and must stay instant or the drawer
          // lags the rail. A banner appearing above the workbook writes one
          // big delta with no scroll behind it — ease that, or it teleports.
          const jumped = last !== null && Math.abs(top - last) > 20;
          const scrolled = window.scrollY !== lastScrollY;
          if (jumped && !scrolled) {
            document.body.classList.add('prep-anchor-eased');
            clearTimeout(easeTimer);
            easeTimer = setTimeout(() => document.body.classList.remove('prep-anchor-eased'), 320);
          }
          last = top;
          document.body.style.setProperty('--page-prep-top', `${top}px`);
        }
      }
      lastScrollY = window.scrollY;
      raf = requestAnimationFrame(loop);
    };
    // Start once the slide has finished. A plain timer rather than
    // `transitionend`: that event fires per-property and never fires at all if
    // the transition is interrupted (open → close → open) or collapsed by
    // prefers-reduced-motion, and a tracker that never starts is worse than the
    // bug it replaces — the drawer would desync on the first scroll.
    const startTimer = setTimeout(() => { raf = requestAnimationFrame(loop); }, 320);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(easeTimer);
      cancelAnimationFrame(raf);
      document.body.classList.remove('prep-anchor-eased');
    };
  }, [prepOpen, sidebarRef]);

  // Send focus back to the 🎯 Prep button when the drawer closes, so keyboard
  // users aren't dropped at the top of the document.
  //
  // Only when focus was inside the drawer. This is a non-modal reference panel —
  // it's opened to read a PNR *while* filling in an answer — so Esc pressed
  // mid-sentence must close it without pulling the caret out of the answer box.
  // For the same reason focus is NOT moved into the drawer on open.
  const prepWasOpen = useRef(false);
  useEffect(() => {
    if (prepWasOpen.current && !prepOpen) {
      const active = document.activeElement;
      if (!active || active === document.body || active.closest?.('.prep-drawer')) {
        prepBtnRef.current?.focus();
      }
    }
    prepWasOpen.current = prepOpen;
  }, [prepOpen, prepBtnRef]);

  // NB: --page-prep-top is deliberately NOT cleared when the drawer closes.
  // Clearing it rewrites the drawer's top while it is still sliding out, which
  // (top + bottom being pinned) makes the panel grow as it leaves. The next
  // open re-measures pre-paint anyway, so a stale value is never read.
}
