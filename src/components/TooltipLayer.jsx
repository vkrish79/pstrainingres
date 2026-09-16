import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../styles/tooltip.css';

// The app's one tooltip. Mounted once (main.jsx); no component needs to wrap
// anything to get a hint.
//
// STANDARD: the browser's own title tooltip is never shown. It arrives about a
// second late, is drawn by the operating system rather than this app, and does
// not appear at all on a touch screen. Hints are written as data-tip="…".
//
// A plain title="…" still works, because there are 140-odd of them in the app
// and more will be written: the moment an element with a title appears, it is
// moved to data-tip before the browser can show it. If the element had no
// accessible name of its own, the text becomes its aria-label, so a screen
// reader still hears what the title used to say.
//
// ONE BUBBLE, IN A FIXED LAYER. Not an ::after inside each control — that is
// what the quiz editor used to do, and it was clipped inside anything that
// scrolls and, hidden, still widened the page on a phone. Here the bubble is
// placed against the window, above the element (below it if there is no room),
// and pulled in from the edges so it is never cut off.
const HOVER_DELAY_MS = 350;
const EDGE = 8;

// Frames name themselves with title for screen readers; there is no hover
// bubble to replace, so they are left as they are.
const SKIP = new Set(['IFRAME', 'LINK', 'STYLE', 'SCRIPT', 'META']);

function hasAccessibleName(el) {
  if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return true;
  if (el.tagName === 'IMG' && el.getAttribute('alt')) return true;
  return (el.textContent || '').trim().length > 0;
}

function convertTitle(el) {
  if (!(el instanceof Element) || SKIP.has(el.tagName)) return;
  const t = el.getAttribute('title');
  if (t == null) return;
  el.removeAttribute('title');
  if (!t.trim()) return;
  el.setAttribute('data-tip', t);
  if (!hasAccessibleName(el)) el.setAttribute('aria-label', t);
}

function convertTree(root) {
  if (!(root instanceof Element)) return;
  convertTitle(root);
  for (const el of root.querySelectorAll('[title]')) convertTitle(el);
}

export default function TooltipLayer() {
  const [tip, setTip] = useState(null); // { text, x, y, place }
  const bubbleRef = useRef(null);
  const anchorRef = useRef(null);
  const timerRef = useRef(0);

  // Titles become data-tip as soon as they exist — including ones React writes
  // later when a title prop changes.
  useEffect(() => {
    convertTree(document.body);
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') convertTitle(r.target);
        else for (const n of r.addedNodes) convertTree(n);
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    function hide() {
      clearTimeout(timerRef.current);
      anchorRef.current = null;
      setTip(null);
    }
    function show(el) {
      const text = el.getAttribute('data-tip');
      if (!text) return;
      anchorRef.current = el;
      const r = el.getBoundingClientRect();
      setTip({ text, anchor: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } });
    }
    // Hover. elementFromPoint rather than the event target, because a DISABLED
    // button does not reliably receive pointer events itself — and a disabled
    // button is exactly where "why can't I press this" belongs.
    let raf = 0;
    let last = null;
    function onMove(e) {
      if (e.pointerType === 'touch') return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const el = under?.closest?.('[data-tip]') || null;
        if (el === last) return;
        last = el;
        clearTimeout(timerRef.current);
        if (!el) { hide(); return; }
        if (anchorRef.current) { show(el); return; }   // moving between hints: no second wait
        timerRef.current = setTimeout(() => show(el), HOVER_DELAY_MS);
      });
    }
    function onLeaveWindow() { last = null; hide(); }
    // Keyboard: shown on focus, but only focus the keyboard produced.
    function onFocusIn(e) {
      const el = e.target?.closest?.('[data-tip]');
      if (!el) return;
      let keyboard = true;
      try { keyboard = e.target.matches(':focus-visible'); } catch { /* old browser — show it */ }
      if (keyboard) { clearTimeout(timerRef.current); show(el); }
    }
    function onKey(e) { if (e.key === 'Escape') hide(); }
    function onDown() { last = null; hide(); }

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerdown', onDown, true);
    document.documentElement.addEventListener('mouseleave', onLeaveWindow);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(timerRef.current);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerdown', onDown, true);
      document.documentElement.removeEventListener('mouseleave', onLeaveWindow);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Place it once it has a size: centred above the element, flipped below when
  // there is no room above, and kept EDGE px inside the window either way.
  useEffect(() => {
    const b = bubbleRef.current;
    if (!tip || !b) return;
    const { anchor } = tip;
    const bw = b.offsetWidth;
    const bh = b.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    let top = anchor.top - bh - 8;
    let place = 'above';
    if (top < EDGE) { top = anchor.bottom + 8; place = 'below'; }
    if (top + bh > vh - EDGE) top = Math.max(EDGE, vh - EDGE - bh);
    let left = (anchor.left + anchor.right) / 2 - bw / 2;
    left = Math.max(EDGE, Math.min(left, vw - EDGE - bw));
    b.style.left = `${Math.round(left)}px`;
    b.style.top = `${Math.round(top)}px`;
    b.dataset.place = place;
    b.classList.add('is-shown');
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={bubbleRef} className="app-tip" role="tooltip">{tip.text}</div>,
    document.body,
  );
}
