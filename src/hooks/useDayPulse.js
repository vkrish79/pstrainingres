import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// End-of-day pulse (A4): "How useful was today? The pace was… One word."
//
//   participant (mine: true)   the latest day the trainer asked about, and
//                              whether they have answered it
//   trainer     (mine: false)  totals per asked day — never who said what
//
// The trainer opens a day with ask(dayNo); participants learn of it live from
// day_pulse_asks (readable by the room, nothing personal in it). The answers
// themselves are only ever read through pulse_summary / pulse_mine.
// Before the SQL is applied every call fails quietly and nothing shows.
const TRAINER_POLL_MS = 20000;
const SAFETY_MS = 60000;

export const PACES = [
  { id: 'slow', label: 'Too slow' },
  { id: 'right', label: 'About right' },
  { id: 'fast', label: 'Too fast' },
];

export function useDayPulse(sessionId, { mine = false, enabled = true } = {}) {
  const [days, setDays] = useState([]);        // trainer: pulse_summary rows
  const [latest, setLatest] = useState(null);  // participant: { day_no, asked_at, answered }
  const [error, setError] = useState('');
  // The database side is not there yet (SQL not applied): the trainer's card
  // hides rather than offering a button that can only fail.
  const [unavailable, setUnavailable] = useState(false);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!sessionId || !enabled) return;
    const n = ++seq.current;
    const { data, error: e } = await supabase.rpc(mine ? 'pulse_mine' : 'pulse_summary', { p_session_id: sessionId });
    if (n !== seq.current) return;
    if (e) {
      if (isMissing(e)) setUnavailable(true);
      return; // offline: keep what we had
    }
    setUnavailable(false);
    if (mine) setLatest(data?.[0] || null);
    else setDays(data || []);
  }, [sessionId, mine, enabled]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!sessionId || !enabled) return undefined;
    const channel = supabase
      .channel(`pulse-asks-${sessionId}-${mine ? 'me' : 'all'}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'day_pulse_asks', filter: `session_id=eq.${sessionId}` },
        () => { reload(); })
      .subscribe();
    // The trainer watches answers arrive; answers are not on realtime (no one
    // may read the table directly), so they are polled while a day is open.
    const t = setInterval(reload, mine ? SAFETY_MS : TRAINER_POLL_MS);
    return () => { clearInterval(t); supabase.removeChannel(channel); };
  }, [sessionId, mine, enabled, reload]);

  const ask = useCallback(async (dayNo) => {
    const { error: e } = await supabase.rpc('pulse_ask', { p_session_id: sessionId, p_day_no: dayNo });
    if (e && isMissing(e)) { setUnavailable(true); setError(''); }
    else if (e) setError(`Couldn't ask just now: ${e.message}`);
    else setError('');
    await reload();
    return { error: e };
  }, [sessionId, reload]);

  const answer = useCallback(async (dayNo, useful, pace, word) => {
    const { error: e } = await supabase.rpc('pulse_answer', {
      p_session_id: sessionId, p_day_no: dayNo, p_useful: useful, p_pace: pace, p_word: word || null,
    });
    if (!e) setLatest(prev => (prev && prev.day_no === dayNo ? { ...prev, answered: true } : prev));
    return { error: e };
  }, [sessionId]);

  return { days, latest, error, unavailable, ask, answer, reload };
}

// PostgREST / Postgres for "no such function or table".
function isMissing(e) {
  return ['PGRST202', 'PGRST205', '42883', '42P01'].includes(e?.code)
    || /could not find the (function|table)/i.test(e?.message || '');
}
