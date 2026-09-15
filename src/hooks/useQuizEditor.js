import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { prepareQuizImage, forgetQuizImageUrl, QUIZ_IMAGE_BUCKET, QUIZ_MAP_BUCKET } from '../lib/quizImages.js';
import { prepareQuizAudio, QUIZ_AUDIO_BUCKET } from '../lib/quizAudio.js';

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

// A `numeric` arrives from PostgREST as a STRING. Applied to every row that is
// read back into state, not only the first one, because the trap is in the
// spread: a row merged in with "0.08" where 0.08 belongs looks identical on
// screen and goes wrong at the next piece of arithmetic.
function numeric(row) {
  if (!row) return row;
  const out = { ...row };
  for (const k of ['pin_x', 'pin_y', 'pin_rx', 'pin_ry']) {
    if (k in out) out[k] = out[k] == null ? null : Number(out[k]);
  }
  return out;
}

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
          id, order_index, prompt, time_limit_seconds, image_path, audio_path,
          map_path, pin_x, pin_y, pin_rx, pin_ry, kind, allow_wager, display_scale,
          quiz_options ( id, order_index, label, is_correct, correct_rank )
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
          // PostgREST hands back a `numeric` as a STRING, to keep a precision
          // JavaScript cannot hold. Nothing here needs that precision and
          // everything here does arithmetic on it — a radius that is "0.08"
          // rather than 0.08 turns the first `+` into a concatenation and puts
          // the circle somewhere nobody clicked.
          pin_x:  q.pin_x  == null ? null : Number(q.pin_x),
          pin_y:  q.pin_y  == null ? null : Number(q.pin_y),
          pin_rx: q.pin_rx == null ? null : Number(q.pin_rx),
          pin_ry: q.pin_ry == null ? null : Number(q.pin_ry),
          // A CHOICE question's options are sorted by slot (which is the shape).
          // An ORDER question's items are sorted by where they BELONG, because
          // that is the sequence the trainer is writing — the shapes are
          // scrambled against it on purpose, and sorting by shape here would
          // show the trainer their answer shuffled.
          quiz_options: (q.quiz_options || []).slice().sort((a, b) => (
            q.kind === 'order'
              ? (a.correct_rank ?? 0) - (b.correct_rank ?? 0)
              : a.order_index - b.order_index
          )),
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

  // A new question lands at the TOP, under the buttons that made it.
  //
  // quiz_add_question appends — it always has, and it still does. The move is a
  // second call rather than a change to the function because quiz_reorder_questions
  // already exists and is already the one thing allowed to renumber a quiz:
  // it sends the WHOLE sequence, so what is stored cannot drift from what the
  // editor is showing. Changing the RPC would have meant a migration, and an
  // INSERT that shifts every other row's order_index behind it.
  //
  // WORTH SAYING OUT LOUD: this is the running order, not just the view. The
  // new question is now question 1 and the room will be asked it first. That is
  // what "on top" has to mean in an editor whose whole job is the order — a
  // list that showed newest-first while the room heard oldest-first would be a
  // trap. The ↑ ↓ buttons move it.
  const addQuestion = useCallback(async (kind = 'choice') => {
    const { data, error: e } = await supabase.rpc('quiz_add_question', {
      p_quiz_id: quizId, p_prompt: '', p_seconds: 20, p_kind: kind,
    });
    if (e) return { error: new Error(e.message) };

    // Reordering is best-effort on purpose: if it fails the question still
    // exists, at the bottom, and a refresh shows it there. Losing the question
    // to a failed tidy-up would be much worse than losing its position.
    const ids = [data, ...questions.map(q => q.id)];
    if (ids.length > 1) {
      await supabase.rpc('quiz_reorder_questions', { p_quiz_id: quizId, p_ids: ids });
    }

    await refresh();
    return { data };
  }, [quizId, refresh, questions]);

  const updateQuestion = useCallback(async (questionId, patch) => {
    const { data, error: e } = await supabase
      .from('quiz_questions').update(patch).eq('id', questionId)
      // image_path is in this list because it is in the patches this function
      // is given. Leave it out and the write lands, the row comes back without
      // it, and the spread below quietly restores the OLD path in local state —
      // an upload that worked, showing no picture. allow_wager is here for
      // exactly the same reason: the checkbox would tick and untick itself.
      // Every column this function can be handed has to be in this list, which
      // now includes the clip, the map and the four numbers that make up a pin
      // target.
      .select(`id, prompt, time_limit_seconds, image_path, audio_path, map_path,
               pin_x, pin_y, pin_rx, pin_ry, allow_wager, display_scale`);
    if (e) return { error: new Error(e.message) };
    if (!data?.length) return { error: new Error('That change was not saved — you may not have permission to edit this quiz.') };
    setQuestions(prev => prev.map(q => (q.id === questionId ? { ...q, ...numeric(data[0]) } : q)));
    return { data: data[0] };
  }, []);

  // ── the picture on the projected question ────────────────────────────
  // Shrunk and re-encoded in the browser first; see prepareQuizImage. The
  // upload goes up BEFORE the column is written, so an upload that fails
  // leaves the question exactly as it was rather than pointing at an object
  // that is not there.
  const setQuestionImage = useCallback(async (questionId, file) => {
    const prepared = await prepareQuizImage(file);
    if (prepared.error) return { error: prepared.error };
    const { blob, contentType, ext } = prepared.data;

    const path = `quizzes/${quizId}/${questionId}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(QUIZ_IMAGE_BUCKET)
      .upload(path, blob, { contentType, upsert: false });
    if (upErr) return { error: new Error(upErr.message) };

    const { data, error: e } = await supabase
      .from('quiz_questions').update({ image_path: path }).eq('id', questionId)
      .select('id, image_path');
    if (e) return { error: new Error(e.message) };
    if (!data?.length) return { error: new Error('That picture was not saved — you may not have permission to edit this quiz.') };

    setQuestions(prev => prev.map(q => (q.id === questionId ? { ...q, image_path: data[0].image_path } : q)));
    return { data: data[0] };
  }, [quizId]);

  // Clears the COLUMN, and deliberately does not remove the object.
  // quiz_attach_to_session copies image_path, so a template's picture and
  // every session copy's picture are one file in storage. Deleting it here
  // would blank the image on a session running the same quiz elsewhere.
  // Orphans are cheap; the reasoning is in RUN-THIS-IN-SUPABASE-quiz-images.txt.
  const clearQuestionImage = useCallback(async (questionId) => {
    const { data, error: e } = await supabase
      .from('quiz_questions').update({ image_path: null }).eq('id', questionId)
      .select('id, image_path');
    if (e) return { error: new Error(e.message) };
    if (!data?.length) return { error: new Error('That change was not saved — you may not have permission to edit this quiz.') };
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      forgetQuizImageUrl(q.image_path);
      return { ...q, image_path: null };
    }));
    return { data: true };
  }, []);

  // ── the sound clip ───────────────────────────────────────────────────
  // Same order as the picture — object first, column second — so a failed
  // upload leaves the question as it was rather than pointing at nothing.
  // Uploaded AS IT IS: there is no honest audio equivalent of shrinking a
  // picture, and the reasoning is in prepareQuizAudio.
  const setQuestionAudio = useCallback(async (questionId, file) => {
    const prepared = prepareQuizAudio(file);
    if (prepared.error) return { error: prepared.error };
    const { blob, contentType, ext } = prepared.data;

    const path = `quizzes/${quizId}/${questionId}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(QUIZ_AUDIO_BUCKET)
      .upload(path, blob, { contentType, upsert: false });
    if (upErr) return { error: new Error(upErr.message) };

    const { data, error: e } = await supabase
      .from('quiz_questions').update({ audio_path: path }).eq('id', questionId)
      .select('id, audio_path');
    if (e) return { error: new Error(e.message) };
    if (!data?.length) return { error: new Error('That clip was not saved — you may not have permission to edit this quiz.') };

    setQuestions(prev => prev.map(q => (q.id === questionId ? { ...q, audio_path: data[0].audio_path } : q)));
    return { data: data[0] };
  }, [quizId]);

  const clearQuestionAudio = useCallback(async (questionId) => {
    const { data, error: e } = await supabase
      .from('quiz_questions').update({ audio_path: null }).eq('id', questionId)
      .select('id, audio_path');
    if (e) return { error: new Error(e.message) };
    if (!data?.length) return { error: new Error('That change was not saved — you may not have permission to edit this quiz.') };
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      forgetQuizImageUrl(q.audio_path, QUIZ_AUDIO_BUCKET);
      return { ...q, audio_path: null };
    }));
    return { data: true };
  }, []);

  // ── the map a pin is dropped on ──────────────────────────────────────
  // Prepared by the picture path — shrunk to 1600px and re-encoded — but
  // uploaded to quiz-maps, the one quiz bucket a participant can read. The two
  // are not interchangeable and the bucket is the whole difference: a map in
  // quiz-images is a question nobody in the room can answer.
  //
  // Replacing the map CLEARS THE TARGET. The circle was placed against the old
  // picture, and a new one almost never lines up — leaving it would put the
  // answer somewhere the trainer never clicked, and the only sign would be a
  // room that all got it wrong.
  const setQuestionMap = useCallback(async (questionId, file) => {
    const prepared = await prepareQuizImage(file);
    if (prepared.error) return { error: prepared.error };
    const { blob, contentType, ext } = prepared.data;

    const path = `quizzes/${quizId}/${questionId}-map-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(QUIZ_MAP_BUCKET)
      .upload(path, blob, { contentType, upsert: false });
    if (upErr) return { error: new Error(upErr.message) };

    const { data, error: e } = await supabase
      .from('quiz_questions')
      .update({ map_path: path, pin_x: null, pin_y: null, pin_rx: null, pin_ry: null })
      .eq('id', questionId)
      .select('id, map_path, pin_x, pin_y, pin_rx, pin_ry');
    if (e) return { error: new Error(e.message) };
    if (!data?.length) return { error: new Error('That picture was not saved — you may not have permission to edit this quiz.') };

    setQuestions(prev => prev.map(q => (q.id === questionId ? { ...q, ...numeric(data[0]) } : q)));
    return { data: data[0] };
  }, [quizId]);

  const clearQuestionMap = useCallback(async (questionId) => {
    const { data, error: e } = await supabase
      .from('quiz_questions')
      .update({ map_path: null, pin_x: null, pin_y: null, pin_rx: null, pin_ry: null })
      .eq('id', questionId)
      .select('id, map_path, pin_x, pin_y, pin_rx, pin_ry');
    if (e) return { error: new Error(e.message) };
    if (!data?.length) return { error: new Error('That change was not saved — you may not have permission to edit this quiz.') };
    setQuestions(prev => prev.map(q => {
      if (q.id !== questionId) return q;
      forgetQuizImageUrl(q.map_path, QUIZ_MAP_BUCKET);
      return { ...q, ...numeric(data[0]) };
    }));
    return { data: true };
  }, []);

  // Marking the spot. Through an RPC because the four numbers are one fact —
  // a centre moved with the old radius still on it is a circle in the wrong
  // place, and nothing on screen would say so.
  //
  // Optimistic, like setCorrect: the trainer clicks the map and the circle has
  // to appear under the pointer, not a round trip later.
  const setPinTarget = useCallback(async (questionId, t) => {
    let rollback = null;
    setQuestions(prev => {
      rollback = prev;
      return prev.map(q => (q.id !== questionId ? q : {
        ...q,
        pin_x: t?.x ?? null, pin_y: t?.y ?? null,
        pin_rx: t?.rx ?? null, pin_ry: t?.ry ?? null,
      }));
    });
    const { error: e } = await supabase.rpc('quiz_set_pin_target', {
      p_question_id: questionId,
      p_x: t?.x ?? null, p_y: t?.y ?? null,
      p_rx: t?.rx ?? null, p_ry: t?.ry ?? null,
    });
    if (e) {
      if (rollback) setQuestions(rollback);
      return { error: new Error(e.message) };
    }
    return { data: true };
  }, []);

  // DELETING LEAVES A HOLE, and the hole is fatal in a way nothing on screen
  // shows. order_index is not a position in a list, it is the number the run
  // asks for: quiz_set_phase looks up "the question at index 0" and a quiz
  // numbered 1,2,3,4 has none. The editor hides this completely, because it
  // numbers the cards Q1..Q4 from their position in the array.
  //
  // Found by running one: "no question at index 0 in this quiz", on a quiz
  // that looked perfect in the editor. So the sequence is closed up here,
  // through the same RPC that reorders, which sends the whole list and cannot
  // leave it half-renumbered.
  const deleteQuestion = useCallback(async (questionId) => {
    const { data, error: e } = await supabase
      .from('quiz_questions').delete().eq('id', questionId).select('id');
    if (e) return { error: new Error(e.message) };
    if (!data?.length) return { error: new Error('That question was not deleted — you may not have permission.') };

    const left = questions.filter(q => q.id !== questionId).map(q => q.id);
    if (left.length) {
      const { error: re } = await supabase.rpc('quiz_reorder_questions', {
        p_quiz_id: quizId, p_ids: left,
      });
      // Deliberately not fatal: the question IS deleted by this point, and
      // saying otherwise would be a lie. The refresh below shows the truth.
      if (re) { await refresh(); return { error: new Error('Deleted, but the numbering could not be tidied up: ' + re.message) }; }
    }

    await refresh();
    return { data: true };
  }, [refresh, questions, quizId]);

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

  // Opening or closing the betting on one question.
  //
  // Optimistic for the same reason setCorrect is, and the reason is worth
  // repeating because it is invisible in code review: this is a CONTROLLED
  // checkbox. Update local state after the await and React re-renders the old
  // value first, so the box ticks and then visibly unticks itself until the
  // server answers — the trainer clicks and watches nothing happen. Rolled back
  // if the write is refused, so a refusal is never left looking like a save.
  const setAllowWager = useCallback(async (questionId, on) => {
    let rollback = null;
    setQuestions(prev => {
      rollback = prev;
      return prev.map(q => (q.id === questionId ? { ...q, allow_wager: on } : q));
    });
    const { data, error: e } = await supabase
      .from('quiz_questions').update({ allow_wager: on }).eq('id', questionId)
      .select('id, allow_wager');
    if (e || !data?.length) {
      if (rollback) setQuestions(rollback);
      return { error: new Error(e?.message || 'That change was not saved — you may not have permission to edit this quiz.') };
    }
    return { data: data[0] };
  }, []);

  // Move an ITEM within a reorder question. Sends the whole sequence, like
  // quiz_reorder_questions, so what is stored cannot drift from what the
  // editor is showing.
  const moveItem = useCallback(async (questionId, optionId, direction) => {
    const q = questions.find(x => x.id === questionId);
    if (!q) return { data: false };
    const items = q.quiz_options.slice();
    const i = items.findIndex(o => o.id === optionId);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= items.length) return { data: false };
    [items[i], items[j]] = [items[j], items[i]];
    // Optimistic: the editor is not being watched by a room.
    setQuestions(prev => prev.map(x => (x.id === questionId ? { ...x, quiz_options: items } : x)));
    const { error: e } = await supabase.rpc('quiz_set_order', {
      p_question_id: questionId, p_option_ids: items.map(o => o.id),
    });
    if (e) { await refresh(); return { error: new Error(e.message) }; }
    return { data: true };
  }, [questions, refresh]);

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
    setQuestionImage, clearQuestionImage,
    setQuestionAudio, clearQuestionAudio,
    setQuestionMap, clearQuestionMap, setPinTarget,
    updateOption, setCorrect, setAllowWager, moveQuestion, moveItem, refresh,
  };
}
