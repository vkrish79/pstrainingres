import { useEffect, useRef } from 'react';

// A page that BENDS as it turns, rather than pivoting flat like a card.
//
// HOW, AND WHY THIS WAY.
// A sheet of paper turning is a curved surface, and CSS has no curved surfaces —
// a single element can only ever be a flat plane, which is what made the first
// attempt read as a flipping card. The usual fix is to paint the page to a canvas
// and warp the bitmap, but that means a new dependency, a snapshot of every page,
// and text that goes soft mid-turn.
//
// Instead the page is sliced into vertical strips, each a narrow window onto the
// same live content, and the strips are hinged end to end. Enough of them and the
// polyline reads as a curve — the same trick a cylinder in a 3D engine uses. The
// content is real DOM throughout, so the type stays as sharp as the page it came
// from.
//
// The strips are positioned by composing the chain in JS rather than by nesting
// twelve divs: each strip's transform is the accumulated translate+rotate of all
// the strips before it, so they stay joined edge to edge however far the sheet
// bends. Nesting would have meant wrapping the page content twelve deep.
const STRIPS = 14;

// How much the sheet bows, over the life of the turn. Flat at both ends — paper
// is flat on the desk before you lift it and flat again when it lands — and
// deepest just after halfway, which is where a turning page actually looks most
// curved.
function bendAt(p) {
  return Math.sin(Math.PI * Math.min(1, Math.max(0, p))) ** 0.85;
}

// Ease: a gentle lift, a long glide, a soft landing — the shape of a hand
// letting a page fall rather than flicking it. The old curve front-loaded almost
// all the movement into the first third, which at any duration reads as a snap.
function ease(p) {
  return p < 0.5
    ? 2 * p * p
    : 1 - (-2 * p + 2) ** 2.2 / 2;
}

export default function BookLeaf({ pageWidth, pageHeight, direction = 'forward', duration = 1150, onDone, children }) {
  const hostRef = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) { doneRef.current?.(); return undefined; }

    const strips = [...host.querySelectorAll('[data-strip]')];
    const w = pageWidth / STRIPS;
    const sign = direction === 'forward' ? -1 : 1;

    // Honour a request for no motion: land immediately, no flight.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (still) { doneRef.current?.(); return undefined; }

    let raf = 0;
    const start = performance.now();

    const frame = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const p = ease(t);
      // Total sweep: a bit under half a turn, so the sheet never passes through
      // the facing page.
      const sweep = sign * 174 * p;
      // Curvature, as degrees of extra bend spread across the strips.
      const bow = sign * 46 * bendAt(t);

      // THE CHAIN IS BUILT FROM THE SPINE OUTWARDS, AND THE SPINE SWAPS SIDES.
      //
      // Turning forward, the leaf covers the right-hand page and is hinged on its
      // LEFT edge, so the chain starts at x=0 and walks rightwards, strip 0 first.
      // Turning back, the leaf covers the left-hand page and is hinged on its
      // RIGHT edge — so it starts at the far edge and walks leftwards, beginning
      // with the LAST strip. Walking the same way for both is what made the page
      // turn back-to-front: the sheet unrolled away from the spine instead of
      // away from the reader's hand.
      const fwd = direction === 'forward';
      const chain = fwd ? strips : [...strips].reverse();
      let x = fwd ? 0 : pageWidth;   // where the current strip's hinge edge sits
      let z = 0;
      let angle = 0;

      chain.forEach((el, k) => {
        // The strip at the spine carries the whole sweep; every strip adds its
        // share of the bow, so the free edge trails and the sheet bellies out.
        const a = (k === 0 ? sweep : 0) + (bow / STRIPS);
        angle += a;
        const rad = (angle * Math.PI) / 180;
        // Each strip's box sits at left:0, so translating by its hinge position
        // places it. Going back, the hinge is the strip's right edge, which is
        // one strip-width further along its own box.
        const tx = fwd ? x : x - w;
        el.style.transform = `translate3d(${tx}px, 0, ${z}px) rotateY(${angle}deg)`;
        // Shade by how far this strip has turned away from the light.
        el.style.filter = `brightness(${(0.72 + 0.28 * Math.abs(Math.cos(rad))).toFixed(3)})`;
        // Step to this strip's far edge, which is where the next one hinges.
        x += (fwd ? 1 : -1) * Math.cos(rad) * w;
        z += Math.sin(rad) * w * (fwd ? -1 : 1);
      });

      if (t < 1) raf = requestAnimationFrame(frame);
      else doneRef.current?.();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [pageWidth, direction, duration]);

  const stripW = pageWidth / STRIPS;

  return (
    <div
      ref={hostRef}
      className={`bk-leaf3 ${direction === 'forward' ? 'is-forward' : 'is-back'}`}
      style={{ width: pageWidth, height: pageHeight }}
      aria-hidden
    >
      {Array.from({ length: STRIPS }, (_, i) => (
        <div
          key={i}
          data-strip={i}
          className="bk-strip"
          style={{ width: stripW, height: pageHeight }}
        >
          {/* Each strip is a window onto the same page, slid sideways so it shows
              only its own slice. Half a pixel of overlap hides the seams that
              sub-pixel rounding would otherwise leave between them. */}
          <div
            className="bk-strip-inner"
            style={{ width: pageWidth, height: pageHeight, marginLeft: -i * stripW }}
          >
            {children}
          </div>
        </div>
      ))}
    </div>
  );
}
