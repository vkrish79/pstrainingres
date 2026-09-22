import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Sending a changed scorecard to sessions that have already started.
//
// Sessions that HAVEN'T started need none of this: they read the programme's
// criteria directly, so an edit reaches them the moment it is saved. This is
// only for sessions past their freeze — and only the ones where nothing has
// actually happened yet.
//
// A session where anyone has answered or been marked REFUSES the change rather
// than warning about it. That is not caution for its own sake: re-weighting a
// criterion from 2 to 3 turns an award of 2 from full marks into partial and
// moves the score with nobody re-marking anything; deleting one makes its award
// vanish from the total; adding one drops every marked participant's question
// back to "not fully marked". None of that is something a trainer can
// meaningfully agree to in a dialog.
//
// The eligibility test is repeated inside push_criteria_to_sessions, so a
// session that gains its first answer while the dialog is open is still
// refused, and the function returns only what it actually updated.
export function useCriteriaPush(assessmentId, enabled = true) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pushing, setPushing] = useState(false);

  const load = useCallback(async () => {
    if (!assessmentId || !enabled) { setRows([]); return; }
    setLoading(true);
    const { data, error: rpcErr } = await supabase
      .rpc('sessions_for_criteria_push', { p_assessment_id: assessmentId });

    if (rpcErr) {
      // The function refuses anyone below super trainer. That is not an error
      // worth showing — it means this person simply doesn't get the offer.
      setRows([]);
      setError(null);
      setLoading(false);
      return;
    }

    const ids = (data || []).map(r => r.sess_id);
    let byId = {};
    if (ids.length) {
      const { data: sessRows } = await supabase
        .from('sessions')
        .select('id, name, starts_at, ends_at, closed_at')
        .in('id', ids);
      byId = Object.fromEntries((sessRows || []).map(s => [s.id, s]));
    }

    setRows((data || [])
      // A closed session is never offered, not even greyed out. Its report has
      // to reproduce exactly what was marked, so its criteria never change.
      .filter(r => !r.closed)
      .map(r => ({
        id: r.sess_id,
        answers: Number(r.answers) || 0,
        marks: Number(r.marks) || 0,
        eligible: !!r.eligible,
        session: byId[r.sess_id] || null,
      }))
      .sort((a, b) => {
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
        return (a.session?.name || '').localeCompare(b.session?.name || '');
      }));
    setError(null);
    setLoading(false);
  }, [assessmentId, enabled]);

  useEffect(() => { load(); }, [load]);

  const push = useCallback(async (sessionIds) => {
    if (!sessionIds?.length) return { data: [] };
    setPushing(true);
    const { data, error: rpcErr } = await supabase
      .rpc('push_criteria_to_sessions', { p_session_ids: sessionIds });
    setPushing(false);
    if (rpcErr) { setError(rpcErr.message || String(rpcErr)); return { error: rpcErr }; }
    setError(null);
    await load();
    return { data: data || [] };
  }, [load]);

  const eligible = rows.filter(r => r.eligible);
  const blocked = rows.filter(r => !r.eligible);

  return { rows, eligible, blocked, loading, error, pushing, push, reload: load };
}
