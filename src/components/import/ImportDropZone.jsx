import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { isSuperTrainerOrAbove } from '../../lib/roles.js';

// Step 1 of a Word import: drop the file in as it is. Shared by the workbook
// and assessment import pages; `kind` says which one this is. The switch
// between them is two links, because they are two routes — and the assessment
// one is super-trainer only, so ordinary trainers do not see it.
export default function ImportDropZone({ kind, onFile, busy = false, error = '' }) {
  const { profile } = useAuth();
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const noun = kind === 'assessment' ? 'assessment' : 'workbook';

  // A file dropped just outside the zone would otherwise be opened or
  // downloaded by the browser, leaving the page.
  useEffect(() => {
    const stop = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => { window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop); };
  }, []);

  function take(files) {
    const file = files?.[0];
    if (file) onFile(file);
  }

  return (
    <div className="ir-upload">
      <div className="ir-upload-main">
        <div
          className={`ir-drop ${over ? 'over' : ''} ${busy ? 'busy' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); inputRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); if (!busy) setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) take(e.dataTransfer.files); }}
        >
          <div className="ir-drop-doc" aria-hidden="true">W</div>
          <h2>{busy ? 'Reading the document…' : 'Drop a Word file here'}</h2>
          <p>Or click to choose one. Write it the way you normally would; you'll check and fix the result on the next screen before anything is created.</p>
          <input
            ref={inputRef}
            type="file"
            accept=".docx"
            hidden
            disabled={busy}
            onChange={(e) => { take(e.target.files); e.target.value = ''; }}
          />
          {error && <p className="error" onClick={e => e.stopPropagation()}>{error}</p>}
        </div>
        {isSuperTrainerOrAbove(profile?.role) && (
          <div className="ir-kind" aria-label="What are you importing?">
            <Link to="/trainer/workbooks/import" className={kind !== 'assessment' ? 'on' : ''}>Workbook</Link>
            <Link to="/trainer/assessments/import" className={kind === 'assessment' ? 'on' : ''}>Assessment</Link>
          </div>
        )}
      </div>
      <div className="ir-how">
        <h3>What happens next</h3>
        <ol>
          <li><b>We read the document</b>Headings become exercises. Tables, pictures and Word's "Click or tap here" boxes come across.</li>
          <li><b>You review it</b>See it as participants will. Empty cells beside labels and anything else we weren't sure about are listed, so you can say yes or no.</li>
          <li><b>Fix in one click</b>Click an empty cell to make it an answer box, or use "What is this?" on a line.</li>
          <li><b>Create</b>Only then is the {noun} saved.</li>
        </ol>
        <details className="ir-power">
          <summary>Power user: markers you can type in Word</summary>
          <p>
            <code>[SHORT: …]</code>, <code>[LONG: …]</code>, <code>[CHOICE: q | a | b]</code>, <code>[CHECK: q | a | b]</code> on their own line;
            {' '}<code>[INPUT:short]</code> or <code>[INPUT:long]</code> in a table cell. Heading 1 / Heading 2 make sections.
            They still work, and are never required.
          </p>
        </details>
      </div>
    </div>
  );
}
