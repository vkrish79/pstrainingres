// The contents rail: every chapter and exercise, with the page it starts on.
//
// This needs no query of its own. A chapter carries startsPage, so the paginator
// has already decided where each one begins — the outline is that decision read
// back out of `pages`, not a second guess at it.
//
// Twenty-four entries do not fit 599px of desk, so the list scrolls. Folding the
// exercises under their chapter was the alternative; it was rejected because the
// exercise is the thing a trainer is actually looking for, and hiding it behind a
// disclosure puts two clicks in front of the one job this rail has.
export default function BookContents({ outline, spread, onJump }) {
  // What is on screen right now: everything whose page is in this spread. If the
  // spread opens mid-chapter nothing matches, so fall back to the last entry
  // before it — the reader is still inside that chapter and the rail should say
  // so rather than highlighting nothing.
  const onScreen = new Set(
    outline.filter(o => spread && (o.page === spread[0] || o.page === spread[1])).map(o => o.key),
  );
  let contextKey = null;
  if (onScreen.size === 0 && spread) {
    for (const o of outline) {
      if (o.page <= spread[0]) contextKey = o.key; else break;
    }
  }

  return (
    <nav className="bk-rail" aria-label="Contents">
      <h4>Contents</h4>
      <ul className="bk-toc">
        {outline.map(o => {
          const here = onScreen.has(o.key);
          const ctx = o.key === contextKey;
          return (
            <li key={o.key} className={o.kind === 'heading' ? 'sub' : ''}>
              <button
                type="button"
                className={`bk-toc-b ${here ? 'on' : ''} ${ctx ? 'ctx' : ''}`}
                onClick={() => onJump(o.page)}
                aria-current={here ? 'true' : undefined}
              >
                <span className="bk-toc-t">{o.title}</span>
                <span className="bk-toc-p">{o.page + 1}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
