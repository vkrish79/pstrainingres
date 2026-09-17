import { boxLabel } from '../../lib/tableCells.js';

export default function TableBlock({ block, value, onChange, readOnly = false }) {
  const cfg = block.config || {};
  const ans = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  function setCell(cellId, v) {
    onChange({ ...ans, [cellId]: v });
  }

  return (
    <div className="wb-table-wrap">
      {cfg.caption && <div className="wb-table-caption">{cfg.caption}</div>}
      <table className="wb-table">
        {cfg.headers && (
          <thead>
            <tr>{cfg.headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {(cfg.rows || []).map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={cell.kind === 'input' ? 'wb-cell-input' : cell.kind === 'mixed' ? 'wb-cell-static wb-cell-mixed' : 'wb-cell-static'}
                  colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                >
                  {cell.kind === 'static' ? (
                    cell.text
                  ) : cell.kind === 'mixed' ? (
                    <MixedCell cell={cell} ans={ans} setCell={setCell} readOnly={readOnly} />
                  ) : readOnly ? (
                    <span className={`wb-readonly inline ${ans[cell.id] ? '' : 'empty'}`}>
                      {ans[cell.id] || '—'}
                    </span>
                  ) : cell.input_type === 'long_text' ? (
                    <textarea
                      rows="2"
                      value={ans[cell.id] || ''}
                      onChange={e => setCell(cell.id, e.target.value)}
                    />
                  ) : (
                    <input
                      type="text"
                      value={ans[cell.id] || ''}
                      onChange={e => setCell(cell.id, e.target.value)}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Wording with answer boxes inside it ("City code: [    ]"). Each box is its
// own answer, keyed by the box id like an input cell.
function MixedCell({ cell, ans, setCell, readOnly }) {
  let boxNo = -1;
  return (
    <span className="wb-mixed">
      {(cell.parts || []).map((p, i) => {
        if (p.kind !== 'box') return <span key={i} className="wb-mixed-text">{p.text}</span>;
        boxNo += 1;
        const label = boxLabel(cell, boxNo, 'Answer');
        if (readOnly) {
          return (
            <span key={p.id} className={`wb-readonly inline wb-mixed-box ${ans[p.id] ? '' : 'empty'}`}>
              {ans[p.id] || '—'}
            </span>
          );
        }
        return (
          <input
            key={p.id}
            type="text"
            className="wb-mixed-box"
            aria-label={label}
            value={ans[p.id] || ''}
            onChange={e => setCell(p.id, e.target.value)}
          />
        );
      })}
    </span>
  );
}
