// Packing a workbook into fixed-height pages, the way a printed book does it.
//
// The browser will not do this for us. CSS can break content across PRINTED
// pages, but on screen there is no such thing as a page — so a book preview has
// to measure each piece of content and decide itself where each page ends.
//
// This file is the deciding half and is pure: it takes heights that something
// else measured and returns which items land on which page. Keeping it separate
// from the measuring means the rule can be tested without a browser, and the
// awkward cases below are all rules that are easy to get wrong and invisible
// when you do.

// items: [{ id, height, keepWithNext?, startsPage? }]
//   height       — measured, in px, at the page's content width
//   keepWithNext — a heading: it must not be the last thing on a page, or a
//                  reader turns over to find the exercise it announces
//   startsPage   — force a new page before this item (a new chapter)
//
// Returns [[id, id, …], …] — one array per page, in order.
export function paginate(items, pageHeight) {
  const pages = [];
  let page = [];
  let used = 0;

  const flush = () => {
    if (page.length) pages.push(page);
    page = [];
    used = 0;
  };

  const list = items || [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const h = Math.max(0, Number(it.height) || 0);

    if (it.startsPage && page.length) flush();

    // Taller than a page on its own. It cannot be made to fit, so give it a page
    // of its own rather than wedging it under something else and overflowing
    // twice. The renderer is responsible for what an oversized block looks like;
    // pretending it fits is what would be wrong here.
    if (h > pageHeight) {
      flush();
      pages.push([it.id]);
      continue;
    }

    if (used + h > pageHeight && page.length) flush();

    page.push(it.id);
    used += h;

    // A heading that has ended up last on its page drags itself over to the next
    // one. Done after placing, not before, because whether it is last is only
    // knowable once the following item has been measured against the space left.
    if (it.keepWithNext) {
      const next = list[i + 1];
      const nextH = next ? Math.max(0, Number(next.height) || 0) : 0;
      const nextFits = next && !next.startsPage && used + nextH <= pageHeight;
      const nextIsOversized = next && nextH > pageHeight;
      if (next && !nextFits && !nextIsOversized && page.length > 1) {
        // Move the heading to the next page — but only if it is not the sole
        // occupant, or we would loop moving one item onto an empty page forever.
        page.pop();
        used -= h;
        flush();
        page.push(it.id);
        used += h;
      }
    }
  }
  flush();
  return pages;
}

// How much a page's content must be shrunk to fit, as a scale factor.
//
// Normally 1: the packer already guaranteed the page fits. The exception is a
// single item taller than a whole page — a twenty-line table, a long passage of
// prose — which cannot be split and so gets a page of its own regardless. Left
// alone it would be CLIPPED, because a page has overflow:hidden and a page that
// scrolls is not a page. Scaling that one page's content down loses nothing and
// costs a little type size on a rare page, which is what a printed book does
// with a fold-out.
//
// Also acts as a safety net: if a measurement is ever slightly off and a page
// comes out a few pixels over, it shrinks imperceptibly instead of cutting a line.
export function pageScale(ids, heights, pageHeight) {
  if (!ids?.length || !pageHeight) return 1;
  const total = ids.reduce((s, id) => s + (Number(heights?.[id]) || 0), 0);
  if (total <= pageHeight) return 1;
  return pageHeight / total;
}

// Pages are read two at a time. A spread holds pages 1–2, 3–4 and so on; the
// last spread may hold one. Returns [[pageIndex, pageIndex|null], …].
//
// Deliberately NOT the real-book convention of a lone first page followed by
// 2–3, 4–5: a workbook opens on its first exercise, not on a cover, and pairing
// them from the start keeps a spread's left page always odd-numbered, which is
// what the page indicator reads out.
export function spreadsOf(pageCount) {
  const out = [];
  for (let i = 0; i < pageCount; i += 2) {
    out.push([i, i + 1 < pageCount ? i + 1 : null]);
  }
  return out;
}

// Which spread is page `pageIndex` on?
export function spreadForPage(pageIndex) {
  return Math.floor(Math.max(0, pageIndex) / 2);
}

// "4–5 of 26", or "26 of 26" on a lone last page. 1-based for the reader.
export function spreadLabel(spread, pageCount) {
  if (!spread) return '';
  const [l, r] = spread;
  const left = l + 1;
  if (r == null) return `${left} of ${pageCount}`;
  return `${left}–${r + 1} of ${pageCount}`;
}
