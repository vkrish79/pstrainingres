import { supabase } from './supabase.js';
import { getLineValue, setLineValue } from './configDiff.js';

// Carrying one line of a session's change into the master workbook.
//
// This is the part that makes "Adopted" an edit rather than a note. It writes
// a single field of a single master block — never the whole config — so a
// change to one table cell cannot quietly drag along everything else that
// block has drifted on.
//
// The master is re-read at the moment of adopting, not trusted from whatever
// the page loaded earlier: this runs on a page that may have been open for a
// while, and on the change log, which never loaded the master at all.

// What the master says right now for one diff line.
//   { value, missing }  — missing: the path is gone (block restructured)
export async function readMasterLine(masterBlockId, lineKey) {
  if (!masterBlockId) return { error: 'This change could not be traced to a block in the master.' };
  const { data, error } = await supabase
    .from('blocks').select('id, block_type, config').eq('id', masterBlockId).maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: 'That block no longer exists in the master workbook.' };

  const value = getLineValue(data.block_type, data.config, lineKey);
  return { block: data, value, missing: value === undefined };
}

// Write one line into the master.
//
// `expected` is what the session started from (the diff's "before"). If the
// master no longer says that, someone has edited it since and adopting would
// silently discard their wording — so it stops and hands back what the master
// actually says. `force` is the answer to that prompt, never the default.
export async function adoptLineIntoMaster({ masterBlockId, lineKey, expected, value, force = false }) {
  const cur = await readMasterLine(masterBlockId, lineKey);
  if (cur.error) return { error: cur.error };
  if (cur.missing) {
    return { error: 'That part of the block is no longer in the master — it has been restructured since.' };
  }

  const same = (a, b) => String(a ?? '') === String(b ?? '');

  // Already says it. Not an error: adopting is then simply a no-op write we
  // can skip, and the decision still gets recorded by the caller.
  if (same(cur.value, value)) return { applied: false, alreadyMatched: true };

  if (!force && !same(cur.value, expected)) {
    return { conflict: true, masterValue: cur.value };
  }

  const next = setLineValue(cur.block.block_type, cur.block.config, lineKey, value);
  if (!next) {
    return { error: 'That part of the block is no longer in the master — it has been restructured since.' };
  }

  // .select() is not decoration. An UPDATE that RLS refuses comes back 200
  // with no error and no rows — without reading the row back, a write that
  // never happened reports success and the master silently keeps its old
  // wording.
  const { data, error } = await supabase
    .from('blocks').update({ config: next }).eq('id', masterBlockId).select('id, config');
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: 'The master block did not accept the edit — you may not have permission to change this workbook.' };
  }

  // Confirm from what came back, not from what we sent.
  const written = getLineValue(cur.block.block_type, data[0].config, lineKey);
  if (String(written ?? '') !== String(value ?? '')) {
    return { error: 'The master block was written but did not come back with the new wording.' };
  }
  return { applied: true, block: data[0] };
}
