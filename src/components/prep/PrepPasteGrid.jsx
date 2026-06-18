import { useMemo, useState } from 'react';
import '../../styles/prep-grid.css';

// In-app prep entry — no template download, no header row to mangle. The exercise
// columns are fixed (from the prep_template), so the trainer just pastes the value
// block straight from Excel (a real multi-cell paste fills the grid positionally),
// eyeballs that values line up under the right headers, and submits. Builds the
// same payload rows the upload does, so it reuses appendKits underneath.
const MIN_ROWS = 4;

export default function PrepPasteGrid({ structure = [], onSubmit, onCancel, busy = false }) {
  const headers = useMemo(() => structure.map(c => c.header), [structure]);
  const blankRow = () => headers.map(() => '');
  const [rows, setRows] = useState(() => Array.from({ length: MIN_ROWS }, blankRow));
  const [error, setError] = useState('');

  function setCell(r, c, val) {
    setRows(prev => prev.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? val : cell)) : row)));
  }

  // Spreadsheet-style paste: \n = rows, \t = columns, filled from the target cell.
  function handlePaste(r, c, e) {
    const text = e.clipboardData?.getData('text') || '';
    if (!/[\t\n]/.test(text)) return; // single value → let the input handle it
    e.preventDefault();
    const matrix = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(line => line.split('\t'));
    setRows(prev => {
      const next = prev.map(row => [...row]);
      for (let i = 0; i < matrix.length; i++) {
        const tr = r + i;
        while (next.length <= tr) next.push(blankRow());
        for (let j = 0; j < matrix[i].length && c + j < headers.length; j++) {
          next[tr][c + j] = matrix[i][j].trim();
        }
      }
      return next;
    });
  }

  const payloadRows = useMemo(() => {
    const out = [];
    for (const row of rows) {
      const payload = {};
      let filled = 0;
      row.forEach((v, c) => { const t = (v || '').trim(); if (t) { payload[headers[c]] = t; filled++; } });
      if (filled) out.push(payload);
    }
    return out;
  }, [rows, headers]);

  async function submit() {
    setError('');
    if (!payloadRows.length) { setError('Nothing to add — paste or type at least one value.'); return; }
    const { error: e } = await onSubmit(payloadRows);
    if (e) setError(e.message);
  }

  return (
    <div className="prep-paste">
      <div className="prep-paste-head">
        <div>
          <h3 className="prep-detail-title" style={{ margin: 0 }}>Enter prep in-app</h3>
          <p className="muted" style={{ margin: '0.25rem 0 0' }}>
            Copy your prep values from Excel (the cells only, <strong>no header row</strong>) and paste into the grid —
            the columns are fixed below, so headers can’t get mismatched. Check the values line up, then add.
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Close">×</button>
      </div>

      <div className="pg-scroll">
        <table className="pg-table prep-paste-table">
          <thead>
            <tr>
              <th className="pg-rowhead prep-paste-rownum">#</th>
              {headers.map((h, i) => <th key={i} title={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                <td className="pg-rowhead prep-paste-rownum">{r + 1}</td>
                {row.map((cell, c) => (
                  <td key={c} className="pg-editcell">
                    <input
                      className="pg-edit"
                      value={cell}
                      onChange={e => setCell(r, c, e.target.value)}
                      onPaste={e => handlePaste(r, c, e)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="prep-paste-foot">
        <span className="prep-paste-count"><strong>{payloadRows.length}</strong> kit{payloadRows.length === 1 ? '' : 's'} ready</span>
        <button type="button" className="ghost btn-sm" onClick={() => setRows(prev => [...prev, ...Array.from({ length: 5 }, blankRow)])}>+ 5 rows</button>
        <button type="button" className="ghost btn-sm" onClick={() => { setRows(Array.from({ length: MIN_ROWS }, blankRow)); setError(''); }}>Clear</button>
        <span style={{ flex: 1 }} />
        {error && <span className="error">{error}</span>}
        <button type="button" disabled={busy || !payloadRows.length} onClick={submit}>
          {busy ? 'Adding…' : `Add ${payloadRows.length} kit${payloadRows.length === 1 ? '' : 's'}`}
        </button>
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
