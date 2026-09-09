import { useEffect, useRef, useState } from 'react';

// Adding a block. Three chips for the types authors reach for constantly, and
// everything else behind "More types".
//
// WHY NOT SEVEN BUTTONS IN A ROW, which is what this replaces:
// .add-block-row was display:flex with no flex-wrap and seven children, so the
// buttons did not overflow — they COMPRESSED, and the labels broke inside them.
// At 1000px every one of the seven wrapped to two lines; at 720px
// "+ Fill-in-the-blank" broke across three. Seven equal-weight controls also
// gave no hint that three of them are the everyday ones.
//
// The split is by how often a type is used, not by what it is. A paper is
// mostly prose and fields; card sorts are occasional. One click for the common
// case, two for the rest, and the row stops growing when an eighth type lands.
//
// POSITION IS A PARAMETER, not an afterthought. `insertAfterIndex` is null for
// the row at the foot of a section (append, as before) and a block's index for
// the insertion points between blocks. Both callers use this one component, so
// the two paths cannot drift.
export default function AddBlockMenu({
  onAdd,                    // (blockType) => void
  allowInteractive = false,
  compact = false,          // between-blocks form: menu only, no chips
  label = 'More types',
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const firstItemRef = useRef(null);

  // Close on Escape or a click outside. Escape returns focus to the trigger so
  // a keyboard user is not dropped at the top of the document.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        wrapRef.current?.querySelector('.addblock-trigger')?.focus();
      }
    }
    function onClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // Move focus into the menu when it opens, so it is operable without a mouse.
  useEffect(() => { if (open) firstItemRef.current?.focus(); }, [open]);

  function choose(type) {
    setOpen(false);
    onAdd(type);
  }

  const interactive = [
    ['fill_blank', '⌷', 'Fill-in-the-blank'],
    ['card_sort', '⊞', 'Card sort'],
    ['match_pairs', '⇄', 'Match pairs'],
    ['reorder', '↕', 'Reorder'],
  ];

  return (
    <div className={`addblock ${compact ? 'addblock-compact' : ''}`} ref={wrapRef}>
      {!compact && (
        <>
          <button type="button" className="addblock-chip" onClick={() => choose('prose')}>
            <span className="addblock-glyph" aria-hidden>¶</span> Prose
          </button>
          <button type="button" className="addblock-chip" onClick={() => choose('field')}>
            <span className="addblock-glyph" aria-hidden>▭</span> Field
          </button>
          <button type="button" className="addblock-chip" onClick={() => choose('table')}>
            <span className="addblock-glyph" aria-hidden>▦</span> Table
          </button>
        </>
      )}

      {/* On a workbook there are no interactive types, so "More types" would
          open a menu holding nothing new. Drop it entirely there. */}
      {(allowInteractive || compact) && (
        <>
          <button
            type="button"
            className={`addblock-chip addblock-trigger ${open ? 'is-open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
          >
            {compact ? <><span className="addblock-glyph" aria-hidden>+</span> Add block</> : label}
            <span className="addblock-caret" aria-hidden>▾</span>
          </button>

          {open && (
            <div className="addblock-menu" role="menu">
              {compact && (
                <>
                  <div className="addblock-group">Content</div>
                  <MenuItem ref={firstItemRef} glyph="¶" onSelect={() => choose('prose')}>Prose</MenuItem>
                  <div className="addblock-group">Answerable</div>
                  <MenuItem glyph="▭" onSelect={() => choose('field')}>Field</MenuItem>
                  <MenuItem glyph="▦" onSelect={() => choose('table')}>Table</MenuItem>
                </>
              )}
              {allowInteractive && (
                <>
                  <div className="addblock-group">Interactive</div>
                  {interactive.map(([type, glyph, text], i) => (
                    <MenuItem
                      key={type}
                      glyph={glyph}
                      ref={!compact && i === 0 ? firstItemRef : null}
                      onSelect={() => choose(type)}
                    >
                      {text}
                    </MenuItem>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// forwardRef via a plain function: React 19 passes ref as a normal prop, so the
// component reads it straight off props rather than needing forwardRef.
function MenuItem({ glyph, children, onSelect, ref }) {
  return (
    <button type="button" className="addblock-item" role="menuitem" onClick={onSelect} ref={ref}>
      <span className="addblock-glyph" aria-hidden>{glyph}</span>
      {children}
    </button>
  );
}
