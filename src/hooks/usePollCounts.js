import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// The bars. HOST ONLY — poll_counts refuses anybody who is not running the
// session, so this hook returns an empty list for a participant no matter who
// renders it. That is the gate, and it is in the database rather than here.
//
// Layered on top of useActivePoll rather than folded into it, because the two
// have different audiences: every handset in the room calls poll_current, and
// only the trainer's screen calls this.
//
// Votes go up as they land. There is no right answer, so there is nothing to
// give away by showing them — which is the whole difference between a poll and
// a quiz question.
//
//
// THE WALL SUBSCRIBES; THE HANDSET DOES NOT. This is not an inconsistency.
//
// A participant cannot subscribe to poll_runs because `tally` is a column on
// it and RLS is row-level — see useActivePoll. But poll_votes is a table the
// TRAINER is already allowed to read, by an explicit decision, and the
// projector is the trainer's own screen. So the wall may watch votes land
// without anything new being exposed.
//
// On a two-second timer alone, votes arrived in clumps and the bars jumped.
// One vote at a time is the point.
const EVERY_MS = 2000;

export function usePollCounts(runId, { live = true } = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!runId) { setRows([]); setLoading(false); return; }
    const mine = ++seq.current;
    const { data } = await supabase.rpc('poll_counts', { p_run_id: runId });
    if (mine !== seq.current) return;
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [runId]);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);

  // A vote lands -> redraw at once. The payload is discarded and the counts
  // re-read through poll_counts rather than being adjusted locally: the
  // function is the only thing that knows the denominator, and a missed event
  // would leave a locally-tracked number wrong for the rest of the poll.
  useEffect(() => {
    if (!runId || !live) return undefined;
    const channel = supabase
      .channel(`poll-votes-${runId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'poll_votes', filter: `run_id=eq.${runId}` },
        () => { refresh(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [runId, live, refresh]);

  // The safety net, same reasoning as useQuizRun: realtime can drop a message,
  // and a wall stuck on the wrong number in front of a room is worse than a
  // wall that is occasionally two seconds late. Stops once voting closes — the
  // numbers cannot move again, and a closed poll sits there for the discussion.
  useEffect(() => {
    if (!runId || !live) return undefined;
    const t = setInterval(refresh, EVERY_MS);
    return () => clearInterval(t);
  }, [runId, live, refresh]);

  // Every row carries the same denominator; read it off the first rather than
  // making each consumer remember that.
  const voted = rows[0]?.voted ?? 0;
  const people = rows[0]?.people ?? 0;
  const most = rows.reduce((m, r) => Math.max(m, r.votes ?? 0), 0);

  return { rows, voted, people, most, loading, refresh };
}
