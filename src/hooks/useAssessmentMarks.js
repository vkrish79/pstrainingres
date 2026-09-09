import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Marks a trainer has awarded by hand, for one session.
//
// This is the first thing in the system that STORES a marking decision.
// Automatic scores are recomputed on every render from the key and the answer,
// because they can be — a person's judgement cannot, so it has to be kept.
// Table and RLS: supabase/migrations/20260909000000_manual_marking.sql.
//
// Shape: { [participantId]: { [blockId]: { awarded, comment, marked_by_name, marked_at } } }
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
        // select('*') rather than a column list ON PURPOSE. Naming a column
        // PostgREST does not have is a hard 400, so listing `comment` here would
        // mean that until the ALTER in 20260912000000_mark_comments.sql has been
        // run, this read fails outright and EVERY mark already awarded vanishes
        // from the marking screen — marks that are safely in the database would
        // read as "not marked yet". A missing key in a returned row is harmless
        // by comparison, so the frontend stays deployable in either order.
        .select('*')
        .eq('session_id', sessionId);
      if (cancelled) return;
      if (loadErr) { setError(loadErr.message || String(loadErr)); return; }
      const byParticipant = {};
      for (const row of data || []) {
        (byParticipant[row.participant_id] ||= {})[row.assessment_block_id] = {
          awarded: Number(row.awarded),
          comment: row.comment || '',
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
        // Re-awarding must not wipe the comment. The upsert below deliberately
        // omits `comment` from its payload so the stored one survives; local
        // state has to agree, or the box would blank until the next reload.
        [blockId]: {
          ...(prev[participantId]?.[blockId] || {}),
          awarded,
          marked_by_name: marker?.name || null,
          marked_at: now,
        },
      },
    }));

    // `comment` is intentionally absent from this payload. PostgREST only
    // updates the columns it is sent, so re-marking a question leaves the
    // reason written against it intact.
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

  // The reason behind a mark. Saved against an EXISTING mark — awarded is NOT
  // NULL, so there is no row to comment on until something has been awarded,
  // and the UI only offers the box once it has been.
  //
  // Deliberately an update() and not an upsert(): an upsert here would happily
  // invent a mark of zero for a question nobody had judged, turning "I typed a
  // note" into "I failed them".
  const setComment = useCallback(async (participantId, blockId, comment) => {
    const busyId = `${participantId}:${blockId}`;
    const text = (comment || '').trim();
    setSavingIds(prev => new Set(prev).add(busyId));

    setMarks(prev => {
      const existing = prev[participantId]?.[blockId];
      if (!existing) return prev; // nothing marked — nothing to attach to
      return {
        ...prev,
        [participantId]: { ...prev[participantId], [blockId]: { ...existing, comment: text } },
      };
    });

    // .select() is not decoration. A blocked update returns 200 with no error
    // and zero rows, so without reading the row back a refusal looks exactly
    // like a success and the comment vanishes on the next reload.
    const { data, error: saveErr } = await supabase
      .from('assessment_marks')
      .update({ comment: text || null })
      .eq('participant_id', participantId)
      .eq('assessment_block_id', blockId)
      .select('participant_id');

    setSavingIds(prev => { const n = new Set(prev); n.delete(busyId); return n; });
    if (saveErr) { setError(saveErr.message || String(saveErr)); return { error: saveErr }; }
    if (!data || data.length === 0) {
      const msg = 'Comment was not saved — the mark it belongs to is missing, or you do not have permission to change it.';
      setError(msg);
      return { error: new Error(msg) };
    }
    setError(null);
    return {};
  }, []);

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

  return { marks, setMark, setComment, clearMark, savingIds, error };
}
