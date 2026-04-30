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
                <td key={ci} className={cell.kind === 'input' ? 'wb-cell-input' : 'wb-cell-static'}>
                  {cell.kind === 'static' ? (
                    cell.text
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
