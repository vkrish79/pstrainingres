import '../../styles/drawer.css';
import '../../styles/prep.css';

// Right slide-in drawer showing all of a participant's prep in one place:
// exercise-linked prep grouped by exercise, plus standalone "General / pre-work"
// items. Shares the slide-in shell with NotesDrawer. Closes on backdrop click,
// the × button, or Esc (handled by the parent's keydown listener).
// `prep` is keyed by section_id -> { content }; `standalone` is [{ label, content }].
export default function PrepDrawer({ open, onClose, sections, prep, standalone = [] }) {
  const withPrep = sections.filter(s => (prep[s.id]?.content || '').trim());
  const hasAny = withPrep.length > 0 || standalone.length > 0;

  return (
    <>
      <div
        className={`notes-drawer-backdrop ${open ? 'visible' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`notes-drawer ${open ? 'open' : ''}`}
        role="dialog"
        aria-label="Your prep"
        aria-hidden={!open}
      >
        <header className="notes-drawer-head">
          <h2>🎯 Your prep</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close prep">×</button>
        </header>
        <div className="notes-drawer-body prep-drawer-scroll">
          <p className="muted" style={{ marginTop: 0 }}>Pre-work assigned by your trainer for this session.</p>
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
                    <div key={s.id} className="prep-modal-item">
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
    </>
  );
}
