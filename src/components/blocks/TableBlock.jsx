import { boxLabel } from '../../lib/tableCells.js';
import ReviewMark from './ReviewMark.jsx';

// `preview` — draw the table as a candidate meets it: empty cells to fill in,
// inert. Without it, readOnly renders each input cell as the answer that was
// given, which on an unanswered table is a column of em-dashes. Same distinction
// FieldBlock makes; a table is where it is most visible, because these workbooks
// are mostly tables.
export default function TableBlock({ block, value, onChange, readOnly = false, preview = false, marks = null, marksAudience = 'participant' }) {
  const cfg = block.config || {};
  const ans = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const showAnswer = readOnly && !preview;
  const noop = () => {};

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
                  className={`${cell.kind === 'input' ? 'wb-cell-input' : cell.kind === 'mixed' ? 'wb-cell-static wb-cell-mixed' : 'wb-cell-static'}${
                    cell.kind === 'input' && marks?.[cell.id]?.trainer_answer ? (marks[cell.id].right ? ' rv-cell-right' : ' rv-cell-diff') : ''}`}
                  colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                >
                  {cell.kind === 'input' && marks?.[cell.id]?.right && (
                    <ReviewMark mark={marks[cell.id]} readOnly={readOnly} audience={marksAudience} />
                  )}
                  {cell.kind === 'static' ? (
                    cell.text
                  ) : cell.kind === 'mixed' ? (
                    <MixedCell cell={cell} ans={ans} setCell={setCell} readOnly={readOnly} preview={preview} marks={marks} marksAudience={marksAudience} />
                  ) : showAnswer ? (
                    <span className={`wb-readonly inline ${ans[cell.id] ? '' : 'empty'}`}>
                      {ans[cell.id] || '—'}
                    </span>
                  ) : cell.input_type === 'long_text' ? (
                    <textarea
                      rows="2"
                      value={preview ? '' : (ans[cell.id] || '')}
                      disabled={preview}
                      onChange={preview ? noop : (e => setCell(cell.id, e.target.value))}
                    />
                  ) : (
                    <input
                      type="text"
                      value={preview ? '' : (ans[cell.id] || '')}
                      disabled={preview}
                      onChange={preview ? noop : (e => setCell(cell.id, e.target.value))}
                    />
                  )}
                  {cell.kind === 'input' && marks?.[cell.id] && !marks[cell.id].right && (
                    <ReviewMark mark={marks[cell.id]} readOnly={readOnly} audience={marksAudience} onApply={v => setCell(cell.id, v)} />
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
function MixedCell({ cell, ans, setCell, readOnly, preview = false, marks, marksAudience = 'participant' }) {
  const showAnswer = readOnly && !preview;
  let boxNo = -1;
  return (
    <span className="wb-mixed">
      {(cell.parts || []).map((p, i) => {
        if (p.kind !== 'box') return <span key={i} className="wb-mixed-text">{p.text}</span>;
        boxNo += 1;
        const label = boxLabel(cell, boxNo, 'Answer');
        const mark = marks?.[p.id];
        const markEl = mark ? (
          <ReviewMark compact mark={mark} readOnly={readOnly} audience={marksAudience} onApply={v => setCell(p.id, v)} />
        ) : null;
        if (showAnswer) {
          return (
            <span key={p.id} className="wb-mixed-slot">
              <span className={`wb-readonly inline wb-mixed-box ${ans[p.id] ? '' : 'empty'}`}>
                {ans[p.id] || '—'}
              </span>
              {markEl}
            </span>
          );
        }
        if (!markEl) {
          return (
            <input
              key={p.id}
              type="text"
              className="wb-mixed-box"
              aria-label={label}
              value={preview ? '' : (ans[p.id] || '')}
              disabled={preview}
              onChange={preview ? undefined : (e => setCell(p.id, e.target.value))}
            />
          );
        }
        return (
          <span key={p.id} className="wb-mixed-slot">
            <input
              type="text"
              className="wb-mixed-box"
              aria-label={label}
              value={preview ? '' : (ans[p.id] || '')}
              disabled={preview}
              onChange={preview ? undefined : (e => setCell(p.id, e.target.value))}
            />
            {markEl}
          </span>
        );
      })}
    </span>
  );
}
