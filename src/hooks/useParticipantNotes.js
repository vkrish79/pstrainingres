import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.js';

const SAVE_DEBOUNCE_MS = 600;

// Participant-written section notes for the current session.
// Shape:
//   notes[sectionId]      = { id, note, updated_at }
//   savingMap[sectionId]  = 'saving' | 'saved' | 'error'  (undefined if untouched)
// `sessionId` and `participantId` may be null on first render; the hook
// no-ops until both are set.
export function useParticipantNotes(sessionId, participantId) {
  const [notes, setNotes] = useState({});
  const [savingMap, setSavingMap] = useState({});
  const [loading, setLoading] = useState(true);
  const timersRef = useRef({});

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

  // Debounced upsert: callers can fire on every keystroke and we coalesce.
  // Optimistic local update so the textarea stays responsive.
  const saveNote = useCallback((sectionId, note) => {
    setNotes(prev => ({
      ...prev,
      [sectionId]: { ...(prev[sectionId] || {}), section_id: sectionId, note },
    }));
    setSavingMap(prev => ({ ...prev, [sectionId]: 'saving' }));

    if (timersRef.current[sectionId]) clearTimeout(timersRef.current[sectionId]);
    timersRef.current[sectionId] = setTimeout(async () => {
      if (!sessionId || !participantId) return;
      const payload = {
        session_id: sessionId,
        participant_id: participantId,
        section_id: sectionId,
        note: note || '',
      };
      const { data, error } = await supabase
        .from('participant_notes')
        .upsert(payload, { onConflict: 'session_id,participant_id,section_id' })
        .select()
        .single();
      if (error) {
        setSavingMap(prev => ({ ...prev, [sectionId]: 'error' }));
        return;
      }
      if (data) {
        setNotes(prev => ({ ...prev, [sectionId]: data }));
        setSavingMap(prev => ({ ...prev, [sectionId]: 'saved' }));
      }
    }, SAVE_DEBOUNCE_MS);
  }, [sessionId, participantId]);

  return { notes, loading, saveNote, savingMap };
}
