import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { isSuperTrainerOrAbove } from '../lib/roles.js';

// Global search across workbooks, sessions, participants, and (super-tier only)
// staff + vendors. Per-entity ilike queries run through the normal authenticated
// client, so RLS scopes every result to what the caller may see — no separate
// permission logic. Debounced; all queries resolve before results render (one
// "loaded" moment). See the global-search recommendation.
const DEBOUNCE_MS = 250;
const PER_GROUP = 6;
const MIN_CHARS = 2;

export function useGlobalSearch(rawTerm, role) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const seqRef = useRef(0);

  useEffect(() => {
    // Strip characters that would break a PostgREST .or() filter string
    // (commas / parens / wildcards), then require a meaningful term.
    const term = (rawTerm || '').replace(/[,()*%_\\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (term.length < MIN_CHARS) { setResults(null); setLoading(false); return undefined; }

    const isSuper = isSuperTrainerOrAbove(role);
    const like = `%${term}%`;
    const seq = ++seqRef.current;
    setLoading(true);

    const timer = setTimeout(async () => {
      let workbooksQ = supabase
        .from('workbooks').select('id, title, description')
        .eq('is_template', true)
        .or(`title.ilike.${like},description.ilike.${like}`)
        .limit(PER_GROUP);
      if (!isSuper) workbooksQ = workbooksQ.eq('vendor_visible', true);

      const sessionsQ = supabase
        .from('sessions').select('id, name, city_code, closed_at')
        .or(`name.ilike.${like},city_code.ilike.${like}`)
        .order('starts_at', { ascending: false, nullsFirst: false })
        .limit(PER_GROUP);

      // Participants via the enrolment join so each match carries its session
      // (for the deep-link) and RLS scopes to sessions the caller can see.
      const participantsQ = supabase
        .from('session_participants')
        .select('sessions!inner(id, name, closed_at), profiles!inner(id, full_name, email)')
        .or(`full_name.ilike.${like},email.ilike.${like}`, { referencedTable: 'profiles' })
        .limit(PER_GROUP);

      const queries = { workbooks: workbooksQ, sessions: sessionsQ, participants: participantsQ };
      if (isSuper) {
        queries.staff = supabase
          .from('profiles').select('id, full_name, email, role')
          .in('role', ['vendor_manager', 'vendor_trainer', 'trainer'])
          .or(`full_name.ilike.${like},email.ilike.${like}`)
          .limit(PER_GROUP);
        queries.vendors = supabase
          .from('vendors').select('id, code, name')
          .or(`code.ilike.${like},name.ilike.${like}`)
          .limit(PER_GROUP);
      }

      const keys = Object.keys(queries);
      const settled = await Promise.all(keys.map(k => queries[k]));
      if (seq !== seqRef.current) return; // a newer search superseded this one

      const out = {};
      keys.forEach((k, i) => { out[k] = settled[i].data || []; });
      setResults(out);
      setLoading(false);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [rawTerm, role]);

  return { loading, results };
}
