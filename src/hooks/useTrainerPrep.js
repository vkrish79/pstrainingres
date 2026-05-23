import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Trainer-side, SESSION-scoped practice prep (the trainer's "My copy" prep).
// Mirrors useParticipantPrep but keyed by session, not participant — see the
// 20260523000000_trainer_prep migration for why.
//   prep[sectionId] = { content, updated_at }   — exercise-linked
//   standalone = [{ label, content }]            — not tied to an exercise
//   drawPrep() -> claim_trainer_prep_kit RPC; consumes one pool kit.
export function useTrainerPrep(sessionId) {
  const [prep, setPrep] = useState({});
  const [standalone, setStandalone] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!sessionId) return;
    const [{ data: secRows }, { data: stdRows }] = await Promise.all([
      supabase.from('trainer_prep')
        .select('section_id, content, updated_at').eq('session_id', sessionId),
      supabase.from('trainer_prep_standalone')
        .select('label, content, updated_at').eq('session_id', sessionId).order('label'),
    ]);
    const map = {};
    (secRows || []).forEach(r => { map[r.section_id] = r; });
    setPrep(map);
    setStandalone(stdRows || []);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  // Realtime: refetch on any change (the prep set is tiny).
  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`trainer-prep-${sessionId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'trainer_prep', filter: `session_id=eq.${sessionId}` },
        () => load())
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'trainer_prep_standalone', filter: `session_id=eq.${sessionId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId, load]);

  // Draw one kit from the pool into this session's trainer prep. Returns the
  // RPC payload ({ status, prepped }) or { error }.
  const drawPrep = useCallback(async () => {
    const { data, error } = await supabase.rpc('claim_trainer_prep_kit', { p_session_id: sessionId });
    if (error) return { error };
    await load();
    return { data };
  }, [sessionId, load]);

  const hasPrep = Object.keys(prep).length > 0 || standalone.length > 0;
  return { prep, standalone, loading, hasPrep, drawPrep };
}
