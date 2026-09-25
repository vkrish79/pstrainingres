import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SkeletonLines } from '../Skeleton.jsx';
import { supabase } from '../../lib/supabase.js';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';
import Block from '../blocks/Block.jsx';
import BookLeaf from './BookLeaf.jsx';
import { paginate, pageScale, spreadsOf, spreadLabel } from '../../lib/bookPagination.js';
import '../../styles/workbook.css';
import '../../styles/book-preview.css';

// A workbook as a book: two facing pages, turned rather than scrolled.
//
// WHY THIS MEASURES INSTEAD OF JUST LAYING CONTENT OUT.
// On screen there is no such thing as a page. CSS can break content across
// PRINTED pages, but nothing in the browser will tell a div "stop at 1000px and
// continue overleaf". So the only way to get real pages is to render everything
// once, invisibly, at exactly the width a page gives it, measure each piece, and
// then decide where the pages end — which is what lib/bookPagination.js does.
//
// The measuring pass is deliberately the same markup as the visible one, at the
// same width, so the heights it reports are the heights that will actually be
// used. Measuring a simplified stand-in is how a paginator ends up off by a line
// on page nine.
export default function WorkbookPreviewModal({ workbookId, title, onClose }) {
  useBodyScrollLock();

  const [sections, setSections] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [heights, setHeights] = useState(null);   // { [itemId]: px }
  const [spread, setSpread] = useState(0);

  const measureRef = useRef(null);
  // The key handler is bound once; go() changes every render, so it is reached
  // through a ref rather than by rebinding the listener on each one.
  const goRef = useRef(() => {});

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === 'PageDown') goRef.current(1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') goRef.current(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const { data: secs, error: e1 } = await supabase
          .from('sections')
          .select('id, title, order_index, kind')
          .eq('workbook_id', workbookId)
          .order('order_index');
        if (e1) throw e1;
        const ids = (secs || []).map(s => s.id);
        const { data: blks, error: e2 } = ids.length
          ? await supabase
            .from('blocks')
            .select('id, section_id, block_type, config, order_index')
            .in('section_id', ids)
            .order('order_index')
          : { data: [], error: null };
        if (e2) throw e2;
        if (cancelled) return;
        setSections(secs || []);
        setBlocks(blks || []);
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workbookId]);

  // The reading order: each section's heading, then its blocks. A heading carries
  // keepWithNext so it can never be the last thing on a page, and a `group`
  // section — the Word-H1 banner the importer makes — starts a fresh page, which
  // is what makes chapters begin where a reader expects.
  const items = useMemo(() => {
    const bySection = new Map();
    for (const b of blocks) {
      if (!bySection.has(b.section_id)) bySection.set(b.section_id, []);
      bySection.get(b.section_id).push(b);
    }
    const out = [];
    for (const s of sections) {
      const isChapter = s.kind === 'group';
      out.push({
        id: `h:${s.id}`,
        kind: isChapter ? 'chapter' : 'heading',
        section: s,
        keepWithNext: true,
        startsPage: isChapter,
      });
      for (const b of (bySection.get(s.id) || [])) {
        out.push({ id: `b:${b.id}`, kind: 'block', block: b });
      }
    }
    return out;
  }, [sections, blocks]);

  // Measure once the content is in the DOM, and again if fonts arrive late —
  // a webfont swapping in after the first pass changes every height, and a book
  // paginated against the fallback font is wrong from the first page.
  useLayoutEffect(() => {
    if (loading || !measureRef.current || items.length === 0) return undefined;
    let cancelled = false;
    const read = () => {
      if (cancelled || !measureRef.current) return;
      const next = {};
      measureRef.current.querySelectorAll('[data-item]').forEach((el) => {
        // getBoundingClientRect, not offsetHeight: it is fractional, and rounding
        // 60 items down by half a pixel each loses most of a line per page.
        next[el.dataset.item] = el.getBoundingClientRect().height;
      });
      setHeights(next);
    };
    read();
    if (document.fonts?.ready) document.fonts.ready.then(read).catch(() => {});
    return () => { cancelled = true; };
  }, [loading, items]);

  // These three mirror --bk-page-h / --bk-page-w / --bk-page-pad in the
  // stylesheet. The paginator measures in px, so the two must agree or the last
  // line of every page is cut.
  const PAGE_H = 980;
  const PAGE_W = 620;
  const PAGE_PAD = 35.2;   // 2.2rem
  // How long a page takes to turn. 620ms was too quick to read as paper — the
  // sheet was down before the eye had followed it, which made the bend register
  // as a flicker rather than a movement. A real page turn is closer to a second.
  const TURN_MS = 1150;

  // Shrink the spread to whatever room the window gives, WITHOUT changing the
  // page geometry. The paginator worked in unscaled pixels, so the pages must
  // keep those dimensions; only the picture of them is scaled. A 1024px-tall
  // spread on a 768px laptop would otherwise be a book you scroll, which is the
  // one thing a book is not.
  const bodyRef = useRef(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const fit = () => {
      const styles = getComputedStyle(el);
      const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const availH = el.clientHeight - padY;
      const availW = el.clientWidth - padX;
      const pageOuterH = PAGE_H + 2 * 35.2;      // 2.2rem of padding, top and bottom
      const spreadW = 2 * 620;                   // two pages, --bk-page-w each
      if (availH <= 0 || availW <= 0) return;
      // Scale UP as well as down, which the first version refused to do — it
      // capped at 1, so on a big screen the book stayed at its 620px-a-page
      // drawing size with the rest of the monitor empty around it. Text is
      // vector, so growing it stays sharp.
      //
      // The ceiling is there because past about double size the type is larger
      // than anything else in the app and the book stops reading as a document.
      setScale(Math.max(0.2, Math.min(2.2, availH / pageOuterH, availW / spreadW)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  const pages = useMemo(() => {
    if (!heights) return [];
    return paginate(
      items.map(it => ({
        id: it.id,
        height: heights[it.id] ?? 0,
        keepWithNext: it.keepWithNext,
        startsPage: it.startsPage,
      })),
      PAGE_H,
    );
  }, [items, heights]);

  const byId = useMemo(() => new Map(items.map(it => [it.id, it])), [items]);
  const spreads = useMemo(() => spreadsOf(pages.length), [pages]);
  const current = spreads[Math.min(spread, Math.max(0, spreads.length - 1))] || null;

  // Clamp if the content shrank under us (a re-measure with fewer pages).
  useEffect(() => {
    if (spread > 0 && spread >= spreads.length) setSpread(Math.max(0, spreads.length - 1));
  }, [spread, spreads.length]);

  // ── Turning a page ───────────────────────────────────────────────────────
  //
  // `turn` holds the leaf in flight: which page's content is on it and which way
  // it is going. The spread underneath changes IMMEDIATELY; the leaf is a copy of
  // the page just left, laid on top and rotated away. So nothing has to be kept
  // in step mid-animation — when the leaf is removed, what was already there is
  // simply correct. Swapping the pages when the animation ENDS is the version
  // that goes wrong the moment someone clicks twice quickly.
  const [turn, setTurn] = useState(null);   // { page, dir } | null
  const turnTimer = useRef(null);
  useEffect(() => () => clearTimeout(turnTimer.current), []);

  function go(delta) {
    const target = Math.min(Math.max(0, spread + delta), Math.max(0, spreads.length - 1));
    if (target === spread) return;
    const from = spreads[spread];
    // Forward turns the right-hand page over; back turns the left-hand one.
    const leafPage = delta > 0 ? from?.[1] : from?.[0];
    setSpread(target);
    clearTimeout(turnTimer.current);
    if (leafPage == null) { setTurn(null); return; }
    setTurn({ page: leafPage, dir: delta > 0 ? 'forward' : 'back' });
    // BookLeaf calls onDone when it lands, including immediately under reduced
    // motion. This timer is only a backstop, in case a dropped frame or a
    // backgrounded tab means that call never arrives and the leaf is left
    // covering the page.
    turnTimer.current = setTimeout(() => setTurn(null), TURN_MS + 400);
  }
  goRef.current = go;

  function renderItem(it) {
    if (!it) return null;
    if (it.kind === 'chapter') {
      return <h2 className="bk-chapter">{it.section.title}</h2>;
    }
    if (it.kind === 'heading') {
      return <h3 className="bk-heading">{it.section.title}</h3>;
    }
    // preview, not just readOnly: show the question with its fields, empty and
    // inert, the way a participant meets it — not a dash where an answer isn't.
    return <Block block={it.block} value={undefined} onChange={() => {}} readOnly preview />;
  }

  const ready = !loading && !error && heights && pages.length > 0;
  const empty = !loading && !error && items.length === 0;

  return (
    <div className="modal-backdrop visible" onClick={onClose}>
      <div className="modal-card bk-modal" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <h2>📖 {title || 'Workbook'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="modal-body bk-body" ref={bodyRef} style={{ '--bk-scale': scale }}>
          {loading && <SkeletonLines rows={6} label="Opening the workbook…" />}
          {error && <p className="error">{error}</p>}
          {empty && <p className="muted">This workbook has no content yet.</p>}
          {!loading && !error && !heights && items.length > 0 && (
            <SkeletonLines rows={6} label="Laying out the pages…" />
          )}

          {ready && current && (
            <div className="bk-stage">
            <div className="bk-spread">
              {[current[0], current[1]].map((pageIndex, side) => (
                <div
                  key={side}
                  className={`bk-page ${pageIndex == null ? 'is-blank' : ''}`}
                  aria-label={pageIndex == null ? 'Blank page' : `Page ${pageIndex + 1}`}
                >
                  {pageIndex != null && (
                    <>
                      <div
                        className="bk-page-content"
                        style={{ '--bk-page-fit': pageScale(pages[pageIndex], heights, PAGE_H) }}
                      >
                        {pages[pageIndex].map(id => (
                          <div key={id} className="bk-item">{renderItem(byId.get(id))}</div>
                        ))}
                      </div>
                      <div className="bk-page-number">{pageIndex + 1}</div>
                    </>
                  )}
                </div>
              ))}
              {/* The page being left, bending away over the spread. A copy, so
                  what is underneath is already the new spread. */}
              {turn && pages[turn.page] && (
                <BookLeaf
                  pageWidth={PAGE_W}
                  pageHeight={PAGE_H + PAGE_PAD * 2}
                  direction={turn.dir}
                  duration={TURN_MS}
                  onDone={() => setTurn(null)}
                >
                  <div
                    className="bk-page-content"
                    style={{ '--bk-page-fit': pageScale(pages[turn.page], heights, PAGE_H) }}
                  >
                    {pages[turn.page].map(id => (
                      <div key={id} className="bk-item">{renderItem(byId.get(id))}</div>
                    ))}
                  </div>
                </BookLeaf>
              )}
            </div>
            </div>
          )}
        </div>

        <footer className="modal-foot bk-foot">
          <button
            type="button"
            className="ghost"
            disabled={spread === 0}
            onClick={() => go(-1)}
          >
            ◀ Back
          </button>
          <span className="bk-pageno">
            {ready ? spreadLabel(current, pages.length) : ''}
          </span>
          <button
            type="button"
            className="ghost"
            disabled={!ready || spread >= spreads.length - 1}
            onClick={() => go(1)}
          >
            Next ▶
          </button>
          <button type="button" className="ghost bk-close" onClick={onClose}>Close</button>
        </footer>

        {/* The measuring pass. Off-screen rather than display:none — a hidden
            element has no layout and every height would come back 0. */}
        {!loading && !error && items.length > 0 && (
          <div className="bk-measure" aria-hidden ref={measureRef}>
            <div className="bk-page-content">
              {items.map(it => (
                <div key={it.id} data-item={it.id} className="bk-item">{renderItem(it)}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
