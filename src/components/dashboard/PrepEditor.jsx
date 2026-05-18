import { useEffect, useState } from 'react';

// Per-participant prep editor. Opened from a participant's row in the
// session dashboard so a trainer can tweak or fill in prep without
// re-uploading the spreadsheet.
//
// `prepForParticipant` shape: { [sectionId]: { id, content, updated_at } }
// `saveOne(payload)`: ({ participantId, sectionId, content }) -> server
export default function PrepEditor({
  open, onClose, participant, sections, prepForParticipant, saveOne,
}) {
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    if (!open) return;
    const seed = {};
    for (const s of sections) {
      seed[s.id] = prepForParticipant?.[s.id]?.content || '';
    }
    setDrafts(seed);
  }, [open, sections, prepForParticipant]);

  if (!open || !participant) return null;

  async function commit(sectionId) {
    setSavingId(sectionId);
    await saveOne({
      participantId: participant.id,
      sectionId,
      content: drafts[sectionId] || '',
    });
    setSavingId(null);
  }

  return (
    <div className="modal-backdrop visible" onClick={onClose}>
      <div className="modal-card prep-editor-modal" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <h2>📎 Prep data — {participant.full_name || '(unnamed)'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>
            One prep entry per exercise. Saved when you leave a field. Clear a
            field to remove that prep.
          </p>
          {sections.length === 0 && <p className="muted">No exercises in this workbook yet.</p>}
          {sections.map(sec => (
            <div className="prep-editor-row" key={sec.id}>
              <label className="form-label">{sec.title}</label>
              <textarea
                className="form-input"
                rows={3}
                value={drafts[sec.id] || ''}
                onChange={e => setDrafts(d => ({ ...d, [sec.id]: e.target.value }))}
                onBlur={() => commit(sec.id)}
                placeholder="Optional prep content for this exercise (PNR, scenario, ticket number…)."
              />
              {savingId === sec.id && <span className="muted" style={{ fontSize: '0.8rem' }}>Saving…</span>}
            </div>
          ))}
        </div>
        <footer className="modal-foot">
          <div style={{ flex: 1 }} />
          <button onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}
