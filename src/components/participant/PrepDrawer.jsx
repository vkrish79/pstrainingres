import '../../styles/prep.css';

// Narrow right slide-in drawer showing all of a participant's prep: exercise-
// linked prep grouped by exercise, plus standalone "General / pre-work" items.
// PUSHES the page canvas (no overlay/backdrop) — the parent toggles a body
// class for that. Closes via the × button or Esc (handled by the parent).
// `prep` is keyed by section_id -> { content }; `standalone` is [{ label, content }].
export default function PrepDrawer({ open, onClose, sections, prep, standalone = [], className = '' }) {
  const withPrep = sections.filter(s => (prep[s.id]?.content || '').trim());
  const hasAny = withPrep.length > 0 || standalone.length > 0;

  return (
    <aside
      className={`prep-drawer ${className} ${open ? 'open' : ''}`}
      role="dialog"
      aria-label="Your prep"
      aria-hidden={!open}
    >
      <header className="prep-drawer-head">
        <span className="prep-drawer-head-label">Prep</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close prep">×</button>
      </header>
      <div className="prep-drawer-body">
        {!hasAny ? (
          <p className="prep-modal-empty">No prep has been assigned to you yet.</p>
        ) : (
          <div className="prep-modal-list">
            {withPrep.map(s => (
              <div key={s.id} className="prep-modal-item">
                <h4>{s.title}</h4>
                <div className="prep-modal-content">{prep[s.id].content}</div>
              </div>
            ))}
            {standalone.length > 0 && (
              <>
                <div className="prep-modal-group-label">General / pre-work</div>
                {standalone.map(s => (
                  <div key={s.id ?? s.label} className="prep-modal-item">
                    <h4>{s.label}</h4>
                    <div className="prep-modal-content">{s.content}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
