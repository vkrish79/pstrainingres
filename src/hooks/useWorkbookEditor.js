import { useCallback } from 'react';
import { useContentEditor } from './useContentEditor.js';

const WORKBOOK_KIND = {
  parentTable: 'workbooks',
  sectionsTable: 'sections',
  blocksTable: 'blocks',
  parentFK: 'workbook_id',
};

// Workbook-specific wrapper around useContentEditor. Preserves the legacy
// API (workbook, updateWorkbookTitle, updateVendorVisible, deleteWorkbook) so
// WorkbookEditorPage and downstream callers don't need to know about the
// generalized hook.
export function useWorkbookEditor(workbookId) {
  const ce = useContentEditor(WORKBOOK_KIND, workbookId);

  const updateWorkbookTitle = useCallback(
    (title) => ce.updateParentField({ title }),
    [ce],
  );
  const updateVendorVisible = useCallback(
    (vendor_visible) => ce.updateParentField({ vendor_visible }),
    [ce],
  );

  return {
    loading: ce.loading,
    error: ce.error,
    workbook: ce.parent,
    sections: ce.sections,
    blocks: ce.blocks,
    updateWorkbookTitle,
    updateVendorVisible,
    createBlock: ce.createBlock,
    updateBlock: ce.updateBlock,
    deleteBlock: ce.deleteBlock,
    moveBlock: ce.moveBlock,
    duplicateBlock: ce.duplicateBlock,
    createSection: ce.createSection,
    updateSectionTitle: ce.updateSectionTitle,
    deleteSection: ce.deleteSection,
    deleteWorkbook: ce.deleteParent,
    reload: ce.reload,
  };
}
