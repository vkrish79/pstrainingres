import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Marks a trainer has awarded by hand, for one session.
//
// This is the first thing in the system that STORES a marking decision.
// Automatic scores are recomputed on every render from the key and the answer,
// because they can be — a person's judgement cannot, so it has to be kept.
// Table and RLS: supabase/migrations/20260909000000_manual_marking.sql.
//
// Shape: { [participantId]: { [blockId]: { awarded, marked_by_name, marked_at } } }
// — the same participant-then-block nesting the answers use, so the trainer's
// response view can read both the same way.
//
// Trainer-only by construction: the table has no participant policy at all, so
// nothing here can leak a result to the person being marked.
export function useAssessmentMarks(sessionId) {
  const [marks, setMarks] = useState({});
  const [error, setError] = useState(null);
  const [savingIds, setSavingIds] = useState(() => new Set());

  useEffect(() => {
    if (!sessionId) { setMarks({}); return undefined; }
    let cancelled = false;
    (async () => {
      const { data, error: loadErr } = await supabase
        .from('assessment_marks')
        .select('participant_id, assessment_block_id, awarded, marked_by_name, marked_at')
        .eq('session_id', sessionId);
      if (cancelled) return;
      if (loadErr) { setError(loadErr.message || String(loadErr)); return; }
      const byParticipant = {};
      for (const row of data || []) {
        (byParticipant[row.participant_id] ||= {})[row.assessment_block_id] = {
          awarded: Number(row.awarded),
          marked_by_name: row.marked_by_name,
          marked_at: row.marked_at,
        };
      }
      setMarks(byParticipant);
      setError(null);
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  // Award marks. `awarded` is clamped to 0..possible by the caller; this stores
  // whatever it is given, because the ceiling lives in another table and can be
  // edited after the fact — see the migration's note on why there is no
  // cross-table CHECK.
  const setMark = useCallback(async (participantId, blockId, awarded, marker) => {
    const busyId = `${participantId}:${blockId}`;
    setSavingIds(prev => new Set(prev).add(busyId));

    // Optimistic: marking is a rapid, repetitive action and waiting on the
    // network between each tick would make it feel broken.
    const now = new Date().toISOString();
    setMarks(prev => ({
      ...prev,
      [participantId]: {
        ...(prev[participantId] || {}),
        [blockId]: { awarded, marked_by_name: marker?.name || null, marked_at: now },
      },
    }));

    const { error: saveErr } = await supabase.from('assessment_marks').upsert({
      participant_id: participantId,
      assessment_block_id: blockId,
      session_id: sessionId,
      awarded,
      marked_by: marker?.id || null,
      marked_by_name: marker?.name || null,
      marked_at: now,
    }, { onConflict: 'participant_id,assessment_block_id' });

    setSavingIds(prev => { const n = new Set(prev); n.delete(busyId); return n; });
    if (saveErr) {
      setError(saveErr.message || String(saveErr));
      return { error: saveErr };
    }
    setError(null);
    return {};
  }, [sessionId]);

  // Undo a mark entirely — back to "not marked yet", which is a real state and
  // not the same as awarding zero.
  const clearMark = useCallback(async (participantId, blockId) => {
    setMarks(prev => {
      const forP = { ...(prev[participantId] || {}) };
      delete forP[blockId];
      return { ...prev, [participantId]: forP };
    });
    const { error: delErr } = await supabase
      .from('assessment_marks')
      .delete()
      .eq('participant_id', participantId)
      .eq('assessment_block_id', blockId);
    if (delErr) { setError(delErr.message || String(delErr)); return { error: delErr }; }
    setError(null);
    return {};
  }, []);

  return { marks, setMark, clearMark, savingIds, error };
}
