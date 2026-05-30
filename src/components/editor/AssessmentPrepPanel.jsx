import ContentPrepPanel from './ContentPrepPanel.jsx';

// Assessment prep template setup — no composed/extract flow (assessments are
// program-internal; cross-asset prep references are workbook-only in PR2b).
export default function AssessmentPrepPanel({ assessment, sections, profile }) {
  return (
    <ContentPrepPanel
      parentTable="assessments"
      parentId={assessment?.id}
      sections={sections}
      profile={profile}
      kindLabel="assessment"
    />
  );
}
