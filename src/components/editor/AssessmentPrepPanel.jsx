import { useMemo } from 'react';
import ContentPrepPanel from './ContentPrepPanel.jsx';
import { buildQuestions } from '../../lib/assessmentStructure.js';

// Assessment prep template setup — no composed/extract flow (assessments are
// program-internal; cross-asset prep references are workbook-only in PR2b).
//
// `allSections` is every question including unsaved ones, and exists only for
// NUMBERING: a question's number is its position on the paper, so numbering the
// saved ones alone would call the checklist's "Question 4" something the editor
// below it is showing as "Question 5". Only saved questions are listed — a
// draft has no id for a prep column to point at.
export default function AssessmentPrepPanel({ assessment, sections, allSections = null, profile, onTemplate }) {
  const displayTitles = useMemo(() => {
    const map = {};
    for (const q of buildQuestions(allSections || sections, []).questions) map[q.section.id] = q.heading;
    return map;
  }, [allSections, sections]);

  return (
    <ContentPrepPanel
      parentTable="assessments"
      parentId={assessment?.id}
      sections={sections}
      profile={profile}
      kindLabel="assessment"
      displayTitles={displayTitles}
      onTemplate={onTemplate}
    />
  );
}
