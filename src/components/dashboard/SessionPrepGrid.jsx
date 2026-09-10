import { useMemo, useState } from 'react';
import { isMatrixPaste, parseClipboardMatrix, applyMatrix } from '../../lib/pasteGrid.js';
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

// Replace one exercise's prep for every participant, as a grid rather than a
// textarea.
//
// It used to be a free textarea beside a numbered list of names: you pasted a
// column from Excel and then counted down two lists to check line 7 was really
// Fatima's. The values and the names were never on the same row, which is the
// one thing the reader needs.
//
// Now each participant IS a row, with their current value beside the cell that
// replaces it, and a paste from Excel fills down from the cell you paste into —
// the same behaviour as PrepPasteGrid on the Prep page, sharing its parser.
//
// BLANK STILL MEANS KEEP. The submit loop below indexes positionally against
// `participants` and skips empty content, which is what makes "leave a row
// alone" expressible. So the grid holds one value per participant including
// the empties, and is never compacted down to just the filled ones.
function ReplaceColumnModal({ section, participants, prep, onClose, onSave }) {
  useBodyScrollLock();
  // One cell per participant, in participant order. A row of one column, which
  // keeps it the same shape applyMatrix expects.
  const [rows, setRows] = useState(() => participants.map(() => ['']));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dropped, setDropped] = useState(0);
  const [poolWarning, setPoolWarning] = useState('');

  const lines = rows.map(r => (r[0] || '').trim());
  const filled = lines.filter(Boolean).length;

  function setCell(i, val) {
    setRows(prev => prev.map((row, ri) => (ri === i ? [val] : row)));
    setDropped(0);
  }

  // Paste a column straight out of Excel: fills downward from this row.
  function handlePaste(i, e) {
    const text = e.clipboardData?.getData('text') || '';
    if (!isMatrixPaste(text)) return;   // single value — let the input do it
    e.preventDefault();
    const matrix = parseClipboardMatrix(text);
    setRows(prev => {
      const { rows: next, dropped: lost } = applyMatrix(prev, matrix, i, 0);
      setDropped(lost);
      return next;
    });
  }

  async function submit() {
    setBusy(true); setErr(''); setPoolWarning('');
    // Local, not state: state set inside this loop is not readable until re-render.
    let warned = '';
    for (let i = 0; i < participants.length; i++) {
      const content = (lines[i] || '').trim();
      if (!content) continue; // skip blanks — don't wipe a participant's prep
      const current = prep[participants[i].id]?.[section.id]?.content || '';
      if (content === current) continue;
      const { error, poolWarning: warn } = await onSave({ participantId: participants[i].id, sectionId: section.id, content });
      if (error) { setBusy(false); setErr(error.message); return; }
      // Secondary write only — the prep itself landed, so keep going.
      if (warn) warned = warn;
    }
    setBusy(false);
    setPoolWarning(warned);
    // Stay open if the pool copy lagged, so the warning is actually read.
    if (!warned) onClose();
  }

  return (
    <div className="modal-backdrop visible" onClick={onClose}>
      <div className="modal-card prep-replace-modal" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Replace prep — {section.title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>
            Copy the column of fresh values from Excel and paste it into the first
            cell — it fills down from there. Each replaces that participant's{' '}
            <strong>{section.title}</strong> prep live. <strong>Leave a cell empty</strong> to
            keep that participant's current value.
          </p>

          <div className="pg-scroll prep-replace-scroll">
            <table className="pg-table prep-replace-table">
              <thead>
                <tr>
                  <th className="pg-rowhead prep-replace-rownum">#</th>
                  <th>Participant</th>
                  <th>Current</th>
                  <th>New value</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p, i) => {
                  const current = prep[p.id]?.[section.id]?.content || '';
                  const next = (rows[i]?.[0] || '').trim();
                  return (
                    <tr key={p.id} className={next ? 'prep-replace-changed' : undefined}>
                      <td className="pg-rowhead prep-replace-rownum">{i + 1}</td>
                      <td className="prep-replace-name">{p.full_name || '(unnamed)'}</td>
                      <td className="prep-replace-cur mono">{current || '—'}</td>
                      <td className="pg-editcell">
                        <input
                          className="pg-edit"
                          value={rows[i]?.[0] || ''}
                          onChange={e => setCell(i, e.target.value)}
                          onPaste={e => handlePaste(i, e)}
                          aria-label={`New ${section.title} prep for ${p.full_name || 'participant'}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="muted">
            {filled} value{filled === 1 ? '' : 's'} entered for {participants.length} participant{participants.length === 1 ? '' : 's'}.
            {filled > 0 && filled < participants.length && ' The rest keep what they have.'}
          </p>
          {/* Pasting more values than there are participants used to fail
              silently — the extras simply vanished, and nobody found out until
              somebody's prep was wrong. */}
          {dropped > 0 && (
            <p className="prep-warn">
              ⚠ {dropped} pasted value{dropped === 1 ? '' : 's'} did not fit — there
              {participants.length === 1 ? ' is' : ' are'} only {participants.length} participant
              {participants.length === 1 ? '' : 's'}. Check you copied the right block.
            </p>
          )}
          {err && <p className="error">{err}</p>}
          {poolWarning && <p className="prep-warn">⚠ {poolWarning}</p>}
        </div>
        <footer className="modal-foot">
          <button type="button" disabled={busy || !filled} onClick={submit}>{busy ? 'Replacing…' : `Replace ${section.title} prep`}</button>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
        </footer>
      </div>
    </div>
  );
}
