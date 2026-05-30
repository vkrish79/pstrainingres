import { useContentPrep, ASSESSMENT_PREP_KIND } from './useContentPrep.js';

// Assessment-specific wrapper around useContentPrep. Same partition semantics
// as workbooks (vendor_id NULL = super pool). PR2b kits stay super-only at RLS;
// vendor partitions open in PR4.
export function useAssessmentPrep(assessmentId, vendorId) {
  return useContentPrep(ASSESSMENT_PREP_KIND, assessmentId, vendorId);
}
