import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { normaliseGuidance } from '../lib/markingCriteria.js';

// The marking criteria in force for one session's assessment.
//
// This does NOT read assessment_answer_keys directly, and the difference
// matters. Criteria are late-bound: until a session starts, its questions are
// marked against the PROGRAMME's criteria, not a copy of them, so that an edit
// to the scheme reaches every session that hasn't begun. Only at the freeze —
// the first answer or the first mark — are they copied onto the session.
//
// A vendor trainer cannot read the programme's rows at all: the
// assessment_answer_keys_trainer_read policy carries `a.is_template = false`.
// So the resolution happens in assessment_criteria_for_session(), a SECURITY
// DEFINER function with the same role checks as set_assessment_unlocked, and
// this hook just calls it.
//
// Returns:
//   guidance   { [blockId]: { criteria: [...] } } — only questions that have any
//   points     { [blockId]: number } — what each of those questions is worth,
//              which follows the criteria and so may differ from the clone row
//   fromMaster { [blockId]: boolean } — true while still following the programme
export function useSessionCriteria(sessionId) {
  const [guidance, setGuidance] = useState({});
  const [points, setPoints] = useState({});
  const [fromMaster, setFromMaster] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!sessionId) { setGuidance({}); setPoints({}); setFromMaster({}); setLoaded(true); return; }
    const { data, error: rpcErr } = await supabase
      .rpc('assessment_criteria_for_session', { p_session_id: sessionId });

    setLoaded(true);
    if (rpcErr) {
      // Deliberately not fatal to the caller. Marking by hand worked before
      // criteria existed and must keep working if this read fails — otherwise a
      // problem with the rubric would take the whole marking screen down and
      // every mark already awarded would be unreachable.
      setError(rpcErr.message || String(rpcErr));
      return;
    }

    const g = {};
    const p = {};
    const fm = {};
    (data || []).forEach(row => {
      const id = row.assessment_block_id;
      if (row.guidance) {
        const n = normaliseGuidance(row.guidance);
        if (n.criteria.length) {
          g[id] = n;
          // The marks come from the same row as the criteria on purpose: they
          // are the criteria's own total, and reading one without the other is
          // how a question ends up capped below what its criteria add up to.
          p[id] = Number(row.points) || 1;
          fm[id] = !!row.from_master;
        }
      }
    });
    setGuidance(g);
    setPoints(p);
    setFromMaster(fm);
    setError(null);
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    (async () => { if (!cancelled) await load(); })();
    return () => { cancelled = true; };
  }, [load]);

  return { guidance, points, fromMaster, loaded, error, reload: load };
}
