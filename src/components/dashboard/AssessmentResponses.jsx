import { useSessionAssessmentResponses } from '../../hooks/useSessionAssessmentResponses.js';
import { questionNumbers } from '../../lib/blockHelpers.js';
import ExerciseResponses from './ExerciseResponses.jsx';

// Trainer live view of participant assessment answers — the assessment twin of
// the workbook "By exercise" view. Reuses ExerciseResponses (a pure
// presentational component) fed with assessment sections/blocks/answers, with
// trainer notes/flags and the live-presence popover turned off (no backend for
// either on the assessment surface). Because trainer read on assessment_answers
// is not deadline-gated, this also shows the frozen final answers post-buzzer.
export default function AssessmentResponses({ sessionId, assessmentId, participants }) {
  const { loading, error, sections, blocks, answers, answerKey } = useSessionAssessmentResponses(sessionId, assessmentId);

  if (!assessmentId) {
    return <div className="muted" style={{ padding: '1rem' }}>This session has no attached assessment.</div>;
  }
  if (loading) return <div className="loading">Loading assessment responses…</div>;
  if (error) return <div className="error" style={{ padding: '1rem' }}>{error}</div>;

  // Flat question numbers (across the single backing section), matching the
  // editor + participant view.
  const orderedBlocks = sections.flatMap(sec =>
    blocks.filter(b => b.section_id === sec.id).sort((a, b) => a.order_index - b.order_index)
  );
  const qNums = questionNumbers(orderedBlocks);

  return (
    <ExerciseResponses
      sections={sections}
      blocks={blocks}
      participants={participants}
      answers={answers}
      answerKey={answerKey}
      showNotes={false}
      emptyLabel="No questions in this assessment yet."
      questionNumbers={qNums}
    />
  );
}
