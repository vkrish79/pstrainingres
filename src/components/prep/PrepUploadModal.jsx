import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useVendors } from '../../hooks/useVendors.js';
import { useWorkbookPrep } from '../../hooks/useWorkbookPrep.js';
import { parseSheetFile } from '../../lib/sheetParse.js';
import { downloadEmptyPrepTemplate } from '../../lib/prepTemplate.js';
import { isSuperTrainerOrAbove } from '../../lib/roles.js';
import '../../styles/prep.css';

// The "Prep" tab modal (opened from the TopBar). Pick a workbook → (super) pick
// a pool → download the empty template, fill it, upload to append kits, and see
// the balance. Super uploads only to the shared super pool; selecting a vendor
// pool is balance-only. Vendor-tier is locked to their own pool.
export default function PrepUploadModal({ onClose, profile }) {
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  const { vendors } = useVendors();

  const [templates, setTemplates] = useState([]);
  const [tplLoading, setTplLoading] = useState(true);
  const [selectedWorkbookId, setSelectedWorkbookId] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState(''); // '' = super pool

  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [parsed, setParsed] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('workbooks')
        .select('id, title, prep_template')
        .eq('is_template', true)
        .order('title');
      if (cancelled) return;
      setTemplates(data || []);
      setTplLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const selectedWorkbook = templates.find(t => t.id === selectedWorkbookId) || null;
  const structure = Array.isArray(selectedWorkbook?.prep_template) ? selectedWorkbook.prep_template : [];

  const partitionVendorId = isSuper ? (selectedVendorId || null) : (profile?.vendor_id || null);
  const canWrite = isSuper ? (partitionVendorId == null) : !!profile?.vendor_id;

  const { balance, loading: balLoading, appendKits, clearUnconsumed } =
    useWorkbookPrep(selectedWorkbookId || null, partitionVendorId);

  // normalized uploaded header -> canonical template header (the payload key)
  const headerCanon = useMemo(() => {
    const m = {};
    for (const c of structure) m[String(c.header).toLowerCase().trim()] = c.header;
    return m;
  }, [structure]);

  function resetUpload() { setParseError(''); setParsed(null); setSubmitError(''); }
  function changeWorkbook(id) { setSelectedWorkbookId(id); resetUpload(); setNotice(''); setConfirmClear(false); }

  async function handleFile(e) {
    resetUpload(); setNotice('');
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const rows = await parseSheetFile(file);
      if (rows.length < 2) setParseError('File needs a header row and at least one kit row.');
      else setParsed({ headers: rows[0], dataRows: rows.slice(1) });
    } catch (err) {
      setParseError(err.message || 'Could not read the file.');
    } finally {
      setParsing(false);
      e.target.value = '';
    }
  }

  // Build kit payloads from the parsed file using the stored structure.
  const { payloadRows, gappyRows, matchedHeaders } = useMemo(() => {
    if (!parsed) return { payloadRows: [], gappyRows: 0, matchedHeaders: 0 };
    const colKey = parsed.headers.map(h => headerCanon[String(h).toLowerCase().trim()] || null);
    const matched = colKey.filter(Boolean).length;
    const out = [];
    let gappy = 0;
    for (const row of parsed.dataRows) {
      const payload = {};
      let filled = 0;
      for (let c = 0; c < colKey.length; c++) {
        if (!colKey[c]) continue;
        const content = String(row[c] ?? '').trim();
        if (!content) continue;
        payload[colKey[c]] = content;
        filled++;
      }
      if (filled === 0) continue;
      if (filled < matched) gappy++;
      out.push(payload);
    }
    return { payloadRows: out, gappyRows: gappy, matchedHeaders: matched };
  }, [parsed, headerCanon]);

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
    <div className="modal-backdrop visible" onClick={onClose}>
      <div className="modal-card prep-upload-modal" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <h2>🎯 Prep — upload &amp; balance</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <div className="prep-pickers">
            <label className="form-label">
              Workbook
              <select className="form-input" value={selectedWorkbookId} onChange={e => changeWorkbook(e.target.value)} disabled={tplLoading}>
                <option value="">{tplLoading ? 'Loading…' : 'Select a workbook…'}</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </label>
            {isSuper && selectedWorkbookId && (
              <label className="form-label">
                Pool
                <select className="form-input" value={selectedVendorId} onChange={e => { setSelectedVendorId(e.target.value); resetUpload(); setNotice(''); setConfirmClear(false); }}>
                  <option value="">Super (shared)</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
            )}
          </div>

          {!selectedWorkbookId ? (
            <p className="muted">Pick a workbook to see its prep pool.</p>
          ) : structure.length === 0 ? (
            <>
              <p className="prep-warn">No prep template set up for this workbook yet — ask a super trainer to set it up from the workbook’s editor.</p>
              {!balLoading && balance.total > 0 && (
                <div className="prep-balance"><div className="prep-balance-meta muted">{balance.total} kit(s) in this pool · {balance.available} available</div></div>
              )}
            </>
          ) : (
            <>
              {balLoading ? <p className="muted">Loading pool…</p> : (
                <div className="prep-balance">
                  <div className="prep-balance-headline">
                    <strong>{balance.available}</strong> kit{balance.available === 1 ? '' : 's'} available
                    <span className="muted"> — enough to fully prep {balance.available} more participant{balance.available === 1 ? '' : 's'}</span>
                  </div>
                  <div className="prep-balance-meta muted">{balance.total} total · {balance.allocated} in use · {balance.used} consumed (closed)</div>
                  {Object.keys(balance.perSection).length > 0 && (
                    <ul className="prep-bars">
                      {Object.entries(balance.perSection).map(([sid, p]) => {
                        const pct = Math.round((p.available / maxPerSection) * 100);
                        const cls = p.available === 0 ? 'none' : p.available < balance.available ? 'low' : 'ok';
                        return (
                          <li key={sid} className="prep-bar-row">
                            <span className="prep-bar-label" title={sid}>{sid}</span>
                            <span className={`prep-bar ${cls}`}><span className="prep-bar-fill" style={{ width: `${pct}%` }} /></span>
                            <span className="prep-bar-count">{p.available}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              {!canWrite && (
                <p className="muted">Viewing this vendor’s balance (read-only). You can upload only to the <strong>Super (shared)</strong> pool.</p>
              )}

              <div className="prep-actions">
                <button type="button" className="ghost" onClick={() => downloadEmptyPrepTemplate(selectedWorkbook.title, structure)}>
                  ↓ Download template
                </button>
                {canWrite && (
                  <label className="ghost prep-upload-btn">
                    ↑ Upload filled template
                    <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} disabled={parsing || submitting} hidden />
                  </label>
                )}
                {canWrite && balance.available > 0 && (
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

              {parsed && (
                <div className="prep-preview">
                  <h3>Preview</h3>
                  {matchedHeaders === 0 ? (
                    <p className="error">No columns matched this workbook’s prep template. Download the template above and fill that exact file.</p>
                  ) : (
                    <>
                      <p className="prep-preview-count"><strong>{payloadRows.length}</strong> kit{payloadRows.length === 1 ? '' : 's'} will be added.</p>
                      {gappyRows > 0 && (
                        <p className="prep-warn">⚠ {gappyRows} kit{gappyRows === 1 ? '' : 's'} {gappyRows === 1 ? 'is' : 'are'} missing a value in at least one prep exercise.</p>
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
        </div>
      </div>
    </div>
  );
}
