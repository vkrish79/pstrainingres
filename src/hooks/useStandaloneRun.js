import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Starting a quiz with nobody behind it, and finding the one you left running.
//
// THE SECOND HALF IS THE IMPORTANT ONE. A trainer who closes the tab has not
// ended anything: the run is live, the code still works, and a room full of
// phones is still in it. So the quiz library asks, every time it loads,
// whether this trainer has a run open — and says so at the top of the page
// with the two things they could possibly want.
export function useStandaloneRun() {
  const [live, setLive] = useState(null);
  const [checked, setChecked] = useState(false);

  const look = useCallback(async () => {
    const { data } = await supabase.rpc('quiz_my_live_run');
    const row = Array.isArray(data) ? data[0] : data;
    setLive(row || null);
    setChecked(true);
  }, []);

  useEffect(() => { look(); }, [look]);

  // While the lobby is open the count is the thing that changes, and a trainer
  // looking at this page rather than the wall still wants to see it move.
  useEffect(() => {
    if (!live?.run_id) return undefined;
    const t = setInterval(look, 5000);
    return () => clearInterval(t);
  }, [live?.run_id, look]);

  const start = useCallback(async (quizId) => {
    const { data, error } = await supabase.rpc('quiz_start_standalone', { p_quiz_id: quizId });
    if (error) return { error: new Error(error.message) };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.run_id) return { error: new Error('That quiz could not be started.') };
    await look();
    return { data: { runId: row.run_id, joinCode: row.join_code } };
  }, [look]);

  // Ending from the library, for the run whose screen is not in front of you.
  // Goes through the same RPC the projector uses, so the purge happens here
  // too — there is no second way to end a quiz and no second way to clean up.
  const end = useCallback(async (runId) => {
    const { error } = await supabase.rpc('quiz_set_phase', { p_run_id: runId, p_phase: 'ended' });
    await look();
    return error ? { error: new Error(error.message) } : { data: true };
  }, [look]);

  return { live, checked, start, end, refresh: look };
}
