import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// The quiz library: templates, not the copies attached to a session.
//
// RLS does the scoping — quiz_can_author() keeps participants out of these
// tables entirely, and quizzes_read decides which templates a vendor trainer
// sees. So this asks for what it wants and lets the database narrow it, rather
// than filtering by role here where a mistake would be a security bug.
//
// IT READS THE QUESTIONS, not just their count. The cockpit above the grid
// answers "which of these is worth running" and "which of these is finished",
// and neither question can be answered from a title and a number. The extra
// weight is one embed over a handful of templates, which is nothing beside the
// round trip that fetches them.
//
// WHAT IS DELIBERATELY NOT HERE is a run history. quiz_runs rows point at the
// COPY a session froze at attach time, not at the template it came from (see
// project_quiz_attach_snapshot_trap), so "when was this last run" cannot be
// answered by joining quiz_runs.quiz_id to a template id — it would read as
// "never" for every quiz that has only ever been delivered inside a session.
// A wrong "never run" badge on a quiz you ran last week is worse than no badge.
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
        quiz_questions (
          id, kind, allow_wager, time_limit_seconds, pin_x, pin_y,
          quiz_options ( is_correct, correct_rank )
        )
      `)
      .eq('is_template', true)
      .order('updated_at', { ascending: false });
    if (e) { setError(e.message); setLoading(false); return; }
    setQuizzes((data || []).map(summarise));
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

// A QUESTION NOBODY CAN BE MARKED ON. What counts as missing depends on the
// type, which is the whole reason this is a function rather than a filter on
// is_correct: an `order` question has no correct option at all and a `pin`
// question has no options whatsoever, so the obvious test would report both of
// them as broken on every quiz that uses them.
export function isUnfinished(q) {
  const opts = q.quiz_options || [];
  if (q.kind === 'pin') return q.pin_x == null || q.pin_y == null;
  if (q.kind === 'order') return opts.length === 0 || opts.some(o => o.correct_rank == null);
  return !opts.some(o => o.is_correct);
}

// WHAT SORT OF QUIZ THIS IS, in the words the editor already uses for the
// types. A card carrying only a number cannot tell a straight multiple-choice
// recap from one built out of drop-a-pin questions, and those are very
// different things to walk into a room with.
const KIND_LABELS = {
  choice: 'multiple choice',
  boolean: 'true/false',
  order: 'put in order',
  pin: 'drop a pin',
};
// The order they are listed in, which is the order the editor offers them —
// not the order they happen to appear in a given quiz, or the same two quizzes
// would describe themselves differently.
const KIND_ORDER = ['choice', 'boolean', 'order', 'pin'];

function describeKinds(questions) {
  const counts = new Map();
  for (const q of questions) {
    // A question written before the column existed has no kind and is a plain
    // multiple choice, which is what the room already does with it.
    const kind = q.kind || 'choice';
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  return KIND_ORDER
    .filter(k => counts.has(k))
    .map(k => `${counts.get(k)} ${KIND_LABELS[k]}`)
    .join(' · ');
}

// Everything the cards and the gauge strip read, folded down in one pass so
// nothing downstream has to walk the questions again — and so the embedded
// arrays do not travel any further than this file, where someone would
// eventually be tempted to render them.
function summarise(q) {
  const questions = q.quiz_questions || [];
  let wagers = 0;
  let unfinished = 0;
  let seconds = 0;
  for (const qq of questions) {
    if (qq.allow_wager) wagers += 1;
    if (isUnfinished(qq)) unfinished += 1;
    // The clock is what a trainer is actually budgeting for. Null means the
    // question falls back to the room's default rather than taking no time.
    seconds += qq.time_limit_seconds ?? 20;
  }
  const { quiz_questions: _drop, ...rest } = q;
  return {
    ...rest,
    question_count: questions.length,
    wager_count: wagers,
    unfinished_count: unfinished,
    play_seconds: seconds,
    kind_summary: describeKinds(questions),
  };
}
