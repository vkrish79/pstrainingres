// Download for Excel: pick a table, see what's in it, save it as CSV.
//
// Seven tables rather than one, because a CSV holds one table. The preview
// matters: it is the difference between "I think this has what I need" and
// knowing before the file lands in Downloads.

import { useEffect, useMemo, useState } from 'react';
import { analyticsTables, tableFilename, downloadTable } from '../../lib/analyticsExport.js';

const PREVIEW_ROWS = 10;

export default function AnalyticsExportDialog({ sessions, rangeId, rangeLabel, onClose }) {
  const [index, setIndex] = useState(0);
  const tables = useMemo(() => analyticsTables(sessions, rangeLabel), [sessions, rangeLabel]);
  const table = tables[index] || tables[0];

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const header = table.rows[0];
  const body = table.rows.slice(1);
  const shown = body.slice(0, PREVIEW_ROWS);
  const isNum = v => typeof v === 'number';

  return (
    <>
      <div className="an-xl-back" onClick={onClose} />
      <div className="an-xl" role="dialog" aria-modal="true" aria-labelledby="an-xl-h">
        <div className="an-xl-head">
          <div>
            <h2 id="an-xl-h">Download for Excel</h2>
            <p>
              {tables.length} tables, each saved as a CSV file that opens straight in Excel.
              They follow the date range you have chosen (<b>{rangeLabel}</b>).
            </p>
          </div>
          <button type="button" className="an-xl-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="an-xl-body">
          <ul className="an-xl-list">
            {tables.map((t, i) => (
              <li key={t.id}>
                <button type="button" aria-pressed={i === index} onClick={() => setIndex(i)}>
                  <b>{t.name}</b>
                  <span className="num">{t.rows.length - 1} row{t.rows.length === 2 ? '' : 's'}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="an-xl-prev">
            <div className="an-xl-note">{table.note}</div>
            <div className="an-tscroll">
              <table className="an-table an-xl-t">
                <thead>
                  <tr>{header.map((hcell, i) => <th key={i} className={i && isNum(shown[0]?.[i]) ? 'r' : ''}>{hcell}</th>)}</tr>
                </thead>
                <tbody>
                  {shown.map((row, i) => (
                    <tr key={i}>{row.map((v, j) => <td key={j} className={isNum(v) ? 'r num' : ''}>{v}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            {body.length > shown.length && (
              <div className="an-xl-more">…and {body.length - shown.length} more rows in the file</div>
            )}
          </div>
        </div>

        <div className="an-xl-foot">
          <span className="num">{tableFilename(table, rangeId)}</span>
          <button type="button" className="an-xl-go" onClick={() => downloadTable(table, rangeId)}>
            Download CSV
          </button>
        </div>
      </div>
    </>
  );
}
