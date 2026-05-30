import { useContentPrep, WORKBOOK_PREP_KIND } from './useContentPrep.js';

// Workbook-specific wrapper around useContentPrep. API preserved for all
// existing callers (WorkbookPrepPanel, PrepUploadModal, useWorkbookPrepBalances).
export function useWorkbookPrep(workbookId, vendorId) {
  return useContentPrep(WORKBOOK_PREP_KIND, workbookId, vendorId);
}
