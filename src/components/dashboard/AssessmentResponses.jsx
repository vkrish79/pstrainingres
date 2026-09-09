import { useSessionAssessmentResponses } from '../../hooks/useSessionAssessmentResponses.js';
import { useAssessmentMarks } from '../../hooks/useAssessmentMarks.js';
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
  const { marks, setMark, setComment, clearMark, savingIds, error: marksError } = useAssessmentMarks(sessionId);

  if (!assessmentId) {
    return <div className="muted" style={{ padding: '1rem' }}>This session has no attached assessment.</div>;
  }
  if (loading) return <div className="loading">Loading assessment responses…</div>;
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

  return (
    <>
      {marksError && <div className="error" style={{ padding: '0.5rem 1rem' }}>{marksError}</div>}
      <ExerciseResponses
        sections={sections}
        blocks={liveBlocks}
        participants={participants}
        answers={answers}
        answerKey={answerKey}
        answerPoints={answerPoints}
        answerModes={answerModes}
        marks={marks}
        onMark={handleMark}
        onComment={handleComment}
        markingIds={savingIds}
        showNotes={false}
        emptyLabel="No questions in this assessment yet."
        questionNumbers={labelByBlockId}
      />
    </>
  );
}
