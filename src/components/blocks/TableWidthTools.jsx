import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { spanOf, setCellSpan, fitRow, evenRow, canFit, canEven, tableGrid, rowMisfits } from '../../lib/tableWidths.js';
import '../../styles/table-widths.css';

// The pieces of "resize table cells, one column at a time", shared by the
// import review and the table editor. Both own their rows and the selected
// cell ({ ri, ci }); these only draw and hand back new rows.

// An equal share of the width for each of Word's grid columns, plus an
// optional narrow column on the right for each row's fit chip. Under the
// browser's own table sizing these are hints: a column still grows to fit its
// longest word, so "Base fare" in a one-column cell never splits into letters.
export function GridCols({ cols, status = false }) {
  if (!cols) return null;
  return (
    <colgroup>
      {Array.from({ length: cols }, (_, i) => <col key={i} style={{ width: `${(100 / cols).toFixed(3)}%` }} />)}
      {status && <col className="tw-status-col" />}
    </colgroup>
  );
}

// Column numbers over the table while a cell is selected: the columns it covers
// in gold, anything past the table's edge in red.
export function GridRuler({ rows, cols, edge, sel, status = false, lead = 0 }) {
  if (!cols || !sel) return null;
  const { pos } = tableGrid(rows);
  const start = pos[sel.ri]?.[sel.ci] ?? -1;
  const span = spanOf(rows[sel.ri]?.[sel.ci]);
  return (
    <tr className="tw-ruler" aria-hidden="true">
      {Array.from({ length: lead }, (_, i) => <td key={`l${i}`} />)}
      {Array.from({ length: cols }, (_, i) => (
        <td key={i} className={`${i >= start && i < start + span ? 'hit' : ''}${i >= edge ? ' out' : ''}${i === edge - 1 ? ' edge' : ''}`}>{i + 1}</td>
      ))}
      {status && <td />}
    </tr>
  );
}

// "1 too wide" / "2 short" at the end of a row that does not fit, with Fit and
// Even widths. Nothing when the row fits.
export function RowFit({ rows, ri, edge, misfit, onRows }) {
  if (!misfit) return null;
  const fit = canFit(rows, ri, edge);
  const even = canEven(rows, ri, edge);
  return (
    <span className="tw-rowfit">
      <span className={`tw-chip ${misfit > 0 ? 'wide' : 'short'}`}>{Math.abs(misfit)} {misfit > 0 ? 'too wide' : 'short'}</span>
      {fit && (
        <button type="button" className="tw-mini" onClick={() => onRows(fitRow(rows, ri, edge))}
          data-tip={misfit > 0 ? 'Take columns from the widest cell until the row fits' : 'Stretch the last cell to the table edge'}>Fit</button>
      )}
      {even && (
        <button type="button" className="tw-mini" onClick={() => onRows(evenRow(rows, ri, edge))}
          data-tip="Share the table's width evenly across this row's cells">Even widths</button>
      )}
    </span>
  );
}

// Marks a table cell so the floating control can find it: spread onto the <td>.
export const cellAnchor = (ri, ci) => ({ 'data-tw-cell': `${ri}-${ci}` });

// The stepper for the selected cell, floating right beside it (above, or below
// when there is no room above), so the cell can be watched while it changes.
// Follows the cell as it grows, shrinks, scrolls or the window resizes. Closes
// on ✕, Esc, or a click outside the table and the control.
export function FloatingWidth({ tableRef, rows, edge, sel, onRows, onClear }) {
  const boxRef = useRef(null);
  const [pos, setPos] = useState(null);
  const cell = sel ? rows[sel.ri]?.[sel.ci] : null;

  useLayoutEffect(() => {
    if (!cell) { setPos(null); return undefined; }
    const place = () => {
      const td = tableRef.current?.querySelector(`[data-tw-cell="${sel.ri}-${sel.ci}"]`);
      const box = boxRef.current;
      if (!td || !box) return;
      const r = td.getBoundingClientRect();
      const h = box.offsetHeight, w = box.offsetWidth;
      // Keep clear of the app's sticky top bar.
      const topLimit = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + 6;
      const above = r.top - h - 6;
      const top = above >= topLimit ? above : r.bottom + 6;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      setPos({ top, left, below: above < topLimit });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [cell, rows, sel, tableRef]);

  useEffect(() => {
    if (!cell) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClear(); };
    const onDown = (e) => {
      if (boxRef.current?.contains(e.target) || tableRef.current?.contains(e.target)) return;
      onClear();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [cell, onClear, tableRef]);

  if (!cell) return null;
  const span = spanOf(cell);
  const misfit = rowMisfits(rows, edge)[sel.ri] || 0;
  return createPortal(
    <div
      ref={boxRef}
      className={`tw-float${pos?.below ? ' below' : ''}`}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
      role="toolbar"
      aria-label={`Width of ${cellName(cell)}`}
    >
      <span className="tw-stepper">
        <button type="button" disabled={span <= 1} onClick={() => onRows(setCellSpan(rows, sel.ri, sel.ci, span - 1))} aria-label="Narrower" data-tip="Narrower (Alt + ←)">◀</button>
        <span className="tw-n">{span}</span>
        <button type="button" onClick={() => onRows(setCellSpan(rows, sel.ri, sel.ci, span + 1))} aria-label="Wider" data-tip="Wider (Alt + →)">▶</button>
      </span>
      <span className="tw-float-of">of {edge} column{edge === 1 ? '' : 's'}</span>
      <RowFit rows={rows} ri={sel.ri} edge={edge} misfit={misfit} onRows={onRows} />
      <button type="button" className="tw-float-x" onClick={onClear} aria-label="Close" data-tip="Close (Esc)">✕</button>
    </div>,
    document.body,
  );
}

// Alt + ← / → on the selected cell, from anywhere inside the table.
export function widthKeys(e, rows, sel, onRows) {
  if (!sel || !e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
  const cell = rows[sel.ri]?.[sel.ci];
  if (!cell) return;
  e.preventDefault();
  const span = spanOf(cell) + (e.key === 'ArrowRight' ? 1 : -1);
  if (span >= 1) onRows(setCellSpan(rows, sel.ri, sel.ci, span));
}

function cellName(cell) {
  if (cell.kind === 'input') return 'answer box';
  if (cell.kind === 'image') return 'picture';
  if (cell.kind === 'mixed') {
    const t = (cell.parts || []).filter(p => p.kind === 'text').map(p => p.text).join(' ').trim();
    return t ? `“${clip(t)}”` : 'answer boxes';
  }
  const t = (cell.text || '').trim();
  return t ? `“${clip(t)}”` : 'blank cell';
}

const clip = t => (t.length > 40 ? `${t.slice(0, 40)}…` : t);
