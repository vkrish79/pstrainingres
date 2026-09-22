import { useSessionAssessmentResponses } from '../../hooks/useSessionAssessmentResponses.js';
import { SkeletonTable } from '../Skeleton.jsx';
import { useAssessmentMarks } from '../../hooks/useAssessmentMarks.js';
import { useSessionCriteria } from '../../hooks/useSessionCriteria.js';
import { resolveMarking } from '../../lib/markingCriteria.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { buildQuestions } from '../../lib/assessmentStructure.js';
import { isInactiveBlock } from '../../lib/assessmentScoring.js';
import ExerciseResponses from './ExerciseResponses.jsx';

// Trainer live view of participant assessment answers — the assessment twin of
// the workbook "By exercise" view. Reuses ExerciseResponses (a pure
// presentational component) fed with assessment sections/blocks/answers, with
// trainer notes/flags and the live-presence popover turned off (no backend for
// either on the assessment surface). Because trainer read on assessment_answers
// is not deadline-gated, this also shows the frozen final answers post-buzzer.
//
// It is also where marking BY HAND happens: questions set to manual get ✓ / ✗
// / a part-marks box, and what is awarded is written to assessment_marks.
export default function AssessmentResponses({ sessionId, assessmentId, participants }) {
  const { profile } = useAuth();
  const {
    loading, error, sections, blocks, answers, answerKey, answerPoints, answerModes,
  } = useSessionAssessmentResponses(sessionId, assessmentId);
  const { marks, setMark, setBreakdown, setComment, clearMark, savingIds, error: marksError } = useAssessmentMarks(sessionId);
  // Criteria come through a definer function rather than a table read, because
  // a session that hasn't started is marked against the PROGRAMME's criteria,
  // which a vendor trainer has no policy to read directly.
  const { guidance, points: criteriaPoints, error: criteriaError } = useSessionCriteria(sessionId);

  if (!assessmentId) {
    return <div className="muted" style={{ padding: '1rem' }}>This session has no attached assessment.</div>;
  }
  if (loading) return <SkeletonTable rows={5} label="Loading assessment responses…" />;
  if (error) return <div className="error" style={{ padding: '1rem' }}>{error}</div>;

  // A withdrawn question is out of the paper: not shown, not marked, and out of
  // every total. Participants never received it in the first place.
  const liveBlocks = blocks.filter(b => !isInactiveBlock(b));

  // Question labels — "3", or "3(b)" for a part of a multi-part question. Read
  // from the same builder the editor and the participant's paper use, so
  // "question 3(b)" means one thing on all three screens.
  const { labelByBlockId } = buildQuestions(sections, liveBlocks);

  // null clears the mark (back to "not marked yet", which is not the same as
  // awarding zero); a number awards it.
  function handleMark(participantId, blockId, awarded) {
    if (awarded == null) return clearMark(participantId, blockId);
    return setMark(participantId, blockId, awarded, {
      id: profile?.id,
      name: profile?.full_name || null,
    });
  }

  // The reason behind a mark, saved against the mark itself. Requires one to
  // exist first, which the marking controls enforce by only offering the box
  // once something has been awarded.
  function handleComment(participantId, blockId, text) {
    return setComment(participantId, blockId, text);
  }

  // A criterion was marked or commented on. The question's own `awarded` is the
  // criteria's running total — written even when only some have been judged,
  // because a part-finished breakdown has to be stored against something and
  // losing an interrupted marker's work would be worse. What keeps a half-done
  // question out of the participant's score is manualResultFor, which reads the
  // breakdown and calls it unmarked until every criterion has a verdict.
  function handleBreakdown(participantId, blockId, breakdown, blockGuidance) {
    const { total } = resolveMarking(blockGuidance, breakdown);
    return setBreakdown(participantId, blockId, breakdown, total, {
      id: profile?.id,
      name: profile?.full_name || null,
    });
  }

  return (
    <>
      {marksError && <div className="error" style={{ padding: '0.5rem 1rem' }}>{marksError}</div>}
      {criteriaError && (
        <div className="error" style={{ padding: '0.5rem 1rem' }}>
          Marking criteria couldn’t be loaded, so questions that have them are shown
          with the plain marking control instead. {criteriaError}
        </div>
      )}
      <ExerciseResponses
        sections={sections}
        blocks={liveBlocks}
        participants={participants}
        answers={answers}
        answerKey={answerKey}
        // A question with criteria is worth what they add up to, which is what
        // the resolver returns. For an unstarted session that figure comes from
        // the programme, not from this session's copy, so it must win.
        answerPoints={{ ...answerPoints, ...criteriaPoints }}
        answerModes={answerModes}
        marks={marks}
        onMark={handleMark}
        onComment={handleComment}
        guidance={guidance}
        onBreakdown={handleBreakdown}
        markingIds={savingIds}
        showNotes={false}
        emptyLabel="No questions in this assessment yet."
        questionNumbers={labelByBlockId}
      />
    </>
  );
}
