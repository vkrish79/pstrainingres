import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import '../../styles/table-wide.css';

// The table editor, opened wide over the page instead of inside the editor
// column. The form inside is the ordinary TableForm, with its own Save and
// Cancel; this only gives it room.
//
// Escape and a click on the backdrop do NOT close it. A table can carry a lot
// of unsaved work (cell kinds, wording, widths) and both are easy to do by
// accident; the way out is Save, Cancel or the × in the header, which cancels.
export default function TableWidePanel({ title, onClose, children }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // The width tool floats in its own portal; this lifts it above the panel.
    document.body.classList.add('tblw-open');
    return () => { document.body.style.overflow = prev; document.body.classList.remove('tblw-open'); };
  }, []);

  return createPortal(
    <div className="tblw-backdrop">
      <div className="tblw" role="dialog" aria-modal="true" aria-label={`Edit table: ${title}`}>
        <div className="tblw-head">
          <span className="tblw-kind" aria-hidden>▦</span>
          <span className="tblw-title">{title}</span>
          <span className="tblw-legend">
            <span><i className="tblw-sw tblw-sw--text" /> Text the participant reads</span>
            <span><i className="tblw-sw tblw-sw--input" /> Answer box</span>
            <span><i className="tblw-sw tblw-sw--mixed" /> Text with boxes</span>
          </span>
          <button type="button" className="tblw-close" onClick={onClose} aria-label="Close without saving" data-tip="Close without saving">×</button>
        </div>
        <div className="tblw-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
