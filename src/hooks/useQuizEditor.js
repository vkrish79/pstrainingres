import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// One quiz, with its questions and their four options, for the editor.
//
// The trainer-facing side reads quiz_options directly and so DOES see
// is_correct — that is the whole point of an editor. Participants never come
// near this hook: RLS denies them the table outright, and they read questions
// through quiz_current(), which cannot return the flag. See
// 20260916000000_live_quiz.sql.
//
// Writes that must be atomic go through RPCs rather than several supabase
// calls; the reasons are in 20260916000005_quiz_authoring.sql.
export function useQuizEditor(quizId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quiz, setQuiz] = useState(null);
  const [questions, setQuestions] = useState([]);

  const refresh = useCallback(async () => {
    if (!quizId) return;
    setError(null);
    const { data, error: e } = await supabase
      .from('quizzes')
      .select(`
        id, title, is_template, session_id, vendor_id, updated_at,
        quiz_questions (
          id, order_index, prompt, time_limit_seconds, image_path,
          quiz_options ( id, order_index, label, is_correct )
        )
      `)
      .eq('id', quizId)
      .maybeSingle();
    if (e) { setError(e.message); setLoading(false); return; }
    if (!data) { setError('That quiz could not be found, or you do not have access to it.'); setLoading(false); return; }

    setQuiz({ id: data.id, title: data.title, is_template: data.is_template, session_id: data.session_id });
    // PostgREST does not promise the order of an embedded array — sort here so
    // the editor never shows questions in a different order than the room will.
    setQuestions(
      (data.quiz_questions || [])
        .slice()
        .sort((a, b) => a.order_index - b.order_index)
        .map(q => ({
          ...q,
          quiz_options: (q.quiz_options || []).slice().sort((a, b) => a.order_index - b.order_index),
        })),
    );
    setLoading(false);
  }, [quizId]);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);

  // ── writes ─────────────────────────────────────────────────────────────
  // Each returns { error } or { data }. Reading the row back on update is not
  // optional here: an update refused by RLS comes back 200 with zero rows and
  // no error at all.

  const renameQuiz = useCallback(async (title) => {
    if (!title?.trim()) return { error: new Error('A quiz needs a title.') };
    const { data, error: e } = await supabase
      .from('quizzes')
      .update({ title: title.trim(), updated_at: new Date().toISOString() })
      .eq('id', quizId)
      .select('id, title');
    if (e) return { error: new Error(e.message) };
    if (!data?.length) return { error: new Error('That change was not saved — you may not have permission to edit this quiz.') };
    setQuiz(prev => (prev ? { ...prev, title: data[0].title } : prev));
    return { data: data[0] };
  }, [quizId]);

  const addQuestion = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('quiz_add_question', {
      p_quiz_id: quizId, p_prompt: '', p_seconds: 20,
    });
    if (e) return { error: new Error(e.message) };
    await refresh();
    return { data };
  }, [quizId, refresh]);

  const updateQuestion = useCallback(async (questionId, patch) => {
    const { data, error: e } = await supabase
      .from('quiz_questions').update(patch).eq('id', questionId)
      .select('id, prompt, time_limit_seconds');
    if (e) return { error: new Error(e.message) };
    if (!data?.length) return { error: new Error('That change was not saved — you may not have permission to edit this quiz.') };
    setQuestions(prev => prev.map(q => (q.id === questionId ? { ...q, ...data[0] } : q)));
    return { data: data[0] };
  }, []);

  const deleteQuestion = useCallback(async (questionId) => {
    const { data, error: e } = await supabase
      .from('quiz_questions').delete().eq('id', questionId).select('id');
    if (e) return { error: new Error(e.message) };
    if (!data?.length) return { error: new Error('That question was not deleted — you may not have permission.') };
    await refresh();
    return { data: true };
  }, [refresh]);

  const updateOption = useCallback(async (optionId, label) => {
    const { data, error: e } = await supabase
      .from('quiz_options').update({ label }).eq('id', optionId)
      .select('id, label');
    if (e) return { error: new Error(e.message) };
    if (!data?.length) return { error: new Error('That change was not saved — you may not have permission to edit this quiz.') };
    setQuestions(prev => prev.map(q => ({
      ...q,
      quiz_options: q.quiz_options.map(o => (o.id === optionId ? { ...o, label: data[0].label } : o)),
    })));
    return { data: data[0] };
  }, []);

  // Via RPC: clearing the old flag and setting the new one are two statements,
  // and between them the question has no correct answer.
  //
  // Moves the flag in local state BEFORE the round trip. These are controlled
  // radios, so with the update after the await React re-renders the old value
  // first and the button visibly snaps back — the trainer clicks and watches
  // nothing happen until the server answers. Rolled back if the write fails,
  // so a refusal is never left looking like a save.
  const setCorrect = useCallback(async (questionId, optionId) => {
    let rollback = null;
    setQuestions(prev => {
      rollback = prev;
      return prev.map(q => (q.id !== questionId ? q : {
        ...q,
        quiz_options: q.quiz_options.map(o => ({ ...o, is_correct: o.id === optionId })),
      }));
    });
    const { error: e } = await supabase.rpc('quiz_set_correct', {
      p_question_id: questionId, p_option_id: optionId,
    });
    if (e) {
      if (rollback) setQuestions(rollback);
      return { error: new Error(e.message) };
    }
    return { data: true };
  }, []);

  const moveQuestion = useCallback(async (questionId, direction) => {
    const i = questions.findIndex(q => q.id === questionId);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= questions.length) return { data: false };
    const next = questions.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setQuestions(next);                       // optimistic; the room is not watching yet
    const { error: e } = await supabase.rpc('quiz_reorder_questions', {
      p_quiz_id: quizId, p_ids: next.map(q => q.id),
    });
    if (e) { await refresh(); return { error: new Error(e.message) }; }
    return { data: true };
  }, [questions, quizId, refresh]);

  return {
    loading, error, quiz, questions,
    renameQuiz, addQuestion, updateQuestion, deleteQuestion,
    updateOption, setCorrect, moveQuestion, refresh,
  };
}
