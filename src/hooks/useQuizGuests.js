import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// The names in a standalone lobby, as they arrive.
//
// Realtime on quiz_guests, with the same safety net every other live thing in
// this quiz has: a slow poll underneath, because a dropped message here means
// somebody stands in a room watching a wall their name never reached.
//
// Only the host receives rows — RLS on quiz_guests admits the run's host and a
// guest's own row, nothing else. A handset subscribing to this learns its own
// name, which it already knew.
export function useQuizGuests(runId, enabled = true) {
  const [guests, setGuests] = useState([]);

  const load = useCallback(async () => {
    if (!runId || !enabled) return;
    const { data } = await supabase
      .from('quiz_guests')
      .select('id, display_name, joined_at')
      .eq('run_id', runId)
      .order('joined_at', { ascending: true });
    setGuests(data || []);
  }, [runId, enabled]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!runId || !enabled) return undefined;
    const channel = supabase
      .channel(`quiz-guests-${runId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quiz_guests', filter: `run_id=eq.${runId}` },
        () => { load(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [runId, enabled, load]);

  useEffect(() => {
    if (!runId || !enabled) return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [runId, enabled, load]);

  const remove = useCallback(async (guestId) => {
    const { error } = await supabase.rpc('quiz_remove_guest', {
      p_run_id: runId, p_guest_id: guestId,
    });
    await load();
    return error ? { error: new Error(error.message) } : { data: true };
  }, [runId, load]);

  return { guests, remove, reload: load };
}
