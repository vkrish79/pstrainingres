import { useCallback, useEffect, useMemo, useState } from 'react';
import { useContentPrep } from './useContentPrep.js';
import { parseSheetFile } from '../lib/sheetParse.js';

// Everything that can be DONE to one prep pool — one parent (workbook or
// assessment) in one vendor partition: upload a filled template, enter kits
// in-app, bulk-edit, clear the unconsumed.
//
// Lifted out of PrepUploadModal so the Prep page and the pop-up render the same
// pool from the same state machine. There is one copy of the stocking logic;
// the two surfaces differ only in where they put the body and the actions
// (PrepPoolBody / PrepPoolActions).
//
//   prepKind  — WORKBOOK_PREP_KIND | ASSESSMENT_PREP_KIND
//   parent    — { id, title, prep_template } | null
//   vendorId  — partition: a vendor uuid, or null for the shared super pool
export function usePrepPool(prepKind, parent, vendorId) {
  const parentId = parent?.id || null;
  const structure = useMemo(
    () => (Array.isArray(parent?.prep_template) ? parent.prep_template : []),
    [parent],
  );

  const { kits, balance, loading, appendKits, clearUnconsumed, setKitStatus, editKitCells } =
    useContentPrep(prepKind, parentId, vendorId);

  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [parsed, setParsed] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [editMode, setEditMode] = useState(false); // bulk edit of existing kits

  const resetUpload = useCallback(() => { setParseError(''); setParsed(null); setSubmitError(''); }, []);

  // A different pool is a clean slate: a half-read file or an open edit sheet
  // belongs to the pool it was started on.
  useEffect(() => {
    resetUpload(); setNotice(''); setConfirmClear(false); setPasteMode(false); setEditMode(false);
  }, [parentId, vendorId, prepKind, resetUpload]);

  // normalized uploaded header -> canonical template header (the payload key)
  const headerCanon = useMemo(() => {
    const m = {};
    for (const c of structure) m[String(c.header).toLowerCase().trim()] = c.header;
    return m;
  }, [structure]);

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

  // In-app paste-grid entry: same append path as the upload, just a different UI.
  async function handlePasteSubmit(rows) {
    setSubmitting(true);
    const { error, count } = await appendKits(rows);
    setSubmitting(false);
    if (error) return { error };
    setPasteMode(false);
    setNotice(`Added ${count} kit${count === 1 ? '' : 's'} to the pool.`);
    return {};
  }

  // Bulk edit save — the sheet reports its own outcome, so pass the result back
  // rather than swallowing it into the pool-level notice. The sheet is the ONLY
  // writer of kit payloads; the mirror into an allocated participant's prep
  // needs the parent's prep_template, so it is bound here.
  async function handleBulkEdit(changes) {
    setSubmitting(true);
    const result = await editKitCells(changes, structure);
    setSubmitting(false);
    return result;
  }

  async function handleClear() {
    const { error } = await clearUnconsumed();
    setConfirmClear(false);
    if (error) { setSubmitError(error.message); return; }
    setNotice('Cleared unconsumed kits.');
  }

  return {
    parent, structure, kits, balance, loading,
    parsing, parseError, parsed, submitting, submitError, notice,
    confirmClear, setConfirmClear, pasteMode, setPasteMode, editMode, setEditMode,
    payloadRows, gappyRows, matchedHeaders,
    handleFile, handleConfirm, handlePasteSubmit, handleBulkEdit, handleClear,
    resetUpload, setKitStatus,
    // The stocking actions step aside while one of them is in progress, the
    // same rule the pop-up's footer always followed.
    showActions: !!parentId && structure.length > 0 && !pasteMode && !editMode,
  };
}
