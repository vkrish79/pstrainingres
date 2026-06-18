import { useMemo, useState } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';
import '../../styles/prep-grid.css';

// Session-scoped prep grid: rows = participants, columns = prep exercises, cells
// = each participant's current prep (a PNR / ticket). Read-only display; to fix
// a bad exercise you click its heading → a modal to paste fresh PNRs (one per
// participant) → submit replaces that whole column. Writes to participant_prep,
// which is realtime, so the participant's prep drawer updates instantly.
//
// props: participants [{id, full_name}], sections [{id, title, order_index}],
//   prep { [participantId]: { [sectionId]: { content } } }, onSave(...) -> {error?}
export default function SessionPrepGrid({ participants = [], sections = [], prep = {}, onSave }) {
  const [replaceSection, setReplaceSection] = useState(null);

  const columns = useMemo(() => {
    const ids = new Set();
    for (const p of participants) for (const sid of Object.keys(prep[p.id] || {})) ids.add(sid);
    return sections
      .filter(s => ids.has(s.id))
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  }, [participants, sections, prep]);

  if (!participants.length) return <p className="muted">No participants in this session yet.</p>;
  if (!columns.length) return <p className="muted">No prep has been allocated to participants yet.</p>;

  return (
    <div className="prep-grid">
      <p className="pg-edit-hint">Click an exercise heading to replace that exercise's prep for every participant — paste the fresh PNRs and submit. Changes show in the participant's prep drawer instantly.</p>
      <div className="pg-scroll">
        <table className="pg-table">
          <thead>
            <tr>
              <th className="pg-rowhead">Participant</th>
              {columns.map(s => (
                <th key={s.id} className="pg-col-th">
                  <button type="button" className="pg-col-replace" onClick={() => setReplaceSection(s)} title={`Replace ${s.title} prep`}>
                    {s.title}<span className="pg-col-icon" aria-hidden> ↻</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {participants.map(p => (
              <tr key={p.id}>
                <td className="pg-rowhead">{p.full_name || '(unnamed)'}</td>
                {columns.map(s => {
                  const v = prep[p.id]?.[s.id]?.content || '';
                  return <td key={s.id} className={`pg-cell ${v ? '' : 'pg-empty'}`}>{v || '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {replaceSection && (
        <ReplaceColumnModal
          section={replaceSection}
          participants={participants}
          prep={prep}
          onClose={() => setReplaceSection(null)}
          onSave={onSave}
        />
      )}
    </div>
  );
}

// Modal: paste fresh PNRs (one per participant, in row order) → replace that
// exercise's prep for everyone. Blank lines are skipped (never clears prep).
function ReplaceColumnModal({ section, participants, prep, onClose, onSave }) {
  useBodyScrollLock();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const lines = text.split('\n').map(s => s.trim());
  const filled = lines.filter(Boolean).length;

  async function submit() {
    setBusy(true); setErr('');
    for (let i = 0; i < participants.length; i++) {
      const content = (lines[i] || '').trim();
      if (!content) continue; // skip blanks — don't wipe a participant's prep
      const current = prep[participants[i].id]?.[section.id]?.content || '';
      if (content === current) continue;
      const { error } = await onSave({ participantId: participants[i].id, sectionId: section.id, content });
      if (error) { setBusy(false); setErr(error.message); return; }
    }
    setBusy(false);
    onClose();
  }

  return (
    <div className="modal-backdrop visible" onClick={onClose}>
      <div className="modal-card prep-replace-modal" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Replace prep — {section.title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>Paste one fresh value per participant, in this order. Each replaces that participant's <strong>{section.title}</strong> prep live. Leave a line blank to keep that participant's current value.</p>
          <div className="prep-replace-grid">
            <ol className="prep-replace-names">
              {participants.map((p, i) => (
                <li key={p.id}>
                  <span className="prep-replace-rank">{i + 1}</span>
                  <span className="prep-replace-name">{p.full_name || '(unnamed)'}</span>
                  <span className="prep-replace-cur">{prep[p.id]?.[section.id]?.content || '—'}</span>
                </li>
              ))}
            </ol>
            <textarea
              className="prep-replace-text"
              rows={Math.max(5, participants.length)}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={`One value per line\n(${participants.length} participant${participants.length === 1 ? '' : 's'})`}
            />
          </div>
          <p className="muted">{filled} value{filled === 1 ? '' : 's'} pasted for {participants.length} participant{participants.length === 1 ? '' : 's'}.</p>
          {err && <p className="error">{err}</p>}
        </div>
        <footer className="modal-foot">
          <button type="button" disabled={busy || !filled} onClick={submit}>{busy ? 'Replacing…' : `Replace ${section.title} prep`}</button>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
        </footer>
      </div>
    </div>
  );
}
