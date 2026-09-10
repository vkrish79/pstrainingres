import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// The quizzes attached to one session, plus the library a trainer can add from.
//
// Attaching is a DEEP COPY, not a reference — quiz_attach_to_session() clones
// the questions and their answer key into a session-bound quiz. So editing the
// library template later cannot change a quiz that has already been run in a
// room, and a trainer can reword something for their own cohort without
// touching the master. Same rule workbooks follow.
export function useSessionQuizzes(sessionId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attached, setAttached] = useState([]);
  const [library, setLibrary] = useState([]);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setError(null);
    const [mine, lib] = await Promise.all([
      supabase
        .from('quizzes')
        .select('id, title, created_at, quiz_questions ( id )')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true }),
      supabase
        .from('quizzes')
        .select('id, title, quiz_questions ( id )')
        .eq('is_template', true)
        .order('title'),
    ]);
    if (mine.error) { setError(mine.error.message); setLoading(false); return; }
    // A library read that fails is not fatal — the attached list is still worth
    // showing, and the picker can say it could not load.
    const count = r => ({ ...r, question_count: r.quiz_questions?.length ?? 0 });
    setAttached((mine.data || []).map(count));
    setLibrary((lib.data || []).map(count));
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);

  const attach = useCallback(async (templateId) => {
    const { data, error: e } = await supabase.rpc('quiz_attach_to_session', {
      p_quiz_id: templateId, p_session_id: sessionId,
    });
    if (e) return { error: new Error(e.message) };
    await refresh();
    return { data };
  }, [sessionId, refresh]);

  const remove = useCallback(async (quizId) => {
    const { data, error: e } = await supabase
      .from('quizzes').delete().eq('id', quizId).select('id');
    if (e) return { error: new Error(e.message) };
    // Delete refused by RLS comes back 200 with zero rows and no error.
    if (!data?.length) return { error: new Error('That quiz was not removed — you may not have permission.') };
    await refresh();
    return { data: true };
  }, [refresh]);

  return { loading, error, attached, library, attach, remove, refresh };
}
