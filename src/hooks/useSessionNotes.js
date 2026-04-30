import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';

// Loads trainer annotations (flag + note) for a session and keeps them live.
// Shape: notes[participantId][blockId] = { id, note, flag, updated_at, trainer_id }
export function useSessionNotes(sessionId, trainerId) {
  const [notes, setNotes] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('answer_notes')
        .select('id, participant_id, block_id, note, flag, updated_at, trainer_id')
        .eq('session_id', sessionId);
      if (cancelled) return;
      const map = {};
      (data || []).forEach(n => {
        map[n.participant_id] = map[n.participant_id] || {};
        map[n.participant_id][n.block_id] = n;
      });
      setNotes(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`session-${sessionId}-notes`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'answer_notes', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          setNotes(prev => {
            const next = { ...prev };
            if (payload.eventType === 'DELETE') {
              const { participant_id, block_id } = payload.old || {};
              if (next[participant_id]) {
                const inner = { ...next[participant_id] };
                delete inner[block_id];
                next[participant_id] = inner;
              }
            } else {
              const n = payload.new;
              next[n.participant_id] = {
                ...(next[n.participant_id] || {}),
                [n.block_id]: n,
              };
            }
            return next;
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);

  const saveNote = useCallback(async ({ participantId, blockId, note, flag }) => {
    if (!sessionId || !trainerId) return { error: new Error('Missing session/trainer') };
    const payload = {
      session_id: sessionId,
      participant_id: participantId,
      block_id: blockId,
      trainer_id: trainerId,
      note: note || '',
      flag: !!flag,
    };
    const { data, error } = await supabase
      .from('answer_notes')
      .upsert(payload, { onConflict: 'session_id,participant_id,block_id' })
      .select()
      .single();
    if (error) return { error };
    setNotes(prev => ({
      ...prev,
      [participantId]: { ...(prev[participantId] || {}), [blockId]: data },
    }));
    return { data };
  }, [sessionId, trainerId]);

  const deleteNote = useCallback(async ({ participantId, blockId }) => {
    const { error } = await supabase
      .from('answer_notes')
      .delete()
      .eq('session_id', sessionId)
      .eq('participant_id', participantId)
      .eq('block_id', blockId);
    if (error) return { error };
    setNotes(prev => {
      const next = { ...prev };
      if (next[participantId]) {
        const inner = { ...next[participantId] };
        delete inner[blockId];
        next[participantId] = inner;
      }
      return next;
    });
    return {};
  }, [sessionId]);

  return { notes, loading, saveNote, deleteNote };
}
