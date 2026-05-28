import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { parseDocxToWorkbook, countsOf } from '../lib/docxImport.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';

export default function ImportWorkbookPage() {
  const navigate = useNavigate();
  const { session: authSession } = useAuth();
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [vendorVisible, setVendorVisible] = useState(false);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);

  async function handleFile(e) {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.match(/\.docx$/i)) {
      setError('Only .docx files are supported.');
      return;
    }
    setParsing(true);
    try {
      const result = await parseDocxToWorkbook(file);
      setParsed(result);
      setTitleDraft(result.title);
    } catch (err) {
      setError('Could not read the file: ' + err.message);
    } finally {
      setParsing(false);
    }
  }

  async function confirmImport() {
    if (!parsed) return;
    setImporting(true);
    setError('');
    try {
      const { data: wb, error: e1 } = await supabase
        .from('workbooks')
        .insert({
          title: titleDraft.trim() || parsed.title,
          description: parsed.description || null,
          is_template: true,
          vendor_visible: vendorVisible,
          created_by: authSession.user.id,
        })
        .select()
        .single();
      if (e1) throw e1;

      for (let si = 0; si < parsed.sections.length; si++) {
        const sec = parsed.sections[si];
        const { data: secRow, error: e2 } = await supabase
          .from('sections')
          .insert({ workbook_id: wb.id, title: sec.title, order_index: si, kind: sec.kind || 'exercise' })
          .select()
          .single();
        if (e2) throw e2;

        if (sec.blocks.length === 0) continue;
        const rows = sec.blocks.map((b, bi) => ({
          section_id: secRow.id,
          order_index: bi,
          block_type: b.block_type,
          config: b.config,
        }));
        const { error: e3 } = await supabase.from('blocks').insert(rows);
        if (e3) throw e3;
      }

      navigate(`/trainer/workbooks/${wb.id}`);
    } catch (err) {
      setError('Import failed: ' + err.message);
      setImporting(false);
    }
  }

  const counts = parsed ? countsOf(parsed) : null;

  return (
    <>
      <TopBar />
      <main className="page editor">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>Import workbook from Word</h1>
            <p>Author the workbook in Word using the conventions below, then upload the .docx file.</p>
          </div>
        </section>

        <section className="editor-card">
          <h2 className="section-title" style={{ marginTop: 0 }}>1. Choose file</h2>
          <input type="file" accept=".docx" onChange={handleFile} disabled={parsing || importing} />
          {parsing && <p className="muted">Parsing…</p>}
          {error && <p className="error">{error}</p>}
        </section>

        {parsed && (
          <section className="editor-card">
            <h2 className="section-title" style={{ marginTop: 0 }}>2. Review</h2>
            <label className="form-label">Workbook title</label>
            <input
              className="form-input large"
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
            />
            {parsed.description && (
              <>
                <label className="form-label">Description</label>
                <p className="muted" style={{ marginTop: 0 }}>{parsed.description}</p>
              </>
            )}

            <label className="checkbox-row" style={{ margin: '0.85rem 0' }}>
              <input type="checkbox" checked={vendorVisible} onChange={e => setVendorVisible(e.target.checked)} />
              <span>Make available to vendors <span className="muted">— off for custom/one-off workbooks; on to let vendor trainers run sessions from it</span></span>
            </label>

            <div className="import-counts">
              <span>{counts.sections} section{counts.sections === 1 ? '' : 's'}</span>
              {counts.groups > 0 && <span>({counts.groups} group{counts.groups === 1 ? '' : 's'})</span>}
              <span>{counts.prose} prose</span>
              <span>{counts.field} field{counts.field === 1 ? '' : 's'}</span>
              <span>{counts.table} table{counts.table === 1 ? '' : 's'}</span>
            </div>

            <div className="import-preview">
              {parsed.sections.map((sec, si) => (
                <div key={si} className={`import-section-preview ${sec.kind === 'group' ? 'group' : ''}`}>
                  <h3>{sec.kind === 'group' ? '§ ' : ''}{sec.title}</h3>
                  <ul>
                    {sec.blocks.map((b, bi) => (
                      <li key={bi}>
                        <span className={`block-type-tag tag-${b.block_type}`}>{b.block_type}</span>
                        {' '}
                        <span className="block-preview">{previewBlock(b)}</span>
                      </li>
                    ))}
                    {sec.blocks.length === 0 && <li className="muted">(empty)</li>}
                  </ul>
                </div>
              ))}
              {parsed.sections.length === 0 && (
                <p className="muted">No sections detected. Add Heading 2 paragraphs in Word to define sections.</p>
              )}
            </div>

            <div className="form-actions">
              <button onClick={confirmImport} disabled={importing || !titleDraft.trim()}>
                {importing ? 'Importing…' : 'Create workbook'}
              </button>
              <button className="ghost" onClick={() => { setParsed(null); setTitleDraft(''); }} disabled={importing}>
                Discard
              </button>
            </div>
          </section>
        )}

        <section className="editor-card">
          <h2 className="section-title" style={{ marginTop: 0 }}>Word formatting cheatsheet</h2>
          <ul className="cheatsheet">
            <li><strong>Heading 1</strong> → workbook title <em>(single-H1 docs)</em> · top-level section banner <em>(multi-H1 docs)</em></li>
            <li><strong>Heading 2</strong> → starts a new exercise/section</li>
            <li>Plain paragraphs, bullets, sub-headings → become <em>prose</em> blocks</li>
            <li><code>[SHORT: What is your name?]</code> → short text input</li>
            <li><code>[LONG: Describe your experience…]</code> → multi-line text input</li>
            <li><code>[CHOICE: Pick one | Yes | No | Maybe]</code> → single-choice radio</li>
            <li><code>[CHECK: Pick all | A | B | C | D]</code> → multi-select checkboxes</li>
            <li>Word tables → table blocks. Cells with text <code>[INPUT:short]</code> or <code>[INPUT:long]</code> become input cells; everything else is static text. A bold first row becomes the header.</li>
          </ul>
        </section>
      </main>
    </>
  );
}

function previewBlock(b) {
  if (b.block_type === 'prose') {
    const text = (b.config?.html || '').replace(/<[^>]+>/g, '').trim();
    return text.length > 90 ? text.slice(0, 90) + '…' : (text || '(empty)');
  }
  if (b.block_type === 'field') {
    const opts = b.config?.options ? ` — ${b.config.options.join(', ')}` : '';
    return `${b.config?.label || '(no label)'}${opts}`;
  }
  if (b.block_type === 'table') {
    const rows = b.config?.rows?.length || 0;
    const cols = b.config?.headers?.length || b.config?.rows?.[0]?.length || 0;
    return `${rows} rows × ${cols} cols`;
  }
  return '';
}
