import { useEffect } from 'react';

// The slide-over the assessment and bank editors open their setup panels in
// (prep, scorecard, organise, save to bank…). It reuses the library pages'
// .wb-rail-panel, so there is still one way a panel enters this app.
//
// ALWAYS MOUNTED, open or not. The panels inside load their own data and some
// report to the page (the prep template feeds the Prep chip); unmounting them
// when the drawer shut would stop that and blank the chips. Closed, the panel
// is visibility:hidden (out of the tab order) and aria-hidden. Because it is
// already mounted, the slide has a previous state to travel from — the
// "mount and open a frame apart" trap does not arise.
export default function SetupDrawer({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div className={`wb-rail-backdrop${open ? ' visible' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside
        className={`wb-rail-panel setup-drawer${open ? ' open' : ''}`}
        role="dialog"
        aria-modal={open || undefined}
        aria-label={title}
        aria-hidden={!open}
      >
        <header className="setup-drawer-head">
          <h2>{title}</h2>
          <button type="button" className="setup-drawer-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="setup-drawer-body">{children}</div>
      </aside>
    </>
  );
}
