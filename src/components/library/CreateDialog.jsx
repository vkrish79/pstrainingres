import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import '../../styles/editor.css';

// ONE DOOR INTO THE LIBRARY. Making a program, an assessment or a workbook is
// the same act — name a template, then go and fill it in — and it used to open
// three different kinds of door: an inline field in the bar for two of them and
// a whole page at /workbooks/new for the third.
//
// This is the shell all three now share. It is a centred dialog and not a
// right-edge slide-over on purpose: that motion already means "the details of
// the row you clicked" on all three library pages, and the same edge meaning
// two things is worse than the inconsistency it would be fixing.
//
// The shell owns the frame, the buttons, Esc and the import route; each page
// supplies its own fields as children, because the interesting difference
// between the three is what they need at birth, not how they look.
export default function CreateDialog({
  heading,
  blurb,
  submitLabel,
  importTo,          // optional: where "or import" goes, if the object has one
  importLabel,
  busy,
  error,
  canSubmit,
  onClose,
  onSubmit,
  children,
}) {
  const cardRef = useRef(null);

  // Esc closes, but never mid-write: a dialog that vanishes while the insert is
  // in flight leaves the user unsure whether it happened.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // Typable the moment it opens — this is a form you came here to fill in.
  useEffect(() => {
    cardRef.current?.querySelector('input, select, textarea')?.focus();
  }, []);

  return (
    <div className="modal-backdrop visible" onClick={() => { if (!busy) onClose(); }}>
      <form
        ref={cardRef}
        className="modal-card create-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        onClick={e => e.stopPropagation()}
        onSubmit={onSubmit}
      >
        <header className="modal-head">
          <div>
            <h2>{heading}</h2>
            {blurb && <p className="create-dialog-blurb">{blurb}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </header>

        <div className="modal-body">
          {children}
          {error && <p className="error">{error}</p>}
        </div>

        <footer className="modal-foot">
          {/* Import stops being a separate door in the bar and becomes the
              other way through this one. Programs have no importer, so they
              simply pass nothing. */}
          {importTo && <Link to={importTo} className="ghost-link">↑ {importLabel}</Link>}
          <span className="create-dialog-gap" />
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" disabled={busy || !canSubmit}>{busy ? 'Creating…' : submitLabel}</button>
        </footer>
      </form>
    </div>
  );
}
