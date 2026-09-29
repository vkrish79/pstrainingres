import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// One quiz, read the way the ROOM gets it, for rehearsal.
//
// It looks like useQuizEditor and it is not, in one way that matters: the
// options come back sorted by order_index — the SHAPE slot — and never by
// correct_rank. The editor sorts an `order` question's items by where they
// belong, because that is the sequence a trainer is writing. The room sees
// them scrambled against that. A rehearsal fed the editor's array would show
// the trainer their own answer already in order, which is the one thing a
// rehearsal must not do.
//
// It reads is_correct, which is the part participants can never see: this hook
// runs on the trainer's own client, behind quiz_can_author(), and the answers
// stay on that client. Nobody is connected to a rehearsal — there is nothing
// to leak them to.
export function useQuizPlayback(quizId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quiz, setQuiz] = useState(null);
  const [questions, setQuestions] = useState([]);

  const load = useCallback(async () => {
    if (!quizId) return;
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('quizzes')
      .select(`
        id, title,
        quiz_questions (
          id, order_index, prompt, time_limit_seconds, image_path, audio_path,
          map_path, pin_x, pin_y, pin_rx, pin_ry, kind, allow_wager, display_scale,
          quiz_options ( id, order_index, label, is_correct, correct_rank )
        )
      `)
      .eq('id', quizId)
      .maybeSingle();
    if (e) { setError(e.message); setLoading(false); return; }
    if (!data) { setError('That quiz could not be found, or you do not have access to it.'); setLoading(false); return; }

    setQuiz({ id: data.id, title: data.title });
    setQuestions(
      (data.quiz_questions || [])
        .slice()
        .sort((a, b) => a.order_index - b.order_index)
        .map(q => ({
          ...q,
          // A `numeric` arrives from PostgREST as a STRING, to keep a precision
          // JavaScript cannot hold. Nothing here needs it and everything here
          // does arithmetic on it — a radius of "0.08" rather than 0.08 turns
          // the first `+` into a concatenation and puts the target somewhere
          // nobody aimed.
          pin_x: q.pin_x == null ? null : Number(q.pin_x),
          pin_y: q.pin_y == null ? null : Number(q.pin_y),
          pin_rx: q.pin_rx == null ? null : Number(q.pin_rx),
          pin_ry: q.pin_ry == null ? null : Number(q.pin_ry),
          // THE ROOM'S ORDER, always. See the note at the top.
          quiz_options: (q.quiz_options || []).slice().sort((a, b) => a.order_index - b.order_index),
        })),
    );
    setLoading(false);
  }, [quizId]);

  useEffect(() => { load(); }, [load]);

  return { loading, error, quiz, questions, reload: load };
}
