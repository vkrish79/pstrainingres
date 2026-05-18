import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Participant-side, read-only. Shape: prep[sectionId] = { content, updated_at }.
// Realtime so the trainer's upload appears live in the participant's open tab.
export function useParticipantPrep(sessionId, participantId) {
  const [prep, setPrep] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId || !participantId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('participant_prep')
        .select('section_id, content, updated_at')
        .eq('session_id', sessionId)
        .eq('participant_id', participantId);
      if (cancelled) return;
      const map = {};
      (data || []).forEach(r => { map[r.section_id] = r; });
      setPrep(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionId, participantId]);

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

  return { prep, loading };
}
