import { useState } from 'react';
import { useServerOffset } from '../../lib/serverTime.js';
import '../../styles/workbook-done.css';

// Shown once every box in the workbook has an answer: says so, and what comes
// next — the assessment in whatever state it is in, and a copy to take away.
// The header alone used to change to "Every question answered" and stop there.
//
// Download is the same print path as ⋯ → Print / Download PDF (cover page and
// their notes included); it stays in ⋯ too.
//
// Hideable, remembered per session in this browser: someone going over their
// answers on the last day has read it once and needs the room back.
export default function WorkbookDoneCard({ sessionId, exerciseCount, assessment, onOpenAssessment, onDownload }) {
  const key = `wb-done-hidden:${sessionId}`;
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
  });
  const offset = useServerOffset();
  if (hidden) return null;

  function hide() {
    setHidden(true);
    try { localStorage.setItem(key, '1'); } catch { /* private window: hides for this visit */ }
  }

  return (
    <section className="wb-done no-print" aria-label="Workbook finished">
      <div className="wb-done-mark" aria-hidden="true">✓</div>
      <div className="wb-done-text">
        <h2>All {exerciseCount} exercise{exerciseCount === 1 ? '' : 's'} answered</h2>
        <p>Your trainer goes over them with the class. Your notes are kept with your answers.</p>
      </div>
      <div className="wb-done-actions">
        {assessment?.id && <AssessmentStep assessment={assessment} offset={offset} onOpen={onOpenAssessment} />}
        <button type="button" className="wb-done-download" onClick={onDownload}>↓ Download my workbook (PDF)</button>
      </div>
      <button type="button" className="wb-done-hide" onClick={hide} aria-label="Hide" data-tip="Hide this">×</button>
    </section>
  );
}

// The next step, in the assessment's own state: not open yet, open, finished
// (P1's "I've finished"), or closed.
function AssessmentStep({ assessment, offset, onOpen }) {
  if (!assessment.unlockedAt) {
    return <span className="wb-done-next is-locked">🔒 Assessment · your trainer opens it when it's time</span>;
  }
  if (assessment.finishedAt) {
    return <button type="button" className="wb-done-next is-done" onClick={onOpen}>✓ Assessment · your answers are in</button>;
  }
  const deadline = assessment.deadlineAt ? new Date(assessment.deadlineAt).getTime() : null;
  if (deadline && deadline <= Date.now() + offset) {
    return <button type="button" className="wb-done-next is-done" onClick={onOpen}>Assessment · closed</button>;
  }
  return <button type="button" className="wb-done-next is-open" onClick={onOpen}>Start the assessment →</button>;
}
