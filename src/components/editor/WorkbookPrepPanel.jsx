import { useEffect, useState } from 'react';
import { useBusyOverlay } from '../../contexts/BusyOverlayContext.jsx';
import { supabase } from '../../lib/supabase.js';
import { parseSheetFile } from '../../lib/sheetParse.js';
import { matchSection } from '../../lib/prepColumns.js';
import { isSuperTrainerOrAbove } from '../../lib/roles.js';
import { useWorkbookPrep } from '../../hooks/useWorkbookPrep.js';
import '../../styles/prep.css';

// Prep TEMPLATE SETUP panel — super-tier only, on a master (template) workbook.
// The super uploads an empty template whose column headers map to exercises;
// the matched columns are stored as workbook.prep_template (the structure).
// No kit data is stored here — trainers fill and upload prep from the Prep tab.
//
// For COMPOSED workbooks (prep carried by reference), this panel also hosts the
// one-off prep EXTRACTION: pull N participants' prep from the source super pools
// into this workbook's own pool. See docs/compose-prep-extraction-next.md.
export default function WorkbookPrepPanel({ workbook, sections, profile }) {
  const { run: runBusy } = useBusyOverlay();
  const [structure, setStructure] = useState([]);
  const [sourceTitles, setSourceTitles] = useState({}); // source_workbook_id -> title
  const [extractSources, setExtractSources] = useState(null); // populated once extracted
  const [referencedBy, setReferencedBy] = useState([]); // composed workbooks drawing this pool
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [nInput, setNInput] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState('');
  const [extractWarn, setExtractWarn] = useState(false);
  const [returnN, setReturnN] = useState('');
  const [returning, setReturning] = useState(false);

  // This workbook's own kit pool (super partition) — drives the extracted count.
  const { balance, refresh: refreshPool } = useWorkbookPrep(workbook?.id, null);

  useEffect(() => {
    if (!workbook?.id) return;
    let cancelled = false;
    (async () => {
      let { data, error: selErr } = await supabase
        .from('workbooks').select('prep_template, prep_extract_sources').eq('id', workbook.id).single();
      // prep_extract_sources won't exist until the extraction migration is applied;
      // fall back so the prep-template display never blanks out pre-migration.
      if (selErr) {
        const r = await supabase.from('workbooks').select('prep_template').eq('id', workbook.id).single();
        data = r.data;
      }
      if (cancelled) return;
      const tpl = Array.isArray(data?.prep_template) ? data.prep_template : [];
      setStructure(tpl);
      setExtractSources(Array.isArray(data?.prep_extract_sources) ? data.prep_extract_sources : null);
      setLoading(false);
      // Resolve names for exercises whose prep is referenced from another workbook.
      const srcIds = [...new Set([
        ...tpl.map(c => c.source_workbook_id),
        ...((Array.isArray(data?.prep_extract_sources) ? data.prep_extract_sources : []).map(c => c.source_workbook_id)),
      ].filter(Boolean))];
      if (srcIds.length) {
        const { data: wbs } = await supabase.from('workbooks').select('id, title').in('id', srcIds);
        if (!cancelled) setSourceTitles(Object.fromEntries((wbs || []).map(w => [w.id, w.title])));
      }
      // Composed workbooks that draw prep from THIS workbook's pool — so the
      // super stocks enough kits to cover their sessions too. Check both the
      // live reference (prep_template) AND extracted ones (prep_extract_sources),
      // since extraction still depletes this source on every top-up.
      const { data: allWbs } = await supabase
        .from('workbooks').select('id, title, prep_template, prep_extract_sources').eq('is_template', true);
      if (!cancelled) {
        const draws = (w) => {
          const inTpl = Array.isArray(w.prep_template) && w.prep_template.some(e => e?.source_workbook_id === workbook.id);
          const inExt = Array.isArray(w.prep_extract_sources) && w.prep_extract_sources.some(e => e?.source_workbook_id === workbook.id);
          return inTpl || inExt;
        };
        setReferencedBy((allWbs || []).filter(w => w.id !== workbook.id && draws(w)).map(w => w.title));
      }
    })();
    return () => { cancelled = true; };
  }, [workbook?.id, reloadKey]);

  const titleById = {};
  for (const s of sections) titleById[s.id] = s.title;

  // Composed workbook states: referenced (not yet extracted) vs extracted.
  const hasReferenced = structure.some(c => c.source_workbook_id);
  const isExtracted = Array.isArray(extractSources) && extractSources.length > 0;
  const showExtract = hasReferenced || isExtracted;
  const sourceNames = [...new Set(
    (isExtracted ? extractSources : structure.filter(c => c.source_workbook_id))
      .map(c => sourceTitles[c.source_workbook_id]).filter(Boolean),
  )];

  async function handleExtract() {
    const n = parseInt(nInput, 10);
    if (!n || n < 1) { setExtractWarn(true); setExtractMsg('Enter a participant count of 1 or more.'); return; }
    setExtracting(true); setExtractMsg(''); setExtractWarn(false);
    const { data, error: e } = await runBusy(
      'Extracting prep kits…',
      () => supabase.rpc('extract_prep_to_workbook', { p_workbook_id: workbook.id, p_count: n }),
    );
    setExtracting(false);
    if (e) { setExtractWarn(true); setExtractMsg(e.message); return; }
    const { extracted = 0, requested = n, short = false, sources = [] } = data || {};
    let msg = `Extracted ${extracted} of ${requested} participant${requested === 1 ? '' : 's'} into this workbook’s pool.`;
    if (short) {
      // The limiting source(s) are those whose availability defined the bottleneck.
      const dry = sources.filter(s => (s.available || 0) === extracted).map(s => `${s.title} (${s.available} available)`);
      msg += dry.length ? ` Short stock: ${dry.join(', ')}. Top up that pool and extract more.` : ' Some source pools were short.';
    }
    setExtractWarn(short || extracted === 0);
    setExtractMsg(msg);
    setNInput('');
    setReloadKey(k => k + 1);
    refreshPool?.();
  }

  async function handleReturn() {
    const avail = balance.available;
    const n = returnN.trim() ? Math.min(parseInt(returnN, 10) || 0, avail) : avail;
    if (!n || n < 1) { setExtractWarn(true); setExtractMsg('Nothing unused to return.'); return; }
    setReturning(true); setExtractMsg(''); setExtractWarn(false);
    const { data, error: e } = await runBusy(
      'Returning prep kits…',
      () => supabase.rpc('return_prep_to_pool', { p_workbook_id: workbook.id, p_count: n }),
    );
    setReturning(false);
    if (e) { setExtractWarn(true); setExtractMsg(e.message); return; }
    const { returned = 0 } = data || {};
    setExtractWarn(returned === 0);
    setExtractMsg(`Returned ${returned} unused kit${returned === 1 ? '' : 's'} to the source pool${returned === 1 ? '' : 's'}.`);
    setReturnN('');
    setReloadKey(k => k + 1);
    refreshPool?.();
  }

  async function handleFile(e) {
    setError(''); setNotice('');
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const rows = await parseSheetFile(file);
      if (!rows.length) { setError('The file has no header row.'); return; }
      const headers = rows[0];
      const cols = [];
      const seenHeaders = new Set();
      const usedSections = new Set();
      // Exercises whose prep is referenced from another workbook are managed
      // there — keep those entries and don't let an upload create own-pool
      // columns for them.
      const referenced = structure.filter(c => c.source_workbook_id);
      const referencedSectionIds = new Set(referenced.map(c => c.section_id));
      for (const h of headers) {
        const header = String(h ?? '').trim();
        if (!header) continue;
        const hkey = header.toLowerCase();
        if (seenHeaders.has(hkey)) continue;          // dedupe exact headers, first-wins
        seenHeaders.add(hkey);
        // Only consider exercise (non-group) sections — group banners never
        // carry prep, so a header that happens to coincide with a group title
        // must stay as a standalone column.
        const sec = matchSection(header, sections.filter(s => s.kind !== 'group'));
        if (sec && referencedSectionIds.has(sec.id)) continue; // already referenced
        if (sec && !usedSections.has(sec.id)) {
          usedSections.add(sec.id);
          cols.push({ header, section_id: sec.id });  // exercise-linked
        } else {
          cols.push({ header, section_id: null });    // standalone (no match, or section already linked)
        }
      }
      if (cols.length === 0 && referenced.length === 0) {
        setError('The file has no usable column headers.');
        return;
      }
      // Preserve referenced entries; replace the rest with the uploaded columns.
      const newTemplate = [...referenced, ...cols];
      const { error: upErr } = await supabase.from('workbooks').update({ prep_template: newTemplate }).eq('id', workbook.id);
      if (upErr) { setError(upErr.message); return; }
      setStructure(newTemplate);
      const linked = cols.filter(c => c.section_id).length;
      const refNote = referenced.length ? `, ${referenced.length} referenced (kept)` : '';
      setNotice(`Prep template set: ${cols.length} own item${cols.length === 1 ? '' : 's'} (${linked} exercise-linked, ${cols.length - linked} standalone)${refNote}.`);
    } catch (err) {
      setError(err.message || 'Could not read the file.');
    } finally {
      setParsing(false);
      e.target.value = '';
    }
  }

  // Defensive: only super-tier sets up templates. (Mount already gates to the
  // super edit view; this guards any future caller.) Hooks above run first.
  if (!isSuperTrainerOrAbove(profile?.role)) return null;

  return (
    <section className="editor-card prep-panel">
      <div className="prep-panel-head"><h2>Prep template</h2></div>
      <p className="muted prep-intro">
        Define the prep items by uploading a template. A column header that
        matches an exercise (by title or number) links to that exercise; any
        other column is a standalone item (e.g. a role-play PNR). Trainers then
        fill and upload prep against this structure from the <strong>Prep</strong>
        tab. Setup only — no prep data is stored here.
      </p>

      {referencedBy.length > 0 && (
        <p className="prep-notice">
          🔗 This workbook’s prep pool is also drawn by: <strong>{referencedBy.join(', ')}</strong>.
          Stock enough kits to cover their sessions too.
        </p>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {structure.length === 0 ? (
            <p className="muted">No prep template set up yet.</p>
          ) : (
            <>
              <p className="muted">Prep items ({structure.length}):</p>
              <ul className="prep-match-list">
                {structure.map((c, i) => (
                  <li key={i}>
                    <code>{c.header}</code> → {c.section_id
                      ? (titleById[c.section_id] || '(exercise removed)')
                      : <em>standalone (no exercise)</em>}
                    {c.source_workbook_id && (
                      <span className="prep-ref-tag"> · prep from {sourceTitles[c.source_workbook_id] || 'another workbook'} (managed there)</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {showExtract && (
            <div className="prep-extract">
              {!isExtracted ? (
                <>
                  <p className="prep-extract-head">One-off session prep</p>
                  <p className="muted">
                    This workbook draws prep from{sourceNames.length ? <> <strong>{sourceNames.join(', ')}</strong></> : ' other workbooks'}.
                    For a one-off session, extract a fixed number of participants’ prep into this
                    workbook’s own pool — withdrawn from the source workbooks’ super pool.
                  </p>
                  <div className="prep-extract-row">
                    <label className="form-label">Participants
                      <input className="form-input compact" type="number" min="1" max="500" value={nInput}
                        onChange={e => setNInput(e.target.value)} placeholder="e.g. 12" />
                    </label>
                    <button type="button" onClick={handleExtract} disabled={extracting || !nInput}>
                      {extracting ? 'Extracting…' : 'Extract prep'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="prep-extract-head">One-off session prep</p>
                  <p className="prep-notice">
                    ✓ Extracted into this workbook’s own pool: <strong>{balance.available}</strong> available
                    {balance.total !== balance.available ? ` · ${balance.total} total` : ''}
                    {sourceNames.length ? <> · from {sourceNames.join(', ')}</> : null}.
                  </p>
                  <div className="prep-extract-row">
                    <label className="form-label">Extract more
                      <input className="form-input compact" type="number" min="1" max="500" value={nInput}
                        onChange={e => setNInput(e.target.value)} placeholder="e.g. 5" />
                    </label>
                    <button type="button" onClick={handleExtract} disabled={extracting || !nInput}>
                      {extracting ? 'Extracting…' : 'Extract more'}
                    </button>
                  </div>
                  {balance.available > 0 && (
                    <div className="prep-extract-row">
                      <label className="form-label">Return unused
                        <input className="form-input compact" type="number" min="1" max={balance.available} value={returnN}
                          onChange={e => setReturnN(e.target.value)} placeholder={`${balance.available} (all)`} />
                      </label>
                      <button type="button" className="ghost" onClick={handleReturn} disabled={returning}>
                        {returning ? 'Returning…' : 'Return to pool'}
                      </button>
                    </div>
                  )}
                  <p className="muted">
                    Or top up by uploading prep data directly: open the <strong>Prep</strong> tab → pick this
                    workbook → upload a filled template.
                  </p>
                </>
              )}
              {extractMsg && <p className={extractWarn ? 'prep-warn' : 'prep-notice'}>{extractMsg}</p>}
            </div>
          )}

          <div className="prep-actions">
            <label className="ghost prep-upload-btn">
              {structure.length ? '↑ Replace template' : '↑ Upload template'}
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} disabled={parsing} hidden />
            </label>
            {parsing && <span className="muted">Reading file…</span>}
          </div>
          {error && <p className="error">{error}</p>}
          {notice && <p className="prep-notice">{notice}</p>}
        </>
      )}
    </section>
  );
}
