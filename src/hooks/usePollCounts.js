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

  // Stops ticking once voting has closed: the numbers cannot move again, and a
  // closed poll can sit on the wall for a long discussion.
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
