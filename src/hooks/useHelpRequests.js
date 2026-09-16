import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Raised hands in a session — both sides of it, one hook.
//
//   trainer     (mine: false) every open ask in the session, by participant
//   participant (mine: true)  their own open ask, if any
//
// Live through realtime, which applies the table's SELECT policy: a participant
// is only ever sent their own rows, so nobody learns who else asked. A slow
// re-read underneath is the safety net for a dropped message — a hand that
// silently fails to arrive is the one failure this feature cannot have.
const SAFETY_MS = 15000;

export function useHelpRequests(sessionId, { mine = false, selfId = null } = {}) {
  const [open, setOpen] = useState([]);   // open asks, oldest first
  const [error, setError] = useState('');
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!sessionId || (mine && !selfId)) return;
    const n = ++seq.current;
    let q = supabase
      .from('help_requests')
      .select('id, participant_id, section_id, section_title, raised_at, acknowledged_at, acknowledged_by_name')
      .eq('session_id', sessionId)
      .is('resolved_at', null)
      .order('raised_at', { ascending: true });
    if (mine) q = q.eq('participant_id', selfId);
    const { data, error: e } = await q;
    if (n !== seq.current) return;
    if (e) { setError(e.message); return; }
    setError('');
    setOpen(data || []);
  }, [sessionId, mine, selfId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!sessionId || (mine && !selfId)) return undefined;
    const channel = supabase
      .channel(`help-${sessionId}-${mine ? selfId : 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*', schema: 'public', table: 'help_requests',
          filter: mine ? `participant_id=eq.${selfId}` : `session_id=eq.${sessionId}`,
        },
        () => { reload(); },
      )
      .subscribe();
    const t = setInterval(reload, SAFETY_MS);
    return () => { clearInterval(t); supabase.removeChannel(channel); };
  }, [sessionId, mine, selfId, reload]);

  // ── participant ──
  const raise = useCallback(async (sectionId, sectionTitle) => {
    const { error: e } = await supabase.rpc('help_raise', {
      p_session_id: sessionId, p_section_id: sectionId || null, p_section_title: sectionTitle || null,
    });
    await reload();
    return { error: e };
  }, [sessionId, reload]);

  const lower = useCallback(async (how = 'cancelled') => {
    const { error: e } = await supabase.rpc('help_lower', { p_session_id: sessionId, p_how: how });
    await reload();
    return { error: e };
  }, [sessionId, reload]);

  // ── trainer ──
  const acknowledge = useCallback(async (requestId) => {
    const { error: e } = await supabase.rpc('help_acknowledge', { p_request_id: requestId });
    await reload();
    return { error: e };
  }, [reload]);

  const resolve = useCallback(async (requestId) => {
    const { error: e } = await supabase.rpc('help_resolve', { p_request_id: requestId });
    await reload();
    return { error: e };
  }, [reload]);

  const byParticipant = Object.fromEntries(open.map(r => [r.participant_id, r]));
  return { open, byParticipant, mineOpen: mine ? (open[0] || null) : null, error, raise, lower, acknowledge, resolve, reload };
}
