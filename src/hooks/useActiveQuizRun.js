import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Is a quiz running in this session right now?
//
// A participant never navigates to a quiz — the trainer says "we're doing a
// quiz" and it appears. So their page watches for one instead of asking them
// to find a link, which in a room of sixteen means sixteen people being read
// a URL.
//
// RLS does the gatekeeping: quiz_runs_read admits a caller who is in the run's
// roster, and quiz_start_run writes the run and the roster in one transaction
// — so by the time realtime replays the INSERT, the player row that makes it
// visible already exists.
export function useActiveQuizRun(sessionId) {
  const [runId, setRunId] = useState(null);
  const [checked, setChecked] = useState(false);

  const look = useCallback(async () => {
    if (!sessionId) return;
    // TWELVE HOURS, matching poll_fire's guard in 20260921000000_polls.sql.
    //
    // Without it "active" meant "never ended", so a lobby somebody abandoned
    // weeks ago kept every handset in that session showing a dead quiz, with no
    // way out and nothing on the trainer's screen to explain it. The database
    // already took this view — poll_fire lets a poll through over a run that
    // old — so the two halves of the app disagreed about what was running, and
    // the poll would have arrived at handsets still holding the ghost quiz.
    //
    // The boundary is twelve hours wide, so the ~32s the server runs ahead of
    // the browser (project_server_clock_ahead_of_laptop) cannot matter here.
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('quiz_runs')
      .select('id, phase')
      .eq('session_id', sessionId)
      .is('ended_at', null)
      .gt('started_at', cutoff)
      .order('started_at', { ascending: false })
      .limit(1);
    const row = data?.[0];
    setRunId(row ? row.id : null);
    setChecked(true);
  }, [sessionId]);

  useEffect(() => { look(); }, [look]);

  useEffect(() => {
    if (!sessionId) return undefined;
    const channel = supabase
      .channel(`session-${sessionId}-quizrun`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quiz_runs', filter: `session_id=eq.${sessionId}` },
        () => { look(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId, look]);

  // Safety net, same reasoning as useQuizRun: a dropped realtime message here
  // means a participant sits looking at their workbook while the room answers.
  useEffect(() => {
    if (!sessionId) return undefined;
    const t = setInterval(look, 8000);
    return () => clearInterval(t);
  }, [sessionId, look]);

  return { runId, checked };
}
