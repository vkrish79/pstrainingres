import { supabase } from './supabase.js';

// What to tell the trainer when an import fails, after trying to undo it.
//
// The parent row (workbook or assessment) is written first and its sections
// after, so a failure part-way through used to leave a half-built copy in the
// library under the document's title, with nothing saying so. If the parent
// was created, delete it (its sections and blocks go with it) and say which
// way that went. The delete reads its row back: a refused delete returns no
// error and removes nothing, and "nothing was kept" would then be false.
export async function importFailedMessage(err, createdId, table, noun, library) {
  const why = err?.message || String(err);
  if (!createdId) return `Couldn't create the ${noun}: ${why}. Nothing was saved.`;
  const { data, error } = await supabase.from(table).delete().eq('id', createdId).select('id');
  if (!error && data?.length) return `Couldn't create the ${noun}: ${why}. Nothing was kept — you can try again.`;
  return `Couldn't finish the ${noun}: ${why}. A half-made copy was left in ${library} — delete it there before trying again.`;
}
