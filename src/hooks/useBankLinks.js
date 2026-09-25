import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Which of this assessment's questions came from a question bank, and which of
// those the bank has since changed.
//
// One RPC for the whole assessment rather than a hash lookup per question: a
// thirty-question paper would otherwise be thirty round trips to compute
// something the database does in a single pass.
//
// `links` holds EVERY bank-linked question, not only the stale ones, so the UI
// can say "3 of 8 have bank updates" — and so "nothing is stale" stays
// distinguishable from "nothing came back".
export function useBankLinks(assessmentId, enabled = true) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!assessmentId || !enabled) { setLinks([]); return; }
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase.rpc('bank_links_for_assessment', {
      p_assessment_id: assessmentId,
    });
    setLoading(false);
    if (e) { setError(e.message); return; }
    setLinks(data || []);
  }, [assessmentId, enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  const stale = links.filter(l => l.stale);
  const orphaned = links.filter(l => !l.source_exists);

  // Pull the bank's current version back into the named questions. Replaces
  // their blocks and answer keys together — a re-pull that renewed the content
  // but kept the old key would silently mark wrong answers right, because a
  // field key stores the option TEXT while the interactive types key by id.
  const resync = useCallback(async (sectionIds) => {
    if (!sectionIds?.length) return { data: 0 };
    const { data, error: e } = await supabase.rpc('resync_bank_questions', {
      p_section_ids: sectionIds,
    });
    if (e) return { error: new Error(e.message) };
    await refresh();
    return { data };
  }, [refresh]);

  return { links, stale, orphaned, loading, error, refresh, resync };
}
