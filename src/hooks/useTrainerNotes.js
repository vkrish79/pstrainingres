import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';

// Trainer-written section notes on their own copy of the workbook — the
// trainer-side twin of useParticipantNotes, completing the trainer-copy set
// alongside useTrainerPractice (answers) and useTrainerPrep (prep).
//
// Shape: notes[sectionId] = { id, note, updated_at }. Notes are stored as a
// constrained HTML subset (see lib/notesRichText.js), so NotesDrawer can be
// reused as-is. `sessionId` / `trainerId` may be null on first render; the hook
// no-ops until both are set.
//
// Private to the author by RLS — nobody else reads these, not even a super
// trainer.
export function useTrainerNotes(sessionId, trainerId) {
  const [notes, setNotes] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId || !trainerId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('trainer_notes')
        .select('id, section_id, note, updated_at')
        .eq('session_id', sessionId)
        .eq('trainer_id', trainerId);
      if (cancelled) return;
      const map = {};
      (data || []).forEach(n => { map[n.section_id] = n; });
      setNotes(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionId, trainerId]);

  // Immediate upsert. The editor is uncontrolled and only calls this on flush
  // (drawer close / card blur / collapse), so there's no per-keystroke churn —
  // that's what keeps typing responsive.
  const saveNote = useCallback(async (sectionId, note) => {
    setNotes(prev => ({
      ...prev,
      [sectionId]: { ...(prev[sectionId] || {}), section_id: sectionId, note },
    }));
    if (!sessionId || !trainerId) return;
    const { data, error } = await supabase
      .from('trainer_notes')
      .upsert(
        { session_id: sessionId, trainer_id: trainerId, section_id: sectionId, note: note || '' },
        { onConflict: 'session_id,trainer_id,section_id' },
      )
      .select()
      .single();
    if (!error && data) {
      setNotes(prev => ({ ...prev, [sectionId]: data }));
    }
  }, [sessionId, trainerId]);

  return { notes, loading, saveNote };
}
