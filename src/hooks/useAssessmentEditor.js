import { useCallback } from 'react';
import { useContentEditor } from './useContentEditor.js';

const ASSESSMENT_KIND = {
  parentTable: 'assessments',
  sectionsTable: 'assessment_sections',
  blocksTable: 'assessment_blocks',
  parentFK: 'assessment_id',
};

// Assessment-specific wrapper around useContentEditor. Same content surface
// as workbooks (sections + blocks + reorder), but without workbook-only
// concerns (no vendor_visible, no prep templates, no add-from-other modal).
export function useAssessmentEditor(assessmentId) {
  const ce = useContentEditor(ASSESSMENT_KIND, assessmentId);

  const updateAssessmentTitle = useCallback(
    (title) => ce.updateParentField({ title }),
    [ce],
  );
  const updateAssessmentDescription = useCallback(
    (description) => ce.updateParentField({ description }),
    [ce],
  );

  return {
    loading: ce.loading,
    error: ce.error,
    assessment: ce.parent,
    sections: ce.sections,
    blocks: ce.blocks,
    updateAssessmentTitle,
    updateAssessmentDescription,
    createBlock: ce.createBlock,
    updateBlock: ce.updateBlock,
    deleteBlock: ce.deleteBlock,
    moveBlock: ce.moveBlock,
    duplicateBlock: ce.duplicateBlock,
    createSection: ce.createSection,
    updateSectionTitle: ce.updateSectionTitle,
    deleteSection: ce.deleteSection,
    deleteAssessment: ce.deleteParent,
    reload: ce.reload,
  };
}
