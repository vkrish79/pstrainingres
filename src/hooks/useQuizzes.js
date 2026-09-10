import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// The quiz library: templates, not the copies attached to a session.
//
// RLS does the scoping — quiz_can_author() keeps participants out of these
// tables entirely, and quizzes_read decides which templates a vendor trainer
// sees. So this asks for what it wants and lets the database narrow it, rather
// than filtering by role here where a mistake would be a security bug.
export function useQuizzes() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quizzes, setQuizzes] = useState([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('quizzes')
      .select(`
        id, title, vendor_id, updated_at, created_at,
        vendor:vendors ( id, name ),
        quiz_questions ( id )
      `)
      .eq('is_template', true)
      .order('updated_at', { ascending: false });
    if (e) { setError(e.message); setLoading(false); return; }
    // Fold the embed down to a count — the cards only ever show the number,
    // and carrying the array around invites someone to render it.
    setQuizzes((data || []).map(q => ({ ...q, question_count: q.quiz_questions?.length ?? 0 })));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createQuiz = useCallback(async ({ title, created_by, vendor_id = null }) => {
    if (!title?.trim()) return { error: new Error('Title is required.') };
    const { data, error: e } = await supabase
      .from('quizzes')
      .insert({
        title: title.trim(),
        is_template: true,
        session_id: null,
        vendor_id,
        created_by,
      })
      .select('id, title')
      .single();
    if (e) return { error: new Error(e.message) };
    await refresh();
    return { data };
  }, [refresh]);

  const deleteQuiz = useCallback(async (id) => {
    const { data, error: e } = await supabase
      .from('quizzes').delete().eq('id', id).select('id');
    if (e) return { error: new Error(e.message) };
    // A delete refused by RLS returns 200 with zero rows, not an error.
    if (!data || data.length === 0) {
      return { error: new Error('That quiz was not deleted — you may not have permission to remove it.') };
    }
    await refresh();
    return { data: true };
  }, [refresh]);

  return { loading, error, quizzes, createQuiz, deleteQuiz, refresh };
}
