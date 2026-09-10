import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// One live quiz run, kept in step for whoever is watching it.
//
// ONE ROW IS THE WHOLE SYNCHRONISATION MECHANISM. Everyone — the projector and
// every participant — subscribes to the same quiz_runs row and re-reads
// quiz_current() when its phase changes. Nothing lives in browser memory, so a
// trainer whose laptop dies mid-quiz reopens it exactly where the room is.
//
// The realtime payload is deliberately NOT trusted for content. It says
// something changed; the answer to "what should I show" always comes back from
// quiz_current(), which is the function that decides what a participant is
// allowed to see. Rendering straight from the payload would mean the row's
// columns decide that instead, and the row does not know who is asking.
export function useQuizRun(runId) {
  const [run, setRun] = useState(null);       // phase, index, clock, options
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Server-minus-client, measured on every read. This laptop is ~32 seconds
  // out; a countdown drawn from Date.now() alone would be wrong by that much.
  const skewRef = useRef(0);

  const reload = useCallback(async () => {
    if (!runId) return;
    const { data, error: e } = await supabase.rpc('quiz_current', { p_run_id: runId });
    if (e) { setError(e.message); setLoading(false); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.server_now) skewRef.current = new Date(row.server_now).getTime() - Date.now();
    setRun(row || null);
    setLoading(false);
  }, [runId]);

  useEffect(() => { setLoading(true); reload(); }, [reload]);

  useEffect(() => {
    if (!runId) return undefined;
    const channel = supabase
      .channel(`quiz-run-${runId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quiz_runs', filter: `id=eq.${runId}` },
        () => { reload(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [runId, reload]);

  // Realtime can drop a message, and a room staring at a stale question is the
  // worst failure this feature has. A slow poll is the safety net; it is cheap
  // next to being wrong in front of sixteen people.
  useEffect(() => {
    if (!runId) return undefined;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [runId, reload]);

  // Seconds left, corrected for this machine's clock offset. Recomputed on a
  // ticker rather than stored, so it stays right across a tab being backgrounded.
  const [, force] = useState(0);
  useEffect(() => {
    if (run?.phase !== 'question' && run?.phase !== 'ready') return undefined;
    const t = setInterval(() => force(n => n + 1), 200);
    return () => clearInterval(t);
  }, [run?.phase]);

  const secondsLeft = (() => {
    if (!run?.phase_ends_at) return null;
    const endsAt = new Date(run.phase_ends_at).getTime();
    const serverNow = Date.now() + skewRef.current;
    return Math.max(0, (endsAt - serverNow) / 1000);
  })();

  return { loading, error, run, secondsLeft, reload, skewMs: skewRef.current };
}
