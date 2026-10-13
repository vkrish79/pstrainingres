import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Block from '../blocks/Block.jsx';
import QuestionScoreStrip from './QuestionScoreStrip.jsx';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';

// Marking one participant's whole paper, in a slide-over on the right — the
// same way the editor's Scorecard opens. Replaces the centred full-width modal
// on the assessment (the workbook keeps it).
//
// One tab per question, each with its subtotal; the header carries the paper
// total. Totals say "so far" until every part is marked (lib/questionTally.js).
// ← / → move between participants and keep the question you are on, because
// marking is usually one question across the class.
//
// questions: [{ id, heading, narration: [block], fillable: [block], tally }]
// renderAnswers(question) renders that question's answers with the usual
// marking controls — the same component the tiles use, so a mark given here is
// the same control with the same rules.
export default function MarkingSlideOver({
  participant, position, onPrev, onNext, onClose, questions, initialQuestionId, renderAnswers, labelOf,
}) {
  const [qid, setQid] = useState(initialQuestionId || questions[0]?.id);
  const q = questions.find(x => x.id === qid) || questions[0];
  const bodyRef = useRef(null);
  const [pendingAnchor, setPendingAnchor] = useState(null);

  useBodyScrollLock(true);
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      // Only when the marker is not typing a comment or a mark.
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if (typing) return;
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      if (e.key === 'ArrowRight' && onNext) onNext();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  // A new person or question starts at the top.
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [participant.id, qid]);

  // "Next to mark" can switch question first; scroll once the part is drawn.
  useEffect(() => {
    if (!pendingAnchor) return;
    const el = document.getElementById(pendingAnchor);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPendingAnchor(null);
  }, [pendingAnchor, qid]);

  const round1 = n => Math.round(n * 10) / 10;
  const soFar = round1(questions.reduce((s, x) => s + x.tally.soFar, 0));
  const possible = round1(questions.reduce((s, x) => s + x.tally.possible, 0));
  const partsTotal = questions.reduce((s, x) => s + x.tally.parts.length, 0);
  const partsLeft = questions.reduce((s, x) => s + x.tally.left, 0);
  const complete = partsTotal > 0 && partsLeft === 0;
  const anchorOf = blockId => `exresp-b-${participant.id}-${blockId}`;

  // The first part still to mark, from the question on screen onwards.
  const start = Math.max(0, questions.findIndex(x => x.id === q?.id));
  let next = null;
  for (let i = 0; i < questions.length && !next; i += 1) {
    const cand = questions[(start + i) % questions.length];
    const part = cand.tally.parts.find(p => p.chip === 'open');
    if (part) next = { qid: cand.id, blockId: part.blockId };
  }
  function goNext() {
    if (!next) return;
    setQid(next.qid);
    setPendingAnchor(anchorOf(next.blockId));
  }

  return createPortal(
    <>
      <div className="mso-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="mso" role="dialog" aria-modal="true" aria-label={`Marking ${participant.full_name || 'participant'}`}>
        <header className="mso-head">
          <div className="mso-head-row">
            <h2>{participant.full_name || '(unnamed)'}</h2>
            <span className="muted mso-pos">{position}</span>
            <button type="button" className="ghost btn-sm" onClick={onPrev} disabled={!onPrev} data-tip="Previous participant (←)">←</button>
            <button type="button" className="ghost btn-sm" onClick={onNext} disabled={!onNext} data-tip="Next participant (→)">→</button>
            <span className="mso-total num">
              <b>{soFar}</b> {complete ? `of ${possible}` : `so far, of ${possible}`}
            </span>
            <button type="button" className="icon-btn mso-x" onClick={onClose} aria-label="Close">×</button>
          </div>
          <div className={`mso-bar${complete ? ' is-done' : ''}`}>
            <i style={{ width: `${partsTotal ? Math.round(((partsTotal - partsLeft) / partsTotal) * 100) : 0}%` }} />
          </div>
          <span className="muted mso-sub">
            {complete ? `All ${partsTotal} parts marked` : `${partsTotal - partsLeft} of ${partsTotal} parts marked`}
          </span>
        </header>

        <div className="mso-tabs" role="tablist" aria-label="Questions">
          {questions.map((x, i) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={x.id === q?.id}
              className={`mso-tab${x.id === q?.id ? ' active' : ''}`}
              onClick={() => setQid(x.id)}
              data-tip={x.heading}
            >
              <span className="mso-tab-q">Q{i + 1}</span>
              <b className="num">{x.tally.parts.length && (x.tally.left < x.tally.parts.length || x.tally.complete) ? x.tally.soFar : '—'}/{x.tally.possible}</b>
              <span className={x.tally.complete ? 'mso-tab-done' : 'mso-tab-left'}>
                {x.tally.complete ? 'done' : `${x.tally.left} left`}
              </span>
            </button>
          ))}
        </div>

        <div className="mso-body" ref={bodyRef}>
          {q && (
            <>
              {q.narration.length > 0 && (
                <details className="mso-scenario">
                  <summary>Show the question</summary>
                  <div className="mso-scenario-body">
                    {q.narration.map(b => <Block key={b.id} block={b} readOnly />)}
                  </div>
                </details>
              )}
              {q.tally.parts.length > 0 && (
                <QuestionScoreStrip heading={q.heading} tally={q.tally} labelOf={labelOf} anchorOf={anchorOf} />
              )}
              {renderAnswers(q)}
            </>
          )}
        </div>

        <footer className="mso-foot">
          <span className="muted">Saved as you mark.</span>
          <button type="button" onClick={goNext} disabled={!next}>
            {next ? 'Next to mark ↓' : 'Nothing left to mark'}
          </button>
        </footer>
      </aside>
    </>,
    document.body,
  );
}
