import { useEffect } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';
import MaterialsList from '../MaterialsList.jsx';

// The program's handouts, in a drawer instead of a band across the top.
//
// They used to sit in a full-width strip above the paper — one thumbnail and
// about 1,250px of empty row beside it, costing 175px of every first screen
// forever so that a handout could be seen once. The exercises are what a
// participant came for, and on a 900px laptop only one question fitted above
// the fold.
//
// A drawer is not a new idea on this page: Notes and Prep are both right-hand
// drawers opened from the same row of buttons, each with a count in its label.
// The materials band was the only one of them paying rent, and this makes it
// consistent rather than introducing a fourth behaviour.
//
// MaterialsList is reused WHOLE — same thumbnails, same signed-URL fetch, same
// modal preview, and the same component the trainer's dashboard renders. Only
// the container is new; the drawer restyles the thumb grid into one column
// through .materials-drawer in dashboard.css.
export default function MaterialsDrawer({ open, onClose, materials, signedUrlFor, loading }) {
  useBodyScrollLock(open);

  // Esc closes. Bound only while open so it cannot swallow the key from the
  // material preview modal underneath it, which does its own Escape handling.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`materials-drawer-backdrop${open ? ' visible' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`materials-drawer${open ? ' open' : ''}`}
        role="dialog"
        aria-label="Program materials"
        aria-hidden={open ? undefined : 'true'}
      >
        <header className="materials-drawer-head">
          <span>Handouts</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close handouts" title="Close (Esc)">
            ×
          </button>
        </header>
        <div className="materials-drawer-body">
          {/* title="" — the drawer's own header already says what this is, and
              a second heading inside it reads as a subheading of nothing. */}
          <MaterialsList
            materials={materials}
            signedUrlFor={signedUrlFor}
            loading={loading}
            title=""
          />
        </div>
      </aside>
    </>
  );
}
