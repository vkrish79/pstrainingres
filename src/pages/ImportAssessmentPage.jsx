import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { supabase } from '../lib/supabase.js';
import { parseDocxToWorkbook } from '../lib/docxImport.js';
import { uploadImportedImages } from '../lib/workbookImages.js';
import TopBar from '../components/TopBar.jsx';
import ImportDropZone from '../components/import/ImportDropZone.jsx';
import ImportReview from '../components/import/ImportReview.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';

// Same .docx parser as workbooks — the block model is shared, so the parser
// output drops straight into assessment_sections / assessment_blocks. No
// vendor_visible toggle (assessments are program-internal in PR2a).
export default function ImportAssessmentPage() {
  const navigate = useNavigate();
  const { session: authSession } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);

  async function handleFile(file) {
    setError('');
    if (!file.name.match(/\.docx$/i)) {
      setError('Only .docx files are supported.');
      return;
    }
    setParsing(true);
    try {
      const result = await runBusy('Reading assessment…', () => parseDocxToWorkbook(file));
      setParsed(result);
      setTitleDraft(result.title);
    } catch (err) {
      setError('Could not read the file: ' + err.message);
    } finally {
      setParsing(false);
    }
  }

  async function confirmImport(reviewed) {
    if (!reviewed) return;
    setImporting(true);
    setError('');
    try {
      const newId = await runBusy('Importing assessment…', async () => {
        // Pictures go up first; `ready` is the parse with storage paths in.
        const { parsed: ready } = await uploadImportedImages(reviewed);
        const { data: ass, error: e1 } = await supabase
          .from('assessments')
          .insert({
            title: titleDraft.trim() || reviewed.title,
            description: reviewed.description || null,
            is_template: true,
            created_by: authSession.user.id,
          })
          .select()
          .single();
        if (e1) throw e1;

        for (let si = 0; si < ready.sections.length; si++) {
          const sec = ready.sections[si];
          const { data: secRow, error: e2 } = await supabase
            .from('assessment_sections')
            .insert({ assessment_id: ass.id, title: sec.title, order_index: si, kind: sec.kind || 'exercise' })
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
          const { error: e3 } = await supabase.from('assessment_blocks').insert(rows);
          if (e3) throw e3;
        }
        return ass.id;
      });
      navigate(`/trainer/assessments/${newId}`);
    } catch (err) {
      setError('Import failed: ' + err.message);
      setImporting(false);
    }
  }

  return (
    <>
      <TopBar />
      <main className="page editor import-page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer/assessments" className="back-link">&larr; Back to Assessments</Link>
            <h1>Import assessment from Word</h1>
            <p>{parsed
              ? 'Check what the document turned into and fix anything before you create it.'
              : 'Drop the Word file in as it is. You review the result before anything is saved.'}</p>
          </div>
        </section>

        {parsed ? (
          <>
            {error && <p className="error">{error}</p>}
            <ImportReview
              parsed={parsed}
              kind="assessment"
              title={titleDraft}
              onTitle={setTitleDraft}
              onCreate={confirmImport}
              onDiscard={() => { setParsed(null); setTitleDraft(''); setError(''); }}
              busy={importing}
            />
          </>
        ) : (
          <ImportDropZone kind="assessment" onFile={handleFile} busy={parsing || importing} error={error} />
        )}
      </main>
    </>
  );
}
