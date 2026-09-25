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
//
// `parentFilter` narrows the list of source parents. Workbooks need no
// narrowing; assessments do, because a question bank is an assessments row and
// must not appear in a list of assessments to copy exercises from. It is a
// function rather than a column/value pair because `workbooks` has no `kind`
// column at all, so there is nothing to compare against there.
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
  parentFilter: (q) => q,
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
  parentFilter: (q) => q.eq('kind', 'assessment'),
  label: 'assessment',
};

// Source config for the question bank picker: read a bank's questions, copy them
// into the assessment being edited. Same shape as the two above so the picker
// can stay generic, but a different RPC — add_bank_questions_to_assessment also
// carries each question's answer key, marks, marking mode and rubric, and stamps
// where the copy came from so it can be re-pulled later.
export const QUESTION_BANK_SOURCE_KIND = {
  parentTable: 'assessments',
  sectionsTable: 'assessment_sections',
  blocksTable: 'assessment_blocks',
  parentFK: 'assessment_id',
  prepTemplateCol: 'prep_template',
  addRpc: 'add_bank_questions_to_assessment',
  addRpcParams: (targetId, sourceIds) => ({
    p_target_assessment_id: targetId,
    p_source_section_ids: sourceIds,
  }),
  parentFilter: (q) => q.eq('kind', 'bank'),
  label: 'question bank',
};
