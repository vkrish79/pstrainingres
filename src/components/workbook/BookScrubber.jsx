import { useEffect, useRef } from 'react';

// The spread scrubber: the whole book as a row of small rectangles.
//
// WHY THESE ARE DRAWN AND NOT RENDERED.
// A real thumbnail would mean laying out all 32 pages a second time, at a second
// scale, and measuring them — the measuring pass is already the expensive part of
// opening this modal and doing it twice to draw 16 stamps the size of a postage
// stamp is not a trade worth making. What a thumbnail is actually used for is
// shape: how long is this book, where do the chapters start, roughly how full is
// each page. All three survive being drawn from the heights we already measured.
export default function BookScrubber({ pages, byId, heights, spreads, spread, pageHeight, onJump }) {
  // The strip scrolls once a book is long enough, so the current spread has to
  // be carried into view with the reader. Sixteen stamps fit and this never
  // fires; a sixty-page workbook jumped to page 50 would otherwise leave the
  // strip sitting on spreads 1–20 with no marker anywhere in sight.
  const hereRef = useRef(null);
  useEffect(() => {
    hereRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [spread]);

  return (
    <div className="bk-scrub" role="group" aria-label="Jump to a spread">
      {spreads.map((sp, i) => {
        const opensChapter = [sp[0], sp[1]].some(
          p => p != null && (pages[p] || []).some(id => byId.get(id)?.kind === 'chapter'),
        );
        return (
          <button
            key={i}
            type="button"
            ref={i === spread ? hereRef : null}
            className={`bk-sp ${i === spread ? 'on' : ''} ${opensChapter ? 'ch' : ''}`}
            onClick={() => onJump(sp[0])}
            data-tip={`Pages ${sp[0] + 1}${sp[1] != null ? `–${sp[1] + 1}` : ''}`}
            aria-label={`Go to page ${sp[0] + 1}`}
            aria-current={i === spread ? 'true' : undefined}
          >
            {[sp[0], sp[1]].map((p, side) => (
              <i key={side} className="bk-sp-pg">
                {p != null && (pages[p] || []).map(id => {
                  const it = byId.get(id);
                  const h = Math.max(1, ((heights?.[id] || 0) / pageHeight) * 100);
                  return (
                    <b
                      key={id}
                      className={`bk-sp-m k-${it?.kind || 'block'}`}
                      style={{ height: `${Math.min(100, h)}%` }}
                    />
                  );
                })}
              </i>
            ))}
          </button>
        );
      })}
    </div>
  );
}
