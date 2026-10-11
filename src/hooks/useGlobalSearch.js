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
  // Any group failing is reported, not shown as "No matches" — an empty list
  // on a dropped connection is a claim that nothing matches.
  const [failed, setFailed] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    // Strip characters that would break a PostgREST .or() filter string
    // (commas / parens / wildcards), then require a meaningful term.
    const term = (rawTerm || '').replace(/[,()*%_\\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (term.length < MIN_CHARS) { setResults(null); setFailed(false); setLoading(false); return undefined; }

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
        // FK named: an un-hinted profiles embed is refused outright if
        // session_participants ever has a second FK to profiles.
        .select('sessions!inner(id, name, closed_at), profiles!session_participants_participant_id_fkey!inner(id, full_name, email)')
        .or(`full_name.ilike.${like},email.ilike.${like}`, { referencedTable: 'profiles' })
        .limit(PER_GROUP);

      // Exercises (and topic headings) in master workbooks. Filtered to masters
      // IN the query: filtering after the limit would let class copies, which
      // a super can read in their hundreds, use up every slot.
      let exercisesQ = supabase
        .from('sections')
        .select('id, title, kind, order_index, workbook_id, workbooks!inner(id, title, is_template, vendor_visible)')
        .eq('workbooks.is_template', true)
        .ilike('title', like)
        .limit(PER_GROUP);
      if (!isSuper) exercisesQ = exercisesQ.eq('workbooks.vendor_visible', true);

      const queries = { workbooks: workbooksQ, exercises: exercisesQ, sessions: sessionsQ, participants: participantsQ };
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

      // A topic heading ("Split PNR") has no content of its own; opening it
      // lands on an empty page. Point each one at the first exercise after it.
      const topics = out.exercises.filter(x => x.kind === 'group');
      const firsts = await Promise.all(topics.map(t => supabase
        .from('sections').select('id, kind')
        .eq('workbook_id', t.workbook_id).gt('order_index', t.order_index)
        .order('order_index').limit(1)));
      if (seq !== seqRef.current) return;
      topics.forEach((t, i) => {
        const next = firsts[i].data?.[0];
        t.open_id = next && next.kind !== 'group' ? next.id : t.id;
      });

      setFailed(settled.some(r => r.error) || firsts.some(r => r.error));
      setResults(out);
      setLoading(false);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [rawTerm, role]);

  return { loading, results, failed };
}
