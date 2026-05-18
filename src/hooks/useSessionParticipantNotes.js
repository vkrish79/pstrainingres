import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Trainer-side, read-only view of participant_notes for the session.
// Shape: notes[participantId][sectionId] = { id, note, updated_at }
// Live via realtime so trainers see edits as they happen.
export function useSessionParticipantNotes(sessionId) {
  const [notes, setNotes] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('participant_notes')
        .select('id, participant_id, section_id, note, updated_at')
        .eq('session_id', sessionId);
      if (cancelled) return;
      const map = {};
      (data || []).forEach(n => {
        map[n.participant_id] = map[n.participant_id] || {};
        map[n.participant_id][n.section_id] = n;
      });
      setNotes(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`session-${sessionId}-participant-notes`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participant_notes', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          setNotes(prev => {
            const next = { ...prev };
            if (payload.eventType === 'DELETE') {
              const { participant_id, section_id } = payload.old || {};
              if (next[participant_id]) {
                const inner = { ...next[participant_id] };
                delete inner[section_id];
                next[participant_id] = inner;
              }
            } else {
              const n = payload.new;
              next[n.participant_id] = {
                ...(next[n.participant_id] || {}),
                [n.section_id]: n,
              };
            }
            return next;
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);

  return { notes, loading };
}
