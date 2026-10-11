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
// How long "✓ Helped" waits before it is sent, so a mis-click can be undone.
const UNDO_MS = 5000;

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

  // "✓ Helped", with Undo.
  //
  // Marking someone helped takes their hand off the queue, and a mis-click
  // used to drop them with no way back. Now the call waits UNDO_MS; the hand
  // leaves the screen at once, and Undo inside the window cancels the call
  // entirely, so nothing is ever written that needs reversing (no SQL).
  //
  // The hand is hidden at RENDER time (`pending`), not removed from `open`:
  // realtime and the safety re-read re-fetch it from the database during the
  // window, and editing the list would let it reappear mid-countdown.
  //
  // If the call fails when it is finally sent, the hand comes back and the
  // error is shown — a "Helped" that silently did nothing is the failure X1
  // removed. false from the RPC (they lowered it themselves) is fine.
  //
  // Leaving the page inside the window sends the pending calls at once. If the
  // tab is CLOSED inside it, the call never goes and the hand stays up — the
  // safe way to fail: the trainer sees it again, rather than a person being
  // dropped.
  const [pending, setPending] = useState({});          // { [requestId]: request }
  // Its own state, not `error`: the re-read right after a failed send succeeds
  // and clears `error`, which would wipe this message the moment it appeared.
  const [resolveError, setResolveError] = useState('');
  const timers = useRef({});

  const send = useCallback(async (requestId) => {
    delete timers.current[requestId];
    const { error: e } = await supabase.rpc('help_resolve', { p_request_id: requestId });
    setPending(p => { const n = { ...p }; delete n[requestId]; return n; });
    if (e) setResolveError(`Couldn't mark them helped — their hand is back up. ${e.message}`);
    await reload();
  }, [reload]);

  const resolve = useCallback(async (requestId) => {
    const req = open.find(r => r.id === requestId);
    if (!req || timers.current[requestId]) return {};
    setResolveError('');
    setPending(p => ({ ...p, [requestId]: req }));
    timers.current[requestId] = setTimeout(() => send(requestId), UNDO_MS);
    return {};
  }, [open, send]);

  const undoResolve = useCallback((requestId) => {
    clearTimeout(timers.current[requestId]);
    delete timers.current[requestId];
    setPending(p => { const n = { ...p }; delete n[requestId]; return n; });
  }, []);

  // Leaving the page: send what is pending now rather than dropping it.
  useEffect(() => () => {
    for (const id of Object.keys(timers.current)) {
      clearTimeout(timers.current[id]);
      // .then() is what SENDS it: a Supabase query builder does nothing
      // until it is awaited or then-ed, and nothing awaits an unmount.
      supabase.rpc('help_resolve', { p_request_id: id }).then(() => {}, () => {});
    }
    timers.current = {};
  }, []);

  const shown = open.filter(r => !pending[r.id]);
  const byParticipant = Object.fromEntries(shown.map(r => [r.participant_id, r]));
  return {
    open: shown, byParticipant, mineOpen: mine ? (open[0] || null) : null, error: resolveError || error,
    raise, lower, acknowledge, resolve, reload,
    // The "Marked … helped · Undo" toasts, one per pending hand.
    pendingHelped: Object.values(pending), undoResolve,
  };
}
