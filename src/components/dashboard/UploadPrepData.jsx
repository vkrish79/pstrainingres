import { useState } from 'react';
import { parseSheetFile } from '../../lib/sheetParse.js';

// Headers we silently ignore (they're not exercise columns — common
// "who is this row about" headers people add for legibility).
const IGNORED_HEADERS = new Set([
  'name', 'full name', 'fullname', 'full_name',
  'participant', 'participant name', 'student',
  'username', 'email', 'id', '#', 'no', 'no.', 'sno', 's.no',
  'row', 'index',
]);

// Header -> section match. Exact case-insensitive match first; else match
// by leading digit ("1", "Ex 1", "Exercise 1" all map to a section whose
// title contains the same number).
function matchSection(header, sections) {
  const h = String(header || '').toLowerCase().trim();
  if (!h) return null;
  if (IGNORED_HEADERS.has(h)) return null;
  const exact = sections.find(s => (s.title || '').toLowerCase().trim() === h);
  if (exact) return exact;
  const hNum = h.match(/\d+/);
  if (!hNum) return null;
  return sections.find(s => {
    const sNum = (s.title || '').toLowerCase().match(/\d+/);
    return sNum && sNum[0] === hNum[0];
  }) || null;
}

export default function UploadPrepData({ open, onClose, sections, participants, onUpload }) {
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [parsed, setParsed] = useState(null); // { headers, rows }
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  function reset() {
    setParseError(''); setParsed(null); setSubmitError('');
  }

  async function handleFile(e) {
    reset();
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const rows = await parseSheetFile(file);
      if (rows.length < 2) {
        setParseError('File needs at least a header row and one data row.');
        setParsing(false);
        return;
      }
      const headers = rows[0];
      const dataRows = rows.slice(1);
      setParsed({ headers, dataRows });
    } catch (err) {
      setParseError(err.message || 'Could not read the file.');
    } finally {
      setParsing(false);
    }
  }

  if (!open) return null;

  // Sort participants A→Z by full_name so row mapping is stable.
  const sortedParticipants = [...participants]
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));

  // Map each column to a section (or null = unmatched / ignored).
  const columnMap = parsed
    ? parsed.headers.map(h => ({ header: h, section: matchSection(h, sections) }))
    : [];
  const matchedColumns = columnMap.filter(c => c.section);
  const unmatchedColumns = columnMap.filter(c => !c.section && c.header);

  // Build the prep rows we'll send.
  const dataRows = parsed?.dataRows || [];
  const willMap = dataRows.slice(0, sortedParticipants.length);
  const orphanRows = Math.max(0, dataRows.length - sortedParticipants.length);
  const missingParticipants = Math.max(0, sortedParticipants.length - dataRows.length);

  const prepWrites = [];
  for (let r = 0; r < willMap.length; r++) {
    const participant = sortedParticipants[r];
    const row = willMap[r];
    for (let c = 0; c < parsed.headers.length; c++) {
      const section = columnMap[c]?.section;
      if (!section) continue;
      const content = (row[c] || '').trim();
      if (!content) continue;
      prepWrites.push({
        participantId: participant.id,
        sectionId: section.id,
        content,
        // for preview only:
        _participant: participant.full_name || '(unnamed)',
        _section: section.title,
      });
    }
  }

  async function handleConfirm() {
    setSubmitting(true); setSubmitError('');
    const { error } = await onUpload(
      prepWrites.map(({ participantId, sectionId, content }) => ({ participantId, sectionId, content })),
    );
    setSubmitting(false);
    if (error) { setSubmitError(error.message); return; }
    reset();
    onClose();
  }

  return (
    <div className="modal-backdrop visible" onClick={onClose}>
      <div className="modal-card upload-prep-modal" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <h2>📎 Upload prep data</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>
            Excel (.xlsx) or CSV. First row is the header. Each column is an exercise
            (match by title — "Exercise 1" — or just the number). Each data row maps
            to one participant in alphabetical order by name. Cells left blank are
            skipped.
          </p>

          {!parsed && (
            <div className="upload-prep-file">
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} disabled={parsing} />
              {parsing && <p className="muted">Reading file…</p>}
              {parseError && <p className="error">{parseError}</p>}
            </div>
          )}

          {parsed && (
            <>
              <section className="upload-prep-section">
                <h3>Column → exercise</h3>
                {matchedColumns.length === 0 && (
                  <p className="error">No columns matched any exercise. Check the header row.</p>
                )}
                {matchedColumns.length > 0 && (
                  <ul className="upload-prep-list">
                    {matchedColumns.map((c, i) => (
                      <li key={i}><code>{c.header}</code> → {c.section.title}</li>
                    ))}
                  </ul>
                )}
                {unmatchedColumns.length > 0 && (
                  <details>
                    <summary className="muted">{unmatchedColumns.length} unmatched column{unmatchedColumns.length === 1 ? '' : 's'} (ignored)</summary>
                    <ul className="upload-prep-list muted">
                      {unmatchedColumns.map((c, i) => <li key={i}><code>{c.header}</code></li>)}
                    </ul>
                  </details>
                )}
              </section>

              <section className="upload-prep-section">
                <h3>Row → participant</h3>
                <p className="muted">
                  {dataRows.length} data row{dataRows.length === 1 ? '' : 's'} ·
                  {' '}{sortedParticipants.length} participant{sortedParticipants.length === 1 ? '' : 's'} in this session
                </p>
                {orphanRows > 0 && (
                  <p className="error">{orphanRows} extra row{orphanRows === 1 ? '' : 's'} with no participant to map to — they will be dropped.</p>
                )}
                {missingParticipants > 0 && (
                  <p className="muted">{missingParticipants} participant{missingParticipants === 1 ? '' : 's'} without a row — they get no prep.</p>
                )}
                {willMap.length > 0 && (
                  <ul className="upload-prep-list">
                    {willMap.map((_, r) => (
                      <li key={r}>Row {r + 1} → <strong>{sortedParticipants[r].full_name || '(unnamed)'}</strong></li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="upload-prep-section">
                <h3>{prepWrites.length} prep entr{prepWrites.length === 1 ? 'y' : 'ies'} will be saved</h3>
                {prepWrites.length === 0 && <p className="muted">Nothing to write — every relevant cell is empty.</p>}
              </section>

              {submitError && <p className="error">{submitError}</p>}
            </>
          )}
        </div>
        <footer className="modal-foot">
          {parsed && (
            <button className="ghost" onClick={reset} disabled={submitting}>Choose different file</button>
          )}
          <div style={{ flex: 1 }} />
          <button className="ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          {parsed && (
            <button onClick={handleConfirm} disabled={submitting || prepWrites.length === 0}>
              {submitting ? 'Saving…' : `Save ${prepWrites.length} entr${prepWrites.length === 1 ? 'y' : 'ies'}`}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
