import { useMemo, useRef, useState } from 'react';
import { buildParticipantCsvTemplate, downloadCsv, parseParticipantCsv } from '../../lib/csv.js';
import {
  buildAllInvitesText, buildHandoutHtml, buildInviteText, formatDateRange, isShareable,
} from '../../lib/participantInvite.js';
import '../../styles/prep.css';

const STATUS_LABELS = {
  created: { label: 'Created', cls: 'status-pill ok' },
  enrolled_existing: { label: 'Enrolled', cls: 'status-pill ok' },
  already_enrolled: { label: 'Already enrolled', cls: 'status-pill' },
  error: { label: 'Error', cls: 'status-pill warn' },
};

// Carry the full name (only known on the input side) onto each result row so
// invites and handouts can greet participants by name. Matched on username,
// case-insensitively, mirroring the server's normalization.
function enrichWithNames(results, inputRows) {
  const nameByUser = new Map(
    (inputRows || []).map(r => [(r.username || '').trim().toLowerCase(), (r.full_name || '').trim()]),
  );
  return (results || []).map(r => ({
    ...r, full_name: nameByUser.get((r.username || '').toLowerCase()) || '',
  }));
}

export default function AddSessionParticipants({ onAdd, onCancel, session, joinUrl }) {
  const [mode, setMode] = useState('direct');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);
  const [copied, setCopied] = useState('');

  const inviteCtx = useMemo(() => ({
    sessionName: session?.name || 'the training session',
    joinUrl: joinUrl || '',
    dateRange: formatDateRange(session?.starts_at, session?.ends_at),
  }), [session?.name, session?.starts_at, session?.ends_at, joinUrl]);

  const shareableRows = (results || []).filter(isShareable);

  function flagCopied(key) {
    setCopied(key);
    setTimeout(() => setCopied(c => (c === key ? '' : c)), 1500);
  }

  async function copyText(text, key) {
    try { await navigator.clipboard.writeText(text); flagCopied(key); }
    catch { setError('Could not copy to the clipboard.'); }
  }

  function printHandouts() {
    if (shareableRows.length === 0) return;
    const win = window.open('', '_blank');
    if (!win) { setError('Pop-up blocked — allow pop-ups for this site to print handouts.'); return; }
    win.document.open();
    win.document.write(buildHandoutHtml(shareableRows, inviteCtx));
    win.document.close();
  }

  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');

  const [csvRows, setCsvRows] = useState([]);
  const [csvFilename, setCsvFilename] = useState('');
  const [csvParseErrors, setCsvParseErrors] = useState([]);
  const fileInputRef = useRef(null);

  async function submitDirect(e) {
    e.preventDefault();
    setError(''); setResults(null); setBusy(true);
    const trimmed = username.trim();
    const inputRows = [{ username: trimmed, full_name: fullName.trim() }];
    const { data, error: err } = await onAdd(inputRows);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setResults(enrichWithNames(data, inputRows));
    const created = data?.find(r => r.username === trimmed && r.status === 'created');
    if (created) {
      setUsername(''); setFullName('');
    }
  }

  function onFileChange(e) {
    setCsvRows([]); setCsvParseErrors([]); setCsvFilename(''); setResults(null); setError('');
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const { rows, errors } = parseParticipantCsv(text);
      setCsvRows(rows);
      setCsvParseErrors(errors);
    };
    reader.onerror = () => setError('Could not read the file.');
    reader.readAsText(file);
  }

  async function submitCsv() {
    if (csvRows.length === 0) { setError('Nothing to upload.'); return; }
    setError(''); setResults(null); setBusy(true);
    const { data, error: err } = await onAdd(csvRows);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setResults(enrichWithNames(data, csvRows));
    setCsvRows([]); setCsvFilename('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function downloadTemplate() {
    downloadCsv('participants_template.csv', buildParticipantCsvTemplate());
  }

  return (
    <div className="add-participants-panel">
      <div className="add-participants-tabs">
        <button
          type="button"
          className={`view-tab ${mode === 'direct' ? 'active' : ''}`}
          onClick={() => { setMode('direct'); setResults(null); setError(''); }}
        >
          Add one
        </button>
        <button
          type="button"
          className={`view-tab ${mode === 'upload' ? 'active' : ''}`}
          onClick={() => { setMode('upload'); setResults(null); setError(''); }}
        >
          Upload CSV
        </button>
        <button type="button" className="ghost" onClick={onCancel} style={{ marginLeft: 'auto' }} disabled={busy}>
          Close
        </button>
      </div>

      {mode === 'direct' && (
        <form onSubmit={submitDirect} className="add-person-form" style={{ marginTop: '0.75rem' }}>
          <div className="form-grid">
            <div>
              <label className="form-label">Username</label>
              <input className="form-input" required value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. jane.doe" />
              <p className="hint">Letters, digits, dot, underscore, hyphen. A temp password is generated automatically.</p>
            </div>
            <div>
              <label className="form-label">Full name</label>
              <input className="form-input" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button type="submit" disabled={busy || !username.trim()}>
              {busy ? 'Adding…' : 'Add to session'}
            </button>
          </div>
        </form>
      )}

      {mode === 'upload' && (
        <div style={{ marginTop: '0.75rem' }}>
          <p className="hint" style={{ marginTop: 0 }}>
            Download the template, fill it in Excel (one participant per row), save as CSV, then upload here.
            Columns: <code>username</code>, <code>full_name</code> (optional). Temp passwords are generated by the server.
          </p>
          <div className="form-actions" style={{ marginTop: '0.25rem' }}>
            <button type="button" className="ghost" onClick={downloadTemplate}>↓ Download template</button>
          </div>
          <div className="form-grid" style={{ marginTop: '0.75rem' }}>
            <div>
              <label className="form-label">CSV file</label>
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={onFileChange} className="form-input" />
              {csvFilename && <p className="hint">{csvFilename} — {csvRows.length} valid row{csvRows.length === 1 ? '' : 's'}</p>}
            </div>
          </div>
          {csvParseErrors.length > 0 && (
            <ul className="error" style={{ marginTop: '0.5rem' }}>
              {csvParseErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button type="button" onClick={submitCsv} disabled={busy || csvRows.length === 0}>
              {busy ? 'Uploading…' : `Upload ${csvRows.length || ''} participant${csvRows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {results && results.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>Results</h3>
          {results.some(r => r.prep === 'exhausted') && (
            <p className="prep-warn">
              ⚠ The prep repository is empty for this session's pool — affected participants
              were added without prep. Top up the repository from the workbook's prep panel
              for future enrolments.
            </p>
          )}
          {shareableRows.length > 0 && (
            <div className="invite-actions">
              <button type="button" onClick={() => copyText(buildAllInvitesText(shareableRows, inviteCtx), 'all')}>
                {copied === 'all' ? 'Copied!' : `📋 Copy ${shareableRows.length > 1 ? 'all invites' : 'invite'}`}
              </button>
              <button type="button" className="ghost" onClick={printHandouts}>
                🖨 Print handout{shareableRows.length === 1 ? '' : 's'}
              </button>
            </div>
          )}
          <table className="participants-table">
            <thead>
              <tr>
                <th>Username</th>
                <th style={{ width: '11rem' }}>Status</th>
                <th>Details</th>
                <th style={{ width: '8rem' }}>Invite</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => {
                const meta = STATUS_LABELS[r.status] || { label: r.status, cls: 'status-pill' };
                const key = `row-${i}`;
                return (
                  <tr key={i}>
                    <td>{r.username}</td>
                    <td><span className={meta.cls}>{meta.label}</span></td>
                    <td>
                      {r.status === 'created' && r.temp_password && (
                        <>Temp password: <span className="mono">{r.temp_password}</span></>
                      )}
                      {r.status === 'error' && (r.reason || '—')}
                      {r.status === 'enrolled_existing' && 'Linked existing account.'}
                      {r.status === 'already_enrolled' && 'Was already in this session.'}
                      {r.prep === 'exhausted' && <span className="prep-pending"> · ⚠ no prep (repository empty)</span>}
                      {r.prep === 'error' && <span className="prep-pending"> · ⚠ prep error</span>}
                    </td>
                    <td>
                      {isShareable(r) && (
                        <button
                          type="button"
                          className="ghost btn-sm"
                          onClick={() => copyText(buildInviteText(r, inviteCtx), key)}
                          title="Copy a ready-to-send message with the link, username and password"
                        >
                          {copied === key ? 'Copied!' : 'Copy invite'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: '0.5rem' }}>
            <strong>Copy invite</strong> grabs a ready-to-send message (link, username, temp password)
            to paste into chat or email; <strong>Print handouts</strong> opens printable per-participant
            slips. Temp passwords show only here — participants set their own on first sign-in, and you
            can reissue one anytime from the participant list.
          </p>
        </div>
      )}
    </div>
  );
}
