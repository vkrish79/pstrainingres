import { useEffect, useMemo, useState } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';
import { useSessionAssessmentResponses } from '../../hooks/useSessionAssessmentResponses.js';
import { useAssessmentMarks } from '../../hooks/useAssessmentMarks.js';
import { useAssessmentPassMark, resultOf } from '../../hooks/useAssessmentPassMark.js';
import { buildCohortReport } from '../../lib/assessmentReport.js';
import { isInactiveBlock } from '../../lib/assessmentScoring.js';
import { isFillableBlock, isAnswered, expectedInputs, filledInputs } from '../../lib/blockHelpers.js';

// The bar every active participant must clear on EVERY exercise before a
// session closes without comment. Below it, the trainer writes why.
export const CLOSE_THRESHOLD = 0.5;

// Exercises a participant is under the bar on, in workbook order. Counts
// INPUTS with the same helpers the roster's progress bars use, so the dialog
// can never name someone the screen shows as fine. An exercise with nothing to
// fill (a prose-only section) can't be under anything and is skipped.
export function exercisesBelow(sections, blocks, answersForP) {
  const out = [];
  for (const sec of sections) {
    let total = 0;
    let filled = 0;
    for (const b of blocks) {
      if (b.section_id !== sec.id || !isFillableBlock(b)) continue;
      total += expectedInputs(b);
      filled += filledInputs(b, answersForP?.[b.id]?.value);
    }
    if (total > 0 && filled / total < CLOSE_THRESHOLD) {
      out.push({ section_id: sec.id, title: sec.title || '(untitled exercise)', filled, total });
    }
  }
  return out;
}

// Close-session confirmation, with the two things that now have to be settled
// first: a written justification for anyone short of 50% on an exercise, and
// the assessment scores, which are recorded now because closing deletes the
// participants the answers belong to.
export default function CloseSessionModal({
  session, sections, blocks, participants, answers, busy, error, onConfirm, onCancel,
}) {
  useBodyScrollLock(true);
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onCancel(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const orderedSections = useMemo(
    () => [...sections].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
    [sections],
  );
  const active = participants.filter(p => !p.deactivated_at);
  const dropouts = participants.filter(p => p.deactivated_at);

  const shortfalls = useMemo(() => active
    .map(p => ({ participant: p, below: exercisesBelow(orderedSections, blocks, answers[p.id]) }))
    .filter(r => r.below.length > 0),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [participants, orderedSections, blocks, answers]);

  const [justifications, setJustifications] = useState({}); // { [participantId]: text }
  const missing = shortfalls.filter(r => !(justifications[r.participant.id] || '').trim());

  // ── Assessment ──
  const hasAssessment = !!session?.assessment_id;
  const asmt = useSessionAssessmentResponses(
    hasAssessment ? session.id : null,
    session?.assessment_id,
    { live: false },
  );
  const { marks, loaded: marksLoaded, error: marksError } = useAssessmentMarks(hasAssessment ? session.id : null);
  const { passMark, loading: passMarkLoading } = useAssessmentPassMark(session?.assessment_id);
  const asmtLoading = hasAssessment && (asmt.loading || !marksLoaded || passMarkLoading);
  const asmtFailed = hasAssessment && !asmtLoading && !!(asmt.error || marksError);

  // Scored by buildCohortReport — the same call the Report tab makes — so the
  // figure recorded at close is the figure the trainer last saw on screen.
  const asmtResults = useMemo(() => {
    if (!hasAssessment || asmtLoading || asmtFailed) return null;
    const liveBlocks = asmt.blocks.filter(b => !isInactiveBlock(b));
    const cohort = buildCohortReport({
      participants,
      sections: asmt.sections,
      blocks: asmt.blocks,
      answers: asmt.answers,
      answerKey: asmt.answerKey,
      answerPoints: asmt.answerPoints,
      answerModes: asmt.answerModes,
      marks,
    });
    return cohort.reports.map(r => {
      const forP = asmt.answers[r.participant.id] || {};
      const marksForP = marks[r.participant.id] || {};
      return {
        participant_id: r.participant.id,
        deactivated: !!r.participant.deactivated_at,
        // Sat = answered something, OR a trainer awarded marks (a paper done
        // on paper and marked by hand has no typed answers, but the Report
        // tab grades it, so it must count here too).
        sat: liveBlocks.some(b => isAnswered(b, forP[b.id]?.value) || marksForP[b.id]?.awarded != null),
        earned: r.score.earned,
        possible: r.score.possible,
        pct: r.score.pct,
        unmarked: r.unmarked.length,
        result: resultOf(r.score, passMark, r.unmarked.length),
      };
    });
  }, [hasAssessment, asmtLoading, asmtFailed, asmt.sections, asmt.blocks, asmt.answers,
    asmt.answerKey, asmt.answerPoints, asmt.answerModes, participants, marks, passMark]);

  const activeResults = (asmtResults || []).filter(r => !r.deactivated);
  const sat = activeResults.filter(r => r.sat);
  const stillToMark = sat.filter(r => r.unmarked > 0).length;

  const canClose = !busy && missing.length === 0 && !asmtLoading;

  function confirm() {
    if (!canClose) return;
    onConfirm({
      progress_check: active.map(p => {
        const row = shortfalls.find(r => r.participant.id === p.id);
        return {
          participant_id: p.id,
          below: row ? row.below : [],
          justification: row ? (justifications[p.id] || '').trim() : null,
        };
      }),
      assessment: hasAssessment ? {
        pass_mark: passMark,
        results: (asmtResults || []).map(({ deactivated, ...rest }) => rest),
      } : null,
    });
  }

  return (
    <div className="modal-backdrop visible" onClick={() => { if (!busy) onCancel(); }}>
      <div className="modal-card close-session-modal" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Close this session?</h2>
          <button className="icon-btn" onClick={onCancel} disabled={busy} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <p>Closing <strong>{session?.name}</strong> will:</p>
          <ul className="confirm-list">
            <li>Save a permanent <strong>JSON summary</strong> of every answer and note{hasAssessment ? ', and the assessment results' : ''}.</li>
            <li><strong>Permanently delete</strong> all {participants.length} participant{participants.length === 1 ? '' : 's'} and their accounts — they can no longer log in.</li>
          </ul>

          {dropouts.length > 0 && (
            <p className="muted">
              {dropouts.length} dropped out and {dropouts.length === 1 ? 'is' : 'are'} not checked below — the reason
              already recorded for {dropouts.length === 1 ? 'them' : 'each'} is kept with the session.
            </p>
          )}

          <section className="close-check">
            <h3 className="close-check-title">Progress check</h3>
            {active.length === 0 ? (
              <p className="muted">No active participants to check.</p>
            ) : shortfalls.length === 0 ? (
              <p className="close-check-ok">✓ Every active participant is at 50% or more on every exercise.</p>
            ) : (
              <>
                <p className="close-check-lead">
                  {shortfalls.length} participant{shortfalls.length === 1 ? ' is' : 's are'} under 50% on at least one
                  exercise. Say why for each — it is saved with the session record.
                </p>
                <ul className="close-check-list">
                  {shortfalls.map(({ participant: p, below }) => {
                    const text = justifications[p.id] || '';
                    const inputId = `close-justify-${p.id}`;
                    return (
                      <li key={p.id} className={`close-check-item ${text.trim() ? 'done' : ''}`}>
                        <label htmlFor={inputId} className="close-check-name">{p.full_name || '(unnamed)'}</label>
                        <div className="close-check-below">
                          {below.map(b => (
                            <span key={b.section_id} className="close-check-chip" title={`${b.filled} of ${b.total} inputs filled`}>
                              {b.title} · {Math.round((b.filled / b.total) * 100)}%
                            </span>
                          ))}
                        </div>
                        <textarea
                          id={inputId}
                          className="form-input"
                          rows={2}
                          maxLength={4000}
                          placeholder="Justification, e.g. joined late on day 2 — covered verbally"
                          value={text}
                          onChange={e => setJustifications(prev => ({ ...prev, [p.id]: e.target.value }))}
                          disabled={busy}
                        />
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          {hasAssessment && (
            <section className="close-check">
              <h3 className="close-check-title">Assessment</h3>
              {asmtLoading ? (
                <p className="muted">Scoring the assessment…</p>
              ) : asmtFailed ? (
                <p className="error">
                  The assessment could not be scored ({asmt.error || marksError}). You can still close: the raw
                  answers and marks are saved, but no scores will appear in Analytics for this session.
                </p>
              ) : (
                <>
                  <p className="close-check-lead">
                    {sat.length} of {activeResults.length} active participant{activeResults.length === 1 ? '' : 's'} answered
                    the assessment. Their scores are recorded as they stand now.
                  </p>
                  {stillToMark > 0 && (
                    <p className="close-check-warn">
                      ✋ {stillToMark} paper{stillToMark === 1 ? ' has' : 's have'} questions still to mark by hand.
                      {stillToMark === 1 ? ' It' : ' They'} will be recorded as incomplete, with no result. Cancel and
                      finish marking first if you want final scores.
                    </p>
                  )}
                  {passMark == null && (
                    <p className="muted">No pass mark is set, so no pass or fail is recorded.</p>
                  )}
                </>
              )}
            </section>
          )}

          <p className="muted">This can’t be undone. The session moves to your Closed sessions archive.</p>
          {error && <p className="error">{error}</p>}
        </div>
        <footer className="modal-foot">
          <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="danger" onClick={confirm} disabled={!canClose}>
            {busy ? 'Closing…' : 'Yes, close session'}
          </button>
          {missing.length > 0 && !busy && (
            <span className="muted close-check-gate">
              {missing.length} justification{missing.length === 1 ? '' : 's'} still needed
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}
