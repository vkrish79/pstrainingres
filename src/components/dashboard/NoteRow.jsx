import { useEffect, useState } from 'react';

// Inline trainer-only note + flag editor for a single (participant, block) pair.
// Used in both the "By exercise" tile body and the "Participants" answers pane.
export default function NoteRow({ note, participantId, blockId, onSaveNote, onDeleteNote }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note?.note || '');
  const [flag, setFlag] = useState(!!note?.flag);
  const [busy, setBusy] = useState(false);

  // Keep local draft in sync with realtime updates (only when not editing)
  useEffect(() => {
    if (!editing) {
      setDraft(note?.note || '');
      setFlag(!!note?.flag);
    }
  }, [note, editing]);

  async function save() {
    setBusy(true);
    await onSaveNote({ participantId, blockId, note: draft, flag });
    setBusy(false);
    setEditing(false);
  }

  async function clear() {
    setBusy(true);
    await onDeleteNote({ participantId, blockId });
    setBusy(false);
    setEditing(false);
    setDraft(''); setFlag(false);
  }

  if (!editing) {
    const hasContent = note && (note.note?.trim() || note.flag);
    return (
      <div className={`exresp-note-row ${note?.flag ? 'is-flagged' : ''}`}>
        {hasContent ? (
          <>
            <span className="exresp-note-icon">{note.flag ? '🚩' : '💬'}</span>
            <span className="exresp-note-text">{note.note?.trim() || (note.flag ? 'Flagged' : '')}</span>
            <button className="ghost compact" onClick={() => setEditing(true)}>Edit</button>
          </>
        ) : (
          <button className="ghost compact exresp-add-note" onClick={() => setEditing(true)}>+ Note / flag</button>
        )}
      </div>
    );
  }

  return (
    <div className="exresp-note-edit">
      <textarea
        className="form-textarea compact"
        rows="2"
        placeholder="Trainer note (visible to trainers only)…"
        value={draft}
        onChange={e => setDraft(e.target.value)}
      />
      <label className="exresp-flag-toggle">
        <input type="checkbox" checked={flag} onChange={e => setFlag(e.target.checked)} />
        <span>🚩 Flag for follow-up</span>
      </label>
      <div className="exresp-note-actions">
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={() => { setEditing(false); setDraft(note?.note || ''); setFlag(!!note?.flag); }} disabled={busy}>Cancel</button>
        {note && <button className="ghost danger" onClick={clear} disabled={busy}>Delete</button>}
      </div>
    </div>
  );
}
