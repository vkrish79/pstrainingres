import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';

// Participant-written section notes for the current session.
// Shape: notes[sectionId] = { id, note, updated_at }. Notes are stored as a
// constrained HTML subset (see lib/notesRichText.js). `sessionId` /
// `participantId` may be null on first render; the hook no-ops until both set.
export function useParticipantNotes(sessionId, participantId) {
  const [notes, setNotes] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId || !participantId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('participant_notes')
        .select('id, section_id, note, updated_at')
        .eq('session_id', sessionId)
        .eq('participant_id', participantId);
      if (cancelled) return;
      const map = {};
      (data || []).forEach(n => { map[n.section_id] = n; });
      setNotes(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionId, participantId]);

  // Immediate upsert. The editor is uncontrolled and only calls this on flush
  // (drawer close / card blur / collapse), so there's no per-keystroke churn —
  // that's what keeps typing responsive.
  const saveNote = useCallback(async (sectionId, note) => {
    setNotes(prev => ({
      ...prev,
      [sectionId]: { ...(prev[sectionId] || {}), section_id: sectionId, note },
    }));
    if (!sessionId || !participantId) return;
    const { data, error } = await supabase
      .from('participant_notes')
      .upsert(
        { session_id: sessionId, participant_id: participantId, section_id: sectionId, note: note || '' },
        { onConflict: 'session_id,participant_id,section_id' },
      )
      .select()
      .single();
    if (!error && data) {
      setNotes(prev => ({ ...prev, [sectionId]: data }));
    }
  }, [sessionId, participantId]);

  return { notes, loading, saveNote };
}
