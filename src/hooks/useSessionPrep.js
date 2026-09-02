import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { createPrepWriteBack } from '../lib/prepWriteBack.js';

// Trainer-side hook: load all prep rows for a session, expose batch upsert
// (used by the upload flow), per-row upsert + delete (used by the per-
// participant editor). Shape: prep[participantId][sectionId] = { id, content, updated_at }.
//
// saveOne also writes the value BACK into the kit it came from (prepWriteBack),
// so a session-level fix is reflected in the prep pool instead of leaving the
// pool grid showing a value the participant no longer holds. That write-back is
// secondary: it can report a `poolWarning`, but never fails the prep save.
export function useSessionPrep(sessionId) {
  const [prep, setPrep] = useState({});
  const [standalone, setStandalone] = useState({}); // [participantId] = [{label, content}]
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    const [{ data: secData }, { data: stdData }] = await Promise.all([
      supabase.from('participant_prep')
        .select('id, participant_id, section_id, content, updated_at')
        .eq('session_id', sessionId),
      supabase.from('participant_prep_standalone')
        .select('id, participant_id, label, content, updated_at')
        .eq('session_id', sessionId).order('label'),
    ]);
    const map = {};
    (secData || []).forEach(r => {
      map[r.participant_id] = map[r.participant_id] || {};
      map[r.participant_id][r.section_id] = r;
    });
    setPrep(map);
    const sMap = {};
    (stdData || []).forEach(r => {
      sMap[r.participant_id] = sMap[r.participant_id] || [];
      sMap[r.participant_id].push(r);
    });
    setStandalone(sMap);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Realtime so trainer co-editors see each other's changes.
  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`session-${sessionId}-prep`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participant_prep', filter: `session_id=eq.${sessionId}` },
        () => { refresh(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participant_prep_standalone', filter: `session_id=eq.${sessionId}` },
        () => { refresh(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId, refresh]);

  // Rebuilt per session; caches the section/template lookups, not the payload.
  const writeBack = useMemo(() => createPrepWriteBack(sessionId), [sessionId]);

  const saveOne = useCallback(async ({ participantId, sectionId, content }) => {
    if (!content || !content.trim()) {
      // Treat empty as delete.
      await supabase
        .from('participant_prep')
        .delete()
        .eq('session_id', sessionId)
        .eq('participant_id', participantId)
        .eq('section_id', sectionId);
      const cleared = await writeBack.write({ participantId, sectionId, content: '' });
      await refresh();
      return cleared.warning ? { poolWarning: cleared.warning } : {};
    }
    const { error } = await supabase
      .from('participant_prep')
      .upsert(
        { session_id: sessionId, participant_id: participantId, section_id: sectionId, content },
        { onConflict: 'session_id,participant_id,section_id' },
      );
    if (error) return { error };
    const back = await writeBack.write({ participantId, sectionId, content });
    await refresh();
    return back.warning ? { poolWarning: back.warning } : {};
  }, [sessionId, refresh, writeBack]);

  // Batch upsert used by the upload flow. `rows` is an array of
  // { participantId, sectionId, content }.
  //
  // No pool write-back here: nothing currently calls this (both live session
  // surfaces go through saveOne). If it is wired up again, it needs the same
  // writeBack.write() call per row or session edits made through it will drift
  // from the pool.
  const saveMany = useCallback(async (rows) => {
    if (!rows?.length) return { count: 0 };
    const payload = rows.map(r => ({
      session_id: sessionId,
      participant_id: r.participantId,
      section_id: r.sectionId,
      content: r.content,
    }));
    const { error } = await supabase
      .from('participant_prep')
      .upsert(payload, { onConflict: 'session_id,participant_id,section_id' });
    if (error) return { error };
    await refresh();
    return { count: rows.length };
  }, [sessionId, refresh]);

  return { prep, standalone, loading, refresh, saveOne, saveMany };
}
