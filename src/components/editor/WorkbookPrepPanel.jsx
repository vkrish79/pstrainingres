import { useMemo, useState } from 'react';
import { useWorkbookPrep } from '../../hooks/useWorkbookPrep.js';
import { useVendors } from '../../hooks/useVendors.js';
import { parseSheetFile } from '../../lib/sheetParse.js';
import { matchSection } from '../../lib/prepColumns.js';
import { downloadPrepTemplate } from '../../lib/prepTemplate.js';
import { isSuperTrainerOrAbove } from '../../lib/roles.js';
import '../../styles/prep.css';

// Prep repository panel mounted on a master (template) workbook. Available to
// all trainer tiers: download the blank template, upload filled prep into the
// caller's vendor partition, clear unconsumed kits, and see the balance.
// Super-tier can switch partitions (vendor filter); vendor-tier is locked to
// their own vendor.
export default function WorkbookPrepPanel({ workbook, sections, profile }) {
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  const { vendors } = useVendors(); // also readable by vendor-tier; only shown for super

  const [selectedVendorId, setSelectedVendorId] = useState('');
  const partitionVendorId = isSuper ? (selectedVendorId || null) : (profile?.vendor_id || null);
  const unassigned = !isSuper && !profile?.vendor_id;

  const { balance, loading, appendKits, clearUnconsumed } = useWorkbookPrep(workbook?.id, partitionVendorId);

  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [parsed, setParsed] = useState(null); // { headers, dataRows }
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  function resetUpload() {
    setParseError(''); setParsed(null); setSubmitError('');
  }

  async function handleFile(e) {
    resetUpload(); setNotice('');
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const rows = await parseSheetFile(file);
      if (rows.length < 2) {
        setParseError('File needs a header row and at least one kit row.');
      } else {
        setParsed({ headers: rows[0], dataRows: rows.slice(1) });
      }
    } catch (err) {
      setParseError(err.message || 'Could not read the file.');
    } finally {
      setParsing(false);
      e.target.value = ''; // allow re-picking the same file
    }
  }

  // Column -> section mapping + the kit rows we'd write.
  const columnMap = parsed
    ? parsed.headers.map(h => ({ header: h, section: matchSection(h, sections) }))
    : [];
  const matchedColumns = columnMap.filter(c => c.section);
  const unmatchedColumns = columnMap.filter(c => !c.section && String(c.header || '').trim());

  const { payloadRows, gappyRows } = useMemo(() => {
    if (!parsed || matchedColumns.length === 0) return { payloadRows: [], gappyRows: 0 };
    const out = [];
    let gappy = 0;
    for (const row of parsed.dataRows) {
      const payload = {};
      let filled = 0;
      for (let c = 0; c < columnMap.length; c++) {
        const sec = columnMap[c].section;
        if (!sec) continue;
        const content = String(row[c] ?? '').trim();
        if (!content) continue;
        payload[sec.id] = content;
        filled++;
      }
      if (filled === 0) continue; // wholly empty kit row — skip
      if (filled < matchedColumns.length) gappy++;
      out.push(payload);
    }
    return { payloadRows: out, gappyRows: gappy };
  }, [parsed, columnMap, matchedColumns.length]);

  async function handleConfirm() {
    setSubmitting(true); setSubmitError('');
    const { error, count } = await appendKits(payloadRows);
    setSubmitting(false);
    if (error) { setSubmitError(error.message); return; }
    resetUpload();
    setNotice(`Added ${count} kit${count === 1 ? '' : 's'} to the pool.`);
  }

  async function handleClear() {
    const { error } = await clearUnconsumed();
    setConfirmClear(false);
    if (error) { setSubmitError(error.message); return; }
    setNotice('Cleared unconsumed kits.');
  }

  const maxPerSection = Math.max(1, ...Object.values(balance.perSection).map(p => p.total));

  return (
    <section className="editor-card prep-panel">
      <div className="prep-panel-head">
        <h2>Prep repository</h2>
        {isSuper ? (
          <label className="prep-vendor-filter">
            <span className="muted">Pool</span>
            <select
              className="form-input"
              value={selectedVendorId}
              onChange={e => { setSelectedVendorId(e.target.value); resetUpload(); setNotice(''); }}
            >
              <option value="">Super (shared)</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
        ) : (
          <span className="muted prep-vendor-label">Your vendor's pool</span>
        )}
      </div>

      <p className="muted prep-intro">
        A shared pool of prep kits for this workbook. Each session that uses it
        draws one kit per participant from {isSuper ? 'the selected' : 'your vendor’s'} pool.
        Download the template, fill the exercises that need prep (one kit per row),
        and upload it back — uploads add to the pool.
      </p>

      {unassigned ? (
        <p className="error">You need a vendor assignment before you can manage prep. Ask a super trainer.</p>
      ) : (
        <>
          {/* Balance */}
          {loading ? (
            <p className="muted">Loading pool…</p>
          ) : (
            <div className="prep-balance">
              <div className="prep-balance-headline">
                <strong>{balance.available}</strong> kit{balance.available === 1 ? '' : 's'} available
                <span className="muted"> — enough to fully prep {balance.available} more participant{balance.available === 1 ? '' : 's'}</span>
              </div>
              <div className="prep-balance-meta muted">
                {balance.total} total · {balance.allocated} in use · {balance.used} consumed (closed)
              </div>
              {Object.keys(balance.perSection).length > 0 && (
                <ul className="prep-bars">
                  {sections.filter(s => balance.perSection[s.id]).map(s => {
                    const p = balance.perSection[s.id];
                    const pct = Math.round((p.available / maxPerSection) * 100);
                    const cls = p.available === 0 ? 'none' : p.available < balance.available ? 'low' : 'ok';
                    return (
                      <li key={s.id} className="prep-bar-row">
                        <span className="prep-bar-label" title={s.title}>{s.title}</span>
                        <span className={`prep-bar ${cls}`}><span className="prep-bar-fill" style={{ width: `${pct}%` }} /></span>
                        <span className="prep-bar-count">{p.available}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="prep-actions">
            <button type="button" className="ghost" onClick={() => downloadPrepTemplate(workbook?.title, sections)}>
              ↓ Download template
            </button>
            <label className="ghost prep-upload-btn">
              ↑ Upload filled template
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} disabled={parsing || submitting} hidden />
            </label>
            {balance.available > 0 && (
              confirmClear ? (
                <>
                  <span className="confirm-text">Delete {balance.available} unconsumed kit{balance.available === 1 ? '' : 's'}?</span>
                  <button type="button" className="danger" onClick={handleClear}>Yes</button>
                  <button type="button" className="ghost" onClick={() => setConfirmClear(false)}>No</button>
                </>
              ) : (
                <button type="button" className="ghost danger" onClick={() => setConfirmClear(true)}>Clear unconsumed</button>
              )
            )}
          </div>

          {parsing && <p className="muted">Reading file…</p>}
          {parseError && <p className="error">{parseError}</p>}
          {notice && <p className="prep-notice">{notice}</p>}

          {/* Upload preview */}
          {parsed && (
            <div className="prep-preview">
              <h3>Preview</h3>
              {matchedColumns.length === 0 ? (
                <p className="error">No columns matched an exercise in this workbook. Check the header row matches the exercise titles.</p>
              ) : (
                <>
                  <p className="muted">Matched columns:</p>
                  <ul className="prep-match-list">
                    {matchedColumns.map((c, i) => (
                      <li key={i}><code>{c.header}</code> → {c.section.title}</li>
                    ))}
                  </ul>
                  {unmatchedColumns.length > 0 && (
                    <details>
                      <summary className="muted">{unmatchedColumns.length} unmatched column{unmatchedColumns.length === 1 ? '' : 's'} (ignored)</summary>
                      <ul className="prep-match-list muted">
                        {unmatchedColumns.map((c, i) => <li key={i}><code>{c.header}</code></li>)}
                      </ul>
                    </details>
                  )}
                  <p className="prep-preview-count">
                    <strong>{payloadRows.length}</strong> kit{payloadRows.length === 1 ? '' : 's'} will be added.
                  </p>
                  {gappyRows > 0 && (
                    <p className="prep-warn">
                      ⚠ {gappyRows} kit{gappyRows === 1 ? '' : 's'} {gappyRows === 1 ? 'is' : 'are'} missing a value in at
                      least one prep exercise — a participant drawing such a kit won't get prep for that exercise.
                    </p>
                  )}
                  {submitError && <p className="error">{submitError}</p>}
                  <div className="prep-actions">
                    <button type="button" onClick={handleConfirm} disabled={submitting || payloadRows.length === 0}>
                      {submitting ? 'Adding…' : `Add ${payloadRows.length} kit${payloadRows.length === 1 ? '' : 's'}`}
                    </button>
                    <button type="button" className="ghost" onClick={resetUpload} disabled={submitting}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
