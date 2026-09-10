import { useEffect, useRef, useState } from 'react';
import '../styles/kebab.css';

// A ⋯ button with a menu under it.
//
// The pattern was already in BlockListItem, written inline: open state, an
// Escape handler, an outside-mousedown handler, and a refocus on close. This
// is that, extracted, because the session dashboard needs it twice more — once
// in the header and once per participant row — and three hand-rolled copies of
// a focus-management effect is three chances to get one of them wrong.
//
// ITEMS ARE DATA, NOT CHILDREN. A caller passing JSX would have to remember to
// close the menu in every onClick; passing a list means this component closes
// it, every time, without the caller thinking about it.
//
//   items = [
//     { label: 'Export CSV', glyph: '↓', onClick, disabled },
//     { separator: true },
//     { label: 'Delete session', glyph: '✕', onClick, danger: true },
//   ]
//
// A falsy entry is skipped, so callers can write `cond && {...}` inline rather
// than building the array conditionally.
export default function KebabMenu({
  items = [],
  label = 'More actions',
  className = '',
  align = 'end',
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    function onKey(e) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      // Focus goes back to the button that opened the menu. BlockListItem did
      // this by querying '.block-kebab', which a shared component cannot do —
      // hence the ref.
      triggerRef.current?.focus();
    }
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const shown = items.filter(Boolean);
  if (shown.length === 0) return null;

  return (
    <span className={`kebab-wrap ${className}`} ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`icon-btn kebab-btn${open ? ' is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(o => !o)}
      >
        ⋯
      </button>

      {open && (
        <div className={`kebab-menu kebab-menu--${align}`} role="menu">
          {shown.map((item, i) => (
            item.separator ? (
              <div key={`sep${i}`} className="kebab-sep" role="separator" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`kebab-item${item.danger ? ' danger' : ''}`}
                disabled={item.disabled}
                onClick={() => { setOpen(false); item.onClick?.(); }}
              >
                {item.glyph && <span className="kebab-glyph" aria-hidden>{item.glyph}</span>}
                {item.label}
              </button>
            )
          ))}
        </div>
      )}
    </span>
  );
}
