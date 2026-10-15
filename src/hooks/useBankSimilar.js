import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// "Already in the bank" (T2): which bank questions read alike, and search by
// meaning. The bank-similar edge function (Supabase's built-in gte-small
// model) embeds the questions and works out the pairs; the cut-offs live
// there, next to the reasoning for them.
//
// On open it asks the edge function to (re)embed any question whose wording
// changed; the answer carries the pairs. Before the SQL and the function are
// live every call fails quietly: no pairs, and search by meaning says it's not
// available.

// Only for an older edge function that does not send pairs back (the minutes
// between a push and its deploy): the raw-score cut-offs it was tuned to.
const OLD_SIMILAR_MIN = 0.94;
const OLD_NEAR_COPY = 0.97;

export function useBankSimilar(bankId, { enabled = true } = {}) {
  const [pairs, setPairs] = useState({});      // { sectionId: [{ other_id, similarity, near }] }
  const [ready, setReady] = useState(false);   // embeddings refreshed at least once
  const [unavailable, setUnavailable] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!bankId || !enabled) return;
    const n = ++seq.current;
    const { data: res, error: fErr } = await supabase.functions.invoke('bank-similar', { body: { action: 'refresh', bank_id: bankId } });
    if (n !== seq.current) return;
    if (fErr) { setUnavailable(true); return; }
    let list = res?.pairs;
    if (!Array.isArray(list)) {
      const { data, error } = await supabase.rpc('bank_similar_pairs', { p_bank_id: bankId, p_min: OLD_SIMILAR_MIN, p_per_question: 3 });
      if (n !== seq.current) return;
      if (error) { setUnavailable(true); return; }
      list = (data || []).map(r => ({ ...r, near: Number(r.similarity) >= OLD_NEAR_COPY }));
    }
    const m = {};
    for (const r of list) (m[r.section_id] ||= []).push({ other_id: r.other_id, similarity: Number(r.similarity), near: !!r.near });
    setPairs(m);
    setUnavailable(false);
    setReady(true);
  }, [bankId, enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  // Search by meaning: { results: [{ section_id, similarity }] } best first, or { error }.
  const search = useCallback(async (text) => {
    const { data, error } = await supabase.functions.invoke('bank-similar', { body: { action: 'search', bank_id: bankId, text } });
    if (error) return { error };
    return { results: (data?.results || []).map(r => ({ ...r, similarity: Number(r.similarity) })) };
  }, [bankId]);

  return { pairs, ready, unavailable, refresh, search };
}
