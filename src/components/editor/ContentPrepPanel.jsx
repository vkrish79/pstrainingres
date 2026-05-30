import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { parseSheetFile } from '../../lib/sheetParse.js';
import { matchSection } from '../../lib/prepColumns.js';
import { isSuperTrainerOrAbove } from '../../lib/roles.js';
import '../../styles/prep.css';

// Shared prep TEMPLATE SETUP panel — super-tier only, on a master (template)
// parent (workbook or assessment). Renders the prep_template structure list
// and handles the sheet-upload that defines it. Kind-specific extras (workbook's
// composed-prep extract/return flow, referencedBy header) are layered via
// optional props/slots so the workbook wrapper can add them without
// re-implementing the shared core.
//
// Props:
//   parentTable           — table holding prep_template ('workbooks' | 'assessments')
//   parentId              — id of the parent row
//   sections              — sections of the parent (for header→section matching)
//   profile               — caller profile (super-tier gate)
//   kindLabel             — UI label ('workbook' | 'assessment')
//   extraTemplateColumns  — entries to preserve unchanged across uploads
//                           (workbook passes referenced ones; assessment passes [])
//   renderStructureItem   — optional fn(item, titleById) -> ReactNode
//                           override per-item rendering (workbook adds source tag)
//   extraHeader           — optional ReactNode above the structure list
//   children              — rendered below structure, above the upload control
//                           (workbook puts its extract/return panel here)
export default function ContentPrepPanel({
  parentTable,
  parentId,
  sections,
  profile,
  kindLabel = 'workbook',
  extraTemplateColumns = [],
  renderStructureItem,
  extraHeader = null,
  children = null,
  // Notify parent so a wrapper can refresh side state on upload.
  onTemplateChanged,
}) {
  const [structure, setStructure] = useState([]);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!parentId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from(parentTable).select('prep_template').eq('id', parentId).single();
      if (cancelled) return;
      setStructure(Array.isArray(data?.prep_template) ? data.prep_template : []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [parentTable, parentId, reloadKey]);

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
      const preservedSectionIds = new Set(
        extraTemplateColumns.map(c => c.section_id).filter(Boolean),
      );
      for (const h of headers) {
        const header = String(h ?? '').trim();
        if (!header) continue;
        const hkey = header.toLowerCase();
        if (seenHeaders.has(hkey)) continue;
        seenHeaders.add(hkey);
        const sec = matchSection(header, sections.filter(s => s.kind !== 'group'));
        if (sec && preservedSectionIds.has(sec.id)) continue;
        if (sec && !usedSections.has(sec.id)) {
          usedSections.add(sec.id);
          cols.push({ header, section_id: sec.id });
        } else {
          cols.push({ header, section_id: null });
        }
      }
      if (cols.length === 0 && extraTemplateColumns.length === 0) {
        setError('The file has no usable column headers.');
        return;
      }
      const newTemplate = [...extraTemplateColumns, ...cols];
      const { error: upErr } = await supabase
        .from(parentTable).update({ prep_template: newTemplate }).eq('id', parentId);
      if (upErr) { setError(upErr.message); return; }
      setStructure(newTemplate);
      const linked = cols.filter(c => c.section_id).length;
      const refNote = extraTemplateColumns.length
        ? `, ${extraTemplateColumns.length} preserved`
        : '';
      setNotice(`Prep template set: ${cols.length} own item${cols.length === 1 ? '' : 's'} (${linked} exercise-linked, ${cols.length - linked} standalone)${refNote}.`);
      setReloadKey(k => k + 1);
      onTemplateChanged?.();
    } catch (err) {
      setError(err.message || 'Could not read the file.');
    } finally {
      setParsing(false);
      e.target.value = '';
    }
  }

  if (!isSuperTrainerOrAbove(profile?.role)) return null;

  return (
    <section className="editor-card prep-panel">
      <div className="prep-panel-head"><h2>Prep template</h2></div>
      <p className="muted prep-intro">
        Define the prep items by uploading a template. A column header that
        matches an exercise (by title or number) links to that exercise; any
        other column is a standalone item. Trainers then fill and upload prep
        against this structure from the <strong>Prep</strong> tab. Setup only
        — no prep data is stored here.
      </p>

      {extraHeader}

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
                    {renderStructureItem
                      ? renderStructureItem(c, titleById)
                      : <DefaultStructureItem item={c} titleById={titleById} />}
                  </li>
                ))}
              </ul>
            </>
          )}

          {children}

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

function DefaultStructureItem({ item, titleById }) {
  return (
    <>
      <code>{item.header}</code> → {item.section_id
        ? (titleById[item.section_id] || '(exercise removed)')
        : <em>standalone (no exercise)</em>}
    </>
  );
}
