import { useRef, useState } from 'react';
import { BOX_MARKER, mixedToText, mixedFromText, mixedWording } from '../../lib/tableCells.js';
import { tableGrid, tableEdge, rowMisfits, gridWidth, hasSpans, spanOf, lineUpLoneRows, withHeaderRow } from '../../lib/tableWidths.js';
import { GridCols, GridRuler, RowFit, FloatingWidth, cellAnchor, widthKeys } from '../blocks/TableWidthTools.jsx';
import { ImageCell } from '../blocks/WbImage.jsx';

// The table block editor: cell kinds and wording, rows and columns, and cell
// widths (one grid column at a time — see lib/tableWidths.js).

function newCellId() {
  return `c_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export default function TableForm({ block, onSave, onCancel }) {
  const cfg = block.config || {};
  const [caption, setCaption] = useState(cfg.caption || '');
  const [headers, setHeaders] = useState(Array.isArray(cfg.headers) ? cfg.headers : []);
  // One width per heading (columns covered); [] when every heading covers one.
  const [headerSpans, setHeaderSpans] = useState(Array.isArray(cfg.headerSpans) ? cfg.headerSpans : []);
  // A one-cell row is a full-width line; Word's odd span on it is evened out
  // here so it never sticks out (saved with the next Save).
  const [rows, setRows] = useState(() => lineUpLoneRows(Array.isArray(cfg.rows) ? cfg.rows : []));
  const [busy, setBusy] = useState(false);
  // The cell whose width is being changed: { ri, ci }.
  const [sel, setSel] = useState(null);
  // Resized by hand: participants see it on its grid (see tableWidths.js).
  const [grid, setGrid] = useState(!!cfg.grid);
  // Widths work on the header row (if any) and the body as one grid: `all`,
  // with body row r at all[r + off]. The selection indexes into `all`.
  const { all, off } = withHeaderRow({ rows, headers, headerSpans });
  const resize = (next) => {
    if (off) { setHeaderSpans(next[0].map(spanOf)); setRows(next.slice(1)); } else setRows(next);
    setGrid(true);
  };

  const numCols = Math.max(headers.length, ...rows.map(r => r.length), 1);
  const edge = tableEdge(all);
  const misfits = rowMisfits(all, edge);
  const cols = hasSpans(all) ? gridWidth(all) : 0;
  const { pos } = tableGrid(all);
  const isSel = (gi, ci) => !!sel && sel.ri === gi && sel.ci === ci;
  const pastEdge = (gi, ci) => cols > 0 && pos[gi]?.[ci] + spanOf(all[gi][ci]) > edge;
  const choose = (ri, ci) => setSel(s => (s && s.ri === ri && s.ci === ci ? null : { ri, ci }));
  const tableRef = useRef(null);

  function setHeader(i, v) {
    setHeaders(prev => {
      const next = prev.length ? [...prev] : Array.from({ length: numCols }, () => '');
      next[i] = v;
      return next;
    });
  }

  function addColumn() {
    setHeaders(prev => {
      const base = prev.length ? prev : Array.from({ length: numCols }, () => '');
      return [...base, `Column ${base.length + 1}`];
    });
    setHeaderSpans(prev => (prev.length ? [...prev, 1] : prev));
    setRows(prev => prev.map(row => [...row, { kind: 'static', text: '' }]));
  }

  function removeColumn(i) {
    setSel(null);
    setHeaders(prev => prev.filter((_, idx) => idx !== i));
    setHeaderSpans(prev => prev.filter((_, idx) => idx !== i));
    setRows(prev => prev.map(row => row.filter((_, idx) => idx !== i)));
  }

  function addRow() {
    setRows(prev => [...prev, Array.from({ length: numCols }, () => ({ kind: 'static', text: '' }))]);
  }

  function removeRow(i) {
    setSel(null);
    setRows(prev => prev.filter((_, idx) => idx !== i));
  }

  function updateCell(ri, ci, fn) {
    setRows(prev => prev.map((row, r) =>
      r === ri ? row.map((cell, c) => c === ci ? fn(cell) : cell) : row
    ));
  }

  function setCellKind(ri, ci, kind) {
    updateCell(ri, ci, cell => {
      const spans = {};
      if (cell.colSpan > 1) spans.colSpan = cell.colSpan;
      if (cell.rowSpan > 1) spans.rowSpan = cell.rowSpan;
      if (kind === 'static') {
        return { kind: 'static', text: cell.kind === 'mixed' ? mixedWording(cell) : (cell.text || ''), ...spans };
      }
      if (kind === 'mixed') {
        // Keep the wording and put a box after it; the trainer moves the {{}}.
        const text = cell.kind === 'static' ? (cell.text || '').trim() : '';
        return mixedFromText(text ? `${text} ${BOX_MARKER}` : BOX_MARKER, { ...spans }, newCellId);
      }
      return { kind: 'input', id: cell.id || newCellId(), input_type: cell.input_type || 'short_text', ...spans };
    });
  }

  function setCellText(ri, ci, text) {
    updateCell(ri, ci, cell => ({ ...cell, text }));
  }

  function setMixedText(ri, ci, text) {
    updateCell(ri, ci, cell => mixedFromText(text, cell, newCellId));
  }

  function setCellInputType(ri, ci, t) {
    updateCell(ri, ci, cell => ({ ...cell, input_type: t }));
  }

  async function save() {
    setBusy(true);
    const config = { rows };
    if (grid) config.grid = true;
    if (caption.trim()) config.caption = caption.trim();
    if (headers.length && headers.some(h => (h || '').trim())) {
      config.headers = headers;
      const spans = headers.map((_, i) => (headerSpans[i] > 1 ? headerSpans[i] : 1));
      if (spans.some(s => s > 1)) config.headerSpans = spans;
    }
    await onSave({ config });
    setBusy(false);
  }

  const showHeaders = headers.length > 0;

  return (
    <div className="block-form">
      <label className="form-label">Caption (optional)</label>
      <input className="form-input" value={caption} onChange={e => setCaption(e.target.value)} />

      <div className="table-form-actions" style={{ marginTop: '0.85rem' }}>
        {!showHeaders && (
          <button className="ghost" onClick={() => { setSel(null); setHeaderSpans([]); setHeaders(Array.from({ length: numCols }, (_, i) => `Column ${i + 1}`)); }}>
            + Add header row
          </button>
        )}
        {showHeaders && (
          <button className="ghost" onClick={() => { setSel(null); setHeaderSpans([]); setHeaders([]); }}>Remove header row</button>
        )}
      </div>

      <FloatingWidth tableRef={tableRef} rows={all} edge={edge} sel={sel} onRows={resize} onClear={() => setSel(null)} />
      {cols > 0 && (
        <div className="tw-bar quiet">
          Click ⇔ on a cell to change how many of the table's {edge} columns it covers.
          {misfits.some(Boolean) && <span className="tw-chip wide">{misfits.filter(Boolean).length} row{misfits.filter(Boolean).length === 1 ? ' doesn’t' : 's don’t'} fit</span>}
        </div>
      )}
      <div className="table-form-wrap">
        <table
          ref={tableRef}
          className={`table-form-grid${cols ? ' is-grid' : ''}`}
          style={cols ? { minWidth: `${cols * 4.5 + 10.5}rem` } : undefined}
          onKeyDown={e => widthKeys(e, all, sel, resize)}
        >
          <GridCols cols={cols} status />
          {showHeaders && (
            <thead>
              <GridRuler rows={all} cols={cols} edge={edge} sel={sel} status />
              <tr>
                {headers.map((h, i) => (
                  <th
                    key={i}
                    colSpan={headerSpans[i] > 1 ? headerSpans[i] : undefined}
                    className={`${isSel(0, i) ? 'tw-sel' : ''}${pastEdge(0, i) ? ' tw-past' : ''}`}
                    {...cellAnchor(0, i)}
                  >
                    <div className="cell-stack">
                      <button
                        type="button"
                        className={`tw-grip${isSel(0, i) ? ' on' : ''}`}
                        onClick={() => choose(0, i)}
                        data-tip="Change how many columns this heading covers"
                      >⇔ {headerSpans[i] > 1 ? headerSpans[i] : 1}</button>
                      <input className="form-input compact" value={h || ''} onChange={e => setHeader(i, e.target.value)} placeholder={`Col ${i + 1}`} />
                      <button className="ghost danger compact" onClick={() => removeColumn(i)} title="Remove column">× col</button>
                    </div>
                  </th>
                ))}
                <th className="row-trash">
                  {cols > 0 && <RowFit rows={all} ri={0} edge={edge} misfit={misfits[0]} onRows={resize} />}
                </th>
              </tr>
            </thead>
          )}
          <tbody>
            {!off && <GridRuler rows={all} cols={cols} edge={edge} sel={sel} status />}
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                    rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                    // Tinted by kind so the grid reads like the participant's
                    // table: plain cells are wording, green ones take an answer.
                    className={`tf-kind-${cell.kind}${isSel(ri + off, ci) ? ' tw-sel' : ''}${pastEdge(ri + off, ci) ? ' tw-past' : ''}`}
                    {...cellAnchor(ri + off, ci)}
                  >
                    <div className="cell-stack">
                      <button
                        type="button"
                        className={`tw-grip${isSel(ri + off, ci) ? ' on' : ''}`}
                        onClick={() => choose(ri + off, ci)}
                        data-tip="Change how many columns this cell covers"
                      >⇔ {spanOf(cell)}</button>
                      <select className="form-input compact" value={cell.kind} onChange={e => setCellKind(ri, ci, e.target.value)}>
                        <option value="static">Text</option>
                        <option value="input">Input</option>
                        <option value="mixed">Text with boxes</option>
                        {/* Only on an imported picture cell. Choosing Text removes the picture. */}
                        {cell.kind === 'image' && <option value="image" disabled>Picture</option>}
                      </select>
                      {cell.kind === 'image' ? (
                        <>
                          <ImageCell cell={cell} />
                          <span className="hint">Switch to Text to remove the picture.</span>
                        </>
                      ) : cell.kind === 'mixed' ? (
                        <textarea
                          className="form-textarea compact"
                          rows="2"
                          value={mixedToText(cell)}
                          onChange={e => setMixedText(ri, ci, e.target.value)}
                          data-tip={`Type ${BOX_MARKER} wherever an answer box goes`}
                        />
                      ) : cell.kind === 'static' ? (
                        <textarea className="form-textarea compact" rows="2" value={cell.text || ''} onChange={e => setCellText(ri, ci, e.target.value)} />
                      ) : (
                        <select className="form-input compact" value={cell.input_type || 'short_text'} onChange={e => setCellInputType(ri, ci, e.target.value)}>
                          <option value="short_text">Short text</option>
                          <option value="long_text">Long text</option>
                        </select>
                      )}
                    </div>
                  </td>
                ))}
                <td className="row-trash">
                  <div className="row-trash-stack">
                    {cols > 0 && <RowFit rows={all} ri={ri + off} edge={edge} misfit={misfits[ri + off]} onRows={resize} />}
                    <button className="ghost danger compact" onClick={() => removeRow(ri)} title="Remove row">× row</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="add-block-row">
        <button className="ghost" onClick={addColumn}>+ Add column</button>
        <button className="ghost" onClick={addRow}>+ Add row</button>
      </div>

      <p className="hint">Rows can have different cell counts (from imports with merged cells). Use ⇔ to make a cell wider or narrower, one column at a time. Participants' answers are tied to the input cell ID, so resizing, renaming or reordering won't lose data.</p>

      <div className="form-actions">
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
