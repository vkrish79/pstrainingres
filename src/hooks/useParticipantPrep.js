import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Participant-side, read-only. Returns:
//   prep[sectionId] = { content, updated_at }   — exercise-linked prep
//   standalone = [{ id, label, content }]        — prep not tied to an exercise
// Realtime on both so the trainer's upload appears live in an open tab.
export function useParticipantPrep(sessionId, participantId) {
  const [prep, setPrep] = useState({});
  const [standalone, setStandalone] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId || !participantId) return;
    let cancelled = false;
    (async () => {
      const [{ data: secRows }, { data: stdRows }] = await Promise.all([
        supabase.from('participant_prep')
          .select('section_id, content, updated_at')
          .eq('session_id', sessionId).eq('participant_id', participantId),
        supabase.from('participant_prep_standalone')
          .select('id, label, content, updated_at')
          .eq('session_id', sessionId).eq('participant_id', participantId).order('label'),
      ]);
      if (cancelled) return;
      const map = {};
      (secRows || []).forEach(r => { map[r.section_id] = r; });
      setPrep(map);
      setStandalone(stdRows || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionId, participantId]);

  // Realtime: exercise-linked prep.
  useEffect(() => {
    if (!sessionId || !participantId) return;
    const channel = supabase
      .channel(`participant-${participantId}-prep`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participant_prep', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const row = payload.new || payload.old;
          if (!row || row.participant_id !== participantId) return;
          setPrep(prev => {
            const next = { ...prev };
            if (payload.eventType === 'DELETE') delete next[row.section_id];
            else next[row.section_id] = row;
            return next;
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId, participantId]);

  // Realtime: standalone prep — refetch the small list on any change.
  useEffect(() => {
    if (!sessionId || !participantId) return;
    const channel = supabase
      .channel(`participant-${participantId}-prep-standalone`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participant_prep_standalone', filter: `session_id=eq.${sessionId}` },
        async (payload) => {
          const row = payload.new || payload.old;
          if (!row || row.participant_id !== participantId) return;
          const { data } = await supabase.from('participant_prep_standalone')
            .select('id, label, content, updated_at')
            .eq('session_id', sessionId).eq('participant_id', participantId).order('label');
          setStandalone(data || []);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId, participantId]);

  return { prep, standalone, loading };
}
