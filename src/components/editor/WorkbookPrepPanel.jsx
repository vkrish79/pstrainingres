import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { parseSheetFile } from '../../lib/sheetParse.js';
import { matchSection } from '../../lib/prepColumns.js';
import { isSuperTrainerOrAbove } from '../../lib/roles.js';
import '../../styles/prep.css';

// Prep TEMPLATE SETUP panel — super-tier only, on a master (template) workbook.
// The super uploads an empty template whose column headers map to exercises;
// the matched columns are stored as workbook.prep_template (the structure).
// No kit data is stored here — trainers fill and upload prep from the Prep tab.
export default function WorkbookPrepPanel({ workbook, sections, profile }) {
  const [structure, setStructure] = useState([]);
  const [sourceTitles, setSourceTitles] = useState({}); // source_workbook_id -> title
  const [referencedBy, setReferencedBy] = useState([]); // composed workbooks drawing this pool
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!workbook?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('workbooks').select('prep_template').eq('id', workbook.id).single();
      if (cancelled) return;
      const tpl = Array.isArray(data?.prep_template) ? data.prep_template : [];
      setStructure(tpl);
      setLoading(false);
      // Resolve names for exercises whose prep is referenced from another workbook.
      const srcIds = [...new Set(tpl.map(c => c.source_workbook_id).filter(Boolean))];
      if (srcIds.length) {
        const { data: wbs } = await supabase.from('workbooks').select('id, title').in('id', srcIds);
        if (!cancelled) setSourceTitles(Object.fromEntries((wbs || []).map(w => [w.id, w.title])));
      }
      // Composed workbooks that draw prep from THIS workbook's pool — so the
      // super stocks enough kits to cover their sessions too.
      const { data: allWbs } = await supabase.from('workbooks').select('id, title, prep_template').eq('is_template', true);
      if (!cancelled) {
        setReferencedBy((allWbs || [])
          .filter(w => w.id !== workbook.id && Array.isArray(w.prep_template)
            && w.prep_template.some(e => e?.source_workbook_id === workbook.id))
          .map(w => w.title));
      }
    })();
    return () => { cancelled = true; };
  }, [workbook?.id]);

  const titleById = {};
  for (const s of sections) titleById[s.id] = s.title;

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
        const sec = matchSection(header, sections);
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
