import { useContentPrepBalances } from './useContentPrepBalances.js';
import { WORKBOOK_PREP_KIND } from './useContentPrep.js';

// Workbook-specific wrapper preserving the legacy `byWorkbook` field name.
export function useWorkbookPrepBalances(vendorId) {
  const { byParent, loading, refresh } = useContentPrepBalances(WORKBOOK_PREP_KIND, vendorId);
  return { byWorkbook: byParent, loading, refresh };
}
