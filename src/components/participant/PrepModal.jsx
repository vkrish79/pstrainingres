import '../../styles/prep.css';

// Read-only modal: shows all of a participant's prep across exercises in one
// place. Opened from the "Prep" button in the participant workbook hero.
// `prep` is keyed by section_id -> { content }.
export default function PrepModal({ open, onClose, sections, prep }) {
  if (!open) return null;
  const withPrep = sections.filter(s => (prep[s.id]?.content || '').trim());

  return (
    <div className="modal-backdrop visible" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <h2>🎯 Your prep</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>
            Pre-work assigned by your trainer for this session.
          </p>
          {withPrep.length === 0 ? (
            <p className="prep-modal-empty">No prep has been assigned to you yet.</p>
          ) : (
            <div className="prep-modal-list">
              {withPrep.map(s => (
                <div key={s.id} className="prep-modal-item">
                  <h4>{s.title}</h4>
                  <div className="prep-modal-content">{prep[s.id].content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
