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
  const [keys, setKeys] = useState({});       // { [blockId]: key }
  const [pointsMap, setPointsMap] = useState({}); // { [blockId]: number } — what each question is worth
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
        .select('assessment_block_id, key, points')
        .in('assessment_block_id', ids);
      if (cancelled) return;
      if (loadErr) { setError(loadErr.message || String(loadErr)); return; }
      const m = {};
      const p = {};
      (data || []).forEach(k => {
        m[k.assessment_block_id] = k.key;
        // Older rows predate the column; a question is worth 1 unless said
        // otherwise, which is exactly how marking behaved before points.
        p[k.assessment_block_id] = Number(k.points) || 1;
      });
      setKeys(m);
      setPointsMap(p);
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

  // What one question is worth. Written with UPDATE, not upsert: the row only
  // exists once the question has a key (key is NOT NULL), and points without a
  // key would mark nothing anyway — so the editor only offers this on a keyed
  // question. Separate from the key write so the two debounces can't overwrite
  // each other; PostgREST leaves columns it wasn't given alone.
  const flushPoints = useCallback((blockId) => {
    const k = `pts:${blockId}`;
    if (timers.current[k]) { clearTimeout(timers.current[k]); delete timers.current[k]; }
    if (!(k in pending.current)) return;
    const points = pending.current[k];
    delete pending.current[k];
    const run = supabase
      .from('assessment_answer_keys')
      .update({ points })
      .eq('assessment_block_id', blockId)
      .select('assessment_block_id');
    withTimeout(run, SAVE_TIMEOUT_MS)
      .then(({ data, error: saveErr }) => {
        if (saveErr) { setError(saveErr.message || String(saveErr)); return; }
        // No row came back: there is no key yet, so there was nothing to
        // update. Say so rather than leaving the editor showing a figure the
        // database never took.
        if (!data || data.length === 0) {
          setError('Marks are saved with the answer key — set the key for this question first.');
          return;
        }
        setError(null);
      })
      .catch((e) => setError(e.message || String(e)));
  }, []);

  const setPoints = useCallback((blockId, points) => {
    const n = Number(points);
    setPointsMap(prev => ({ ...prev, [blockId]: n }));
    // Below 1 the CHECK would reject it and a 0-point question would count
    // toward the total while contributing nothing. Don't send those.
    if (!Number.isFinite(n) || n <= 0) return;
    const k = `pts:${blockId}`;
    pending.current[k] = n;
    if (timers.current[k]) clearTimeout(timers.current[k]);
    timers.current[k] = setTimeout(() => flushPoints(blockId), SAVE_DEBOUNCE_MS);
  }, [flushPoints]);

  const clearKey = useCallback(async (blockId) => {
    // Drop any pending debounced save so it can't resurrect the cleared key.
    if (timers.current[blockId]) { clearTimeout(timers.current[blockId]); delete timers.current[blockId]; }
    delete pending.current[blockId];
    // The points live on the same row, so deleting the key deletes them too.
    // Drop the pending points write as well, or it would fire against a row
    // that no longer exists.
    const pk = `pts:${blockId}`;
    if (timers.current[pk]) { clearTimeout(timers.current[pk]); delete timers.current[pk]; }
    delete pending.current[pk];
    setKeys(prev => { const n = { ...prev }; delete n[blockId]; return n; });
    setPointsMap(prev => { const n = { ...prev }; delete n[blockId]; return n; });
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
  // (e.g. the trainer types a key then immediately navigates away). Points
  // timers share this map under a "pts:" prefix and must go through their own
  // writer — sending one to flushKey would try to upsert a block id of
  // "pts:<uuid>".
  useEffect(() => {
    const t = timers.current;
    return () => {
      Object.keys(t).forEach((id) => {
        if (id.startsWith('pts:')) flushPoints(id.slice(4));
        else flushKey(id);
      });
    };
  }, [flushKey, flushPoints]);

  return { keys, points: pointsMap, setKey, setPoints, clearKey, error };
}
