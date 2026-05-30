import { supabase } from './supabase.js';

// Matches "Exercise 12", "Ex 12", "exercise1" — a bare numbered-exercise title.
// Descriptive titles ("PNR Creation…") don't match and are left alone.
const EX_PATTERN = /^\s*(?:exercise|ex)\s*\d+\s*$/i;

// Renumber the "Exercise N"-style sections of a parent (workbook or assessment)
// into a clean running sequence (1, 2, 3…) in parent order, so exercises copied
// from other parents follow the new sequence instead of carrying their source
// number. Non-matching titles keep their names and don't consume a number.
// Returns how many titles changed.
//
// kindConfig: { sectionsTable, parentFK }
//   sectionsTable — 'sections' | 'assessment_sections'
//   parentFK      — 'workbook_id' | 'assessment_id'
export async function renumberExercisesIn(kindConfig, parentId) {
  const { sectionsTable, parentFK } = kindConfig;
  const { data: secs, error } = await supabase
    .from(sectionsTable).select('id, title, order_index, kind')
    .eq(parentFK, parentId).order('order_index');
  if (error || !secs) return 0;
  let rank = 0;
  const updates = [];
  for (const s of secs) {
    if (s.kind === 'group') continue;
    if (!EX_PATTERN.test(s.title || '')) continue;
    rank += 1;
    const want = `Exercise ${rank}`;
    if (s.title !== want) updates.push(supabase.from(sectionsTable).update({ title: want }).eq('id', s.id));
  }
  if (updates.length) await Promise.all(updates);
  return updates.length;
}

// Workbook-specific shim preserving the legacy single-arg API. Used by
// WorkbookEditorPage and AddExercisesModal (workbook side).
export async function renumberExercises(workbookId) {
  return renumberExercisesIn(
    { sectionsTable: 'sections', parentFK: 'workbook_id' },
    workbookId,
  );
}

// Same-kind cross-import configs for AddExercisesModal.
export const WORKBOOK_CONTENT_KIND = {
  parentTable: 'workbooks',
  sectionsTable: 'sections',
  blocksTable: 'blocks',
  parentFK: 'workbook_id',
  prepTemplateCol: 'prep_template',
  addRpc: 'add_exercises_to_workbook',
  addRpcParams: (targetId, sourceIds) => ({
    p_target_workbook_id: targetId,
    p_source_section_ids: sourceIds,
  }),
  label: 'workbook',
};
export const ASSESSMENT_CONTENT_KIND = {
  parentTable: 'assessments',
  sectionsTable: 'assessment_sections',
  blocksTable: 'assessment_blocks',
  parentFK: 'assessment_id',
  prepTemplateCol: 'prep_template',
  addRpc: 'add_exercises_to_assessment',
  addRpcParams: (targetId, sourceIds) => ({
    p_target_assessment_id: targetId,
    p_source_section_ids: sourceIds,
  }),
  label: 'assessment',
};
