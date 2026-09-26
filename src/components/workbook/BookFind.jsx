import { useEffect, useRef } from 'react';

// Find in the workbook.
//
// Ctrl+F is useless in a book preview: the browser can only search the two pages
// currently in the DOM, and the off-screen measuring copy that holds the other
// thirty is visibility:hidden, so it finds nothing there either. The modal
// intercepts the shortcut and opens this instead, which searches what is in
// memory and can therefore see the whole book.
//
// Matches are shown per BLOCK, not per word. A prose block is raw HTML rendered
// through dangerouslySetInnerHTML, so wrapping a matched word in a <mark> would
// mean re-parsing and re-emitting that HTML — a real risk of mangling a table or
// dropping markup for a highlight nobody asked for. Washing the whole block
// instead says the same thing and cannot corrupt the page.
export default function BookFind({ query, onQuery, hits, active, onJump, onClose }) {
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const pageCount = new Set(hits.map(h => h.page)).size;

  return (
    <div className="bk-find" role="search">
      <div className="bk-find-top">
        <input
          ref={inputRef}
          id="bk-find-input"
          type="search"
          className="bk-find-input"
          placeholder="Find in this workbook"
          aria-label="Find in this workbook"
          value={query}
          onChange={e => onQuery(e.target.value)}
          // Enter only. Escape is deliberately NOT handled here even though this
          // is where it is pressed: the modal already has a window-level handler
          // for it, keydown is a discrete event, and React flushes a discrete
          // handler synchronously — so closing Find from here re-renders before
          // the same event finishes bubbling to window, which then reads "Find is
          // already shut" and closes the whole book. One owner, no race.
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onJump(e.shiftKey ? -1 : 1); }
          }}
        />
        <button type="button" className="bk-find-x" onClick={onClose} aria-label="Close find">×</button>
      </div>

      <p className="bk-find-count">
        {/* A one-letter query is not a search that found nothing, it is a search
            that has not started — the hit list bails under two characters. Saying
            "No matches" there tells the reader their workbook does not contain
            the letter they just typed. */}
        {query.trim() === ''
          ? 'Type to search every page'
          : query.trim().length < 2
            ? 'Keep typing…'
            : hits.length === 0
              ? 'No matches'
              : `${hits.length} match${hits.length === 1 ? '' : 'es'} on ${pageCount} page${pageCount === 1 ? '' : 's'} · ↵ next`}
      </p>

      <ul className="bk-find-hits">
        {hits.map((h, i) => (
          <li key={h.id}>
            <button
              type="button"
              className={`bk-find-hit ${i === active ? 'on' : ''}`}
              onClick={() => onJump(i - active)}
            >
              <b>{h.page + 1}</b>
              <span>
                {h.before}<em>{h.match}</em>{h.after}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
