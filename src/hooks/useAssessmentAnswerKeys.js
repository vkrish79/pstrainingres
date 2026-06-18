import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// How long to wait after the last keystroke before writing a key, and how long
// to let a single write run before we treat it as failed.
const SAVE_DEBOUNCE_MS = 400;
const SAVE_TIMEOUT_MS = 10000;

// A write that never resolves (e.g. a stuck/contended row) would otherwise hang
// silently forever. Race it against a timeout so the editor can surface it.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('save timed out — the request did not complete')), ms)
    ),
  ]);
}

// Loads + manages the answer keys for an assessment template's blocks. Writes
// go to assessment_answer_keys (super-only RLS). Keyed by assessment_block_id;
// the key value mirrors a participant answer's shape (string | string[] | {cellId}).
//
// Saves are DEBOUNCED per block: typing a short-text/fill-blank key fires one
// onChange per keystroke, and upserting on each would launch a burst of
// concurrent writes against the same primary-key row (wasteful, and they
// contend). Instead we update local state immediately (responsive UI) and
// coalesce the network upsert to SAVE_DEBOUNCE_MS after the last edit.
export function useAssessmentAnswerKeys(blockIds) {
  const [keys, setKeys] = useState({}); // { [blockId]: key }
  const [error, setError] = useState(null); // surfaced to the editor so a failed
  // load/save isn't silent (e.g. the table missing, or a write that hangs).
  const idsKey = (blockIds || []).join(',');

  const timers = useRef({});  // { [blockId]: timeoutId } — pending debounced saves
  const pending = useRef({}); // { [blockId]: key } — latest value awaiting write

  useEffect(() => {
    const ids = (blockIds || []);
    if (!ids.length) { setKeys({}); return undefined; }
    let cancelled = false;
    (async () => {
      const { data, error: loadErr } = await supabase
        .from('assessment_answer_keys')
        .select('assessment_block_id, key')
        .in('assessment_block_id', ids);
      if (cancelled) return;
      if (loadErr) { setError(loadErr.message || String(loadErr)); return; }
      const m = {};
      (data || []).forEach(k => { m[k.assessment_block_id] = k.key; });
      setKeys(m);
      setError(null);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Write the latest pending value for one block right now (cancels its timer).
  const flushKey = useCallback((blockId) => {
    if (timers.current[blockId]) { clearTimeout(timers.current[blockId]); delete timers.current[blockId]; }
    if (!(blockId in pending.current)) return;
    const key = pending.current[blockId];
    delete pending.current[blockId];
    const run = supabase
      .from('assessment_answer_keys')
      .upsert({ assessment_block_id: blockId, key }, { onConflict: 'assessment_block_id' });
    withTimeout(run, SAVE_TIMEOUT_MS)
      .then(({ error: saveErr }) => setError(saveErr ? (saveErr.message || String(saveErr)) : null))
      .catch((e) => setError(e.message || String(e)));
  }, []);

  const setKey = useCallback((blockId, key) => {
    setKeys(prev => ({ ...prev, [blockId]: key })); // immediate, responsive UI
    pending.current[blockId] = key;
    if (timers.current[blockId]) clearTimeout(timers.current[blockId]);
    timers.current[blockId] = setTimeout(() => flushKey(blockId), SAVE_DEBOUNCE_MS);
  }, [flushKey]);

  const clearKey = useCallback(async (blockId) => {
    // Drop any pending debounced save so it can't resurrect the cleared key.
    if (timers.current[blockId]) { clearTimeout(timers.current[blockId]); delete timers.current[blockId]; }
    delete pending.current[blockId];
    setKeys(prev => { const n = { ...prev }; delete n[blockId]; return n; });
    const run = supabase
      .from('assessment_answer_keys')
      .delete()
      .eq('assessment_block_id', blockId);
    try {
      const { error: delErr } = await withTimeout(run, SAVE_TIMEOUT_MS);
      setError(delErr ? (delErr.message || String(delErr)) : null);
      return { error: delErr };
    } catch (e) {
      setError(e.message || String(e));
      return { error: e };
    }
  }, []);

  // On unmount, flush anything still pending so an in-progress edit isn't lost
  // (e.g. the trainer types a key then immediately navigates away).
  useEffect(() => {
    const t = timers.current;
    return () => { Object.keys(t).forEach((id) => flushKey(id)); };
  }, [flushKey]);

  return { keys, setKey, clearKey, error };
}
