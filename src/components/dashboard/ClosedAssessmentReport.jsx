import { useMemo } from 'react';
import { useSessionAssessmentResponses } from '../../hooks/useSessionAssessmentResponses.js';
import { AssessmentReportView } from './AssessmentReport.jsx';

// The L&D Training Report for a CLOSED session, from its saved summary.
//
// Same component as the live Report tab (AssessmentReportView), fed from the
// snapshot instead of the live tables — the participants' answers and marks
// were saved at close because closing deletes the accounts they belong to.
//
// Where the QUESTIONS come from, in order of preference:
//   1. assessment.structure in the summary — frozen at close from 2026-09-11.
//   2. the session's own copy of the assessment, if it still exists — for
//      sessions closed before questions were frozen (e.g. Venky-test).
//   3. neither — only the group sheet, from the scores recorded at close.
// The same fallback covers a summary the retention job has slimmed: its
// answers and marks are gone, so there are no areas of error left to list.
export default function ClosedAssessmentReport({ snapshot, liveAssessmentId }) {
  const a = snapshot.assessment || null;
  const archived = !!snapshot.retention?.detail_removed_at;
  const frozen = a?.structure && Array.isArray(a.structure.blocks) ? a.structure : null;
  const hasAnswers = !archived && !!a?.answers && typeof a.answers === 'object';
  const needLoad = hasAnswers && !frozen && !!liveAssessmentId;

  const loaded = useSessionAssessmentResponses(
    needLoad ? snapshot.session?.id : null,
    needLoad ? liveAssessmentId : null,
    { live: false },
  );

  const participants = snapshot.participants || [];

  const data = useMemo(() => {
    if (!a) return null;
    if (hasAnswers && frozen) {
      const answerKey = {};
      const answerPoints = {};
      const answerModes = {};
      for (const [id, k] of Object.entries(frozen.keys || {})) {
        answerKey[id] = k.key;
        answerPoints[id] = Number(k.points) || 1;
        answerModes[id] = k.marking_mode || 'auto';
      }
      return { sections: frozen.sections || [], blocks: frozen.blocks || [], answerKey, answerPoints, answerModes };
    }
    if (hasAnswers && needLoad) {
      if (loaded.loading || loaded.error) return null;
      return {
        sections: loaded.sections, blocks: loaded.blocks,
        answerKey: loaded.answerKey, answerPoints: loaded.answerPoints, answerModes: loaded.answerModes,
      };
    }
    return null;
  }, [a, hasAnswers, frozen, needLoad, loaded.loading, loaded.error, loaded.sections, loaded.blocks,
    loaded.answerKey, loaded.answerPoints, loaded.answerModes]);

  if (!a) return <p className="muted">This session closed without an assessment record.</p>;

  // No questions available (or no answers left): group sheet from the
  // recorded scores only.
  const questionsGone = !hasAnswers || (!frozen && (!liveAssessmentId || loaded.error));
  if (questionsGone) {
    const byId = new Map(participants.map(p => [p.id, p]));
    const recorded = (a.results || [])
      .map(r => ({ ...r, participant: byId.get(r.participant_id) }))
      .filter(r => r.participant);
    const note = archived
      ? 'This session is archived: its answers and marks were removed under the data-retention policy. The group report below uses the scores recorded at close; individual reports with areas of error are no longer available.'
      : 'This session\'s questions are no longer available, so only the group report can be printed, from the scores recorded at close.';
    return (
      <AssessmentReportView
        closed
        session={snapshot.session}
        participants={participants}
        passMark={a.pass_mark ?? null}
        recorded={recorded}
        recordedNote={note}
        loading={false}
        error={null}
      />
    );
  }

  return (
    <AssessmentReportView
      closed
      session={snapshot.session}
      participants={participants}
      sections={data?.sections || []}
      blocks={data?.blocks || []}
      answers={a.answers || {}}
      answerKey={data?.answerKey || {}}
      answerPoints={data?.answerPoints || {}}
      answerModes={data?.answerModes || {}}
      marks={a.marks || {}}
      passMark={a.pass_mark ?? null}
      loading={!data}
      error={null}
    />
  );
}
