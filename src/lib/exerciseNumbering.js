import { supabase } from './supabase.js';

// Matches "Exercise 12", "Ex 12", "exercise1" — a bare numbered-exercise title.
// Descriptive titles ("PNR Creation…") don't match and are left alone.
const EX_PATTERN = /^\s*(?:exercise|ex)\s*\d+\s*$/i;

// Renumber the "Exercise N"-style sections of a workbook into a clean running
// sequence (1, 2, 3…) in workbook order, so exercises copied from other
// workbooks follow the new workbook's numbering instead of carrying their
// source number. Non-matching titles keep their names and don't consume a
// number. Returns how many titles changed.
export async function renumberExercises(workbookId) {
  const { data: secs, error } = await supabase
    .from('sections').select('id, title, order_index, kind')
    .eq('workbook_id', workbookId).order('order_index');
  if (error || !secs) return 0;
  let rank = 0;
  const updates = [];
  for (const s of secs) {
    if (s.kind === 'group') continue;
    if (!EX_PATTERN.test(s.title || '')) continue;
    rank += 1;
    const want = `Exercise ${rank}`;
    if (s.title !== want) updates.push(supabase.from('sections').update({ title: want }).eq('id', s.id));
  }
  if (updates.length) await Promise.all(updates);
  return updates.length;
}
