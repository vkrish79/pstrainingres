import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// "Already in the bank" (T2): which bank questions read alike, and search by
// meaning. The vectors are made by the bank-similar edge function (Supabase's
// built-in gte-small model); the pairs are worked out in SQL from them.
//
// On open it asks the edge function to (re)embed any question whose wording
// changed, then reads the pairs. Before the SQL and the function are live
// every call fails quietly: no pairs, and search by meaning says it's not
// available.

// Similarity is 0–1. gte-small scores any two questions about the same
// system fairly high, so these are set from the bank's real pairs (see
// .verify/bank-similar-calibrate.mjs), not guessed.
export const SIMILAR_MIN = 0.85;   // shown as "similar"
export const NEAR_COPY = 0.93;     // shown as "nearly the same"

export function useBankSimilar(bankId, { enabled = true } = {}) {
  const [pairs, setPairs] = useState({});      // { sectionId: [{ other_id, similarity }] }
  const [ready, setReady] = useState(false);   // embeddings refreshed at least once
  const [unavailable, setUnavailable] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!bankId || !enabled) return;
    const n = ++seq.current;
    const { error: fErr } = await supabase.functions.invoke('bank-similar', { body: { action: 'refresh', bank_id: bankId } });
    if (n !== seq.current) return;
    if (fErr) { setUnavailable(true); return; }
    const { data, error } = await supabase.rpc('bank_similar_pairs', { p_bank_id: bankId, p_min: SIMILAR_MIN, p_per_question: 3 });
    if (n !== seq.current) return;
    if (error) { setUnavailable(true); return; }
    const m = {};
    for (const r of data || []) (m[r.section_id] ||= []).push({ other_id: r.other_id, similarity: Number(r.similarity) });
    setPairs(m);
    setUnavailable(false);
    setReady(true);
  }, [bankId, enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  // Search by meaning: { results: [{ section_id, similarity }] } or { error }.
  const search = useCallback(async (text) => {
    const { data, error } = await supabase.functions.invoke('bank-similar', { body: { action: 'search', bank_id: bankId, text } });
    if (error) return { error };
    return { results: (data?.results || []).map(r => ({ ...r, similarity: Number(r.similarity) })) };
  }, [bankId]);

  return { pairs, ready, unavailable, refresh, search };
}
