import { useEffect, useState } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';

// Per-participant prep editor. Opened from a participant's row in the
// session dashboard so a trainer can tweak or fill in prep without
// re-uploading the spreadsheet.
//
// `prepForParticipant` shape: { [sectionId]: { id, content, updated_at } }
// `saveOne(payload)`: ({ participantId, sectionId, content }) -> server
// `onAllocate(participantId)`: draw one kit from the pool for this participant
//   (only relevant when `prepEnabled` and they have no prep yet).
export default function PrepEditor({
  open, onClose, participant, sections, prepForParticipant, saveOne, prepEnabled, onAllocate,
}) {
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [allocating, setAllocating] = useState(false);
  const [allocateMsg, setAllocateMsg] = useState('');
  // Set when the prep saved but its pool kit could not be updated.
  const [poolWarning, setPoolWarning] = useState('');

  useBodyScrollLock(open && !!participant);

  useEffect(() => {
    if (!open) return;
    const seed = {};
    for (const s of sections) {
      seed[s.id] = prepForParticipant?.[s.id]?.content || '';
    }
    setDrafts(seed);
    setAllocateMsg('');
    // Must clear too — the editor is reused across participants, and a warning
    // left over from the last save would be read as belonging to this one.
    setPoolWarning('');
  }, [open, sections, prepForParticipant]);

  if (!open || !participant) return null;

  const hasNoPrep = !prepForParticipant || Object.keys(prepForParticipant).length === 0;

  async function commit(sectionId) {
    setSavingId(sectionId);
    const { poolWarning } = await saveOne({
      participantId: participant.id,
      sectionId,
      content: drafts[sectionId] || '',
    });
    setSavingId(null);
    // The prep saved either way; this only reports the pool copy lagging.
    setPoolWarning(poolWarning || '');
  }

  async function handleAllocate() {
    setAllocating(true);
    setAllocateMsg('');
    const { data, error } = await onAllocate(participant.id);
    setAllocating(false);
    if (error) { setAllocateMsg(error.message); return; }
    const r = data?.results?.[0];
    if (r?.status === 'allocated') setAllocateMsg('Prep allocated from the pool.');
    else if (r?.status === 'exhausted') setAllocateMsg('The pool is out of kits — nothing to allocate.');
    else if (r?.status === 'skipped') setAllocateMsg('This participant already has prep.');
    else setAllocateMsg('No prep available to allocate.');
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
          {prepEnabled && hasNoPrep && onAllocate && (
            <div className="prep-allocate-banner">
              <span>This participant has no prep yet — draw a kit from the workbook pool.</span>
              <button type="button" className="ghost" onClick={handleAllocate} disabled={allocating}>
                {allocating ? 'Allocating…' : '↓ Allocate from pool'}
              </button>
            </div>
          )}
          {allocateMsg && <p className="prep-notice">{allocateMsg}</p>}
          {poolWarning && <p className="prep-warn">⚠ {poolWarning}</p>}
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
