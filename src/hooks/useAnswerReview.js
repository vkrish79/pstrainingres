import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Which exercises in a session are being / have been gone over with the class.
// Hosts and active participants may read answer_reviews (status only, no
// answers), and it is in realtime, so both sides stay live.
//   reviews = { [section_id]: { status, opened_at, finished_at, updated_at } }
export function useSessionReviews(sessionId) {
  const [reviews, setReviews] = useState({});

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from('answer_reviews')
        .select('section_id, status, opened_at, finished_at, updated_at')
        .eq('session_id', sessionId);
      if (!cancelled) setReviews(Object.fromEntries((data || []).map(r => [r.section_id, r])));
    };
    load();
    const channel = supabase
      .channel(`session-${sessionId}-answer-reviews`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'answer_reviews', filter: `session_id=eq.${sessionId}` },
        () => { load(); })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [sessionId]);

  return reviews;
}

// Right/wrong per person per answer box, for the trainer's own views (the
// Monitor drawer and the per-participant tiles). This is the old "show model
// answers" debrief mode: the same comparison the class board uses, so the two
// can never disagree. It works whether or not the exercise has been gone over
// — with no review, answers are compared with the trainer's practice copy.
//   marks = Map(`${participantId}|${blockId}|${slot}` → { right, trainer })
export function useReviewPeopleMarks(sessionId, sectionId, enabled = true) {
  const [marks, setMarks] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!enabled || !sessionId || !sectionId) { setMarks(new Map()); return undefined; }
    const mine = ++seq.current;
    setLoading(true);
    supabase.rpc('review_board', { p_session_id: sessionId, p_section_id: sectionId }).then(({ data }) => {
      if (mine !== seq.current) return;
      setLoading(false);
      const next = new Map();
      for (const c of data?.cells || []) {
        if (c.personal || !c.accepted?.length) continue;
        const trainer = c.model || (c.groups || []).filter(g => g.right).sort((a, b) => b.n - a.n)[0]?.sample || null;
        for (const p of c.people || []) {
          if (p.right === null || p.right === undefined) continue;
          next.set(`${p.participant_id}|${c.block_id}|${c.slot || ''}`, { right: p.right, trainer });
        }
      }
      setMarks(next);
    });
    return () => { seq.current++; };
  }, [sessionId, sectionId, enabled]);

  return { marks, loading };
}

// A participant's own marks for every exercise that has been gone over.
// Refetched when a review changes (opened, a decision, finished) and shortly
// after the participant's own answers change, so "Change mine" turns into a
// tick. review_my_marks never returns anyone else's answers.
//   marks = Map(slotKey → { right, mine, trainer_answer, right_count, answered, same_as_me, note })
export function useMyReviewMarks(sessionId, reviews, answersVersion) {
  const [marks, setMarks] = useState(() => new Map());
  const seq = useRef(0);
  const sectionIds = Object.keys(reviews || {}).sort();
  const reviewsKey = sectionIds.map(id => `${id}:${reviews[id].status}:${reviews[id].updated_at}`).join('|');

  const load = useCallback(async () => {
    if (!sessionId || sectionIds.length === 0) { setMarks(new Map()); return; }
    const mine = ++seq.current;
    const results = await Promise.all(sectionIds.map(sectionId => supabase.rpc('review_my_marks', {
      p_session_id: sessionId, p_section_id: sectionId,
    })));
    if (mine !== seq.current) return;
    const next = new Map();
    for (const { data } of results) {
      for (const c of data?.cells || []) next.set(`${c.block_id}|${c.slot || ''}`, c);
    }
    setMarks(next);
    // sectionIds is derived from reviewsKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, reviewsKey]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (answersVersion === undefined || sectionIds.length === 0) return undefined;
    const t = setTimeout(load, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answersVersion, load]);

  return marks;
}

// The trainer's class grid for one exercise, plus the write actions. The board
// is recomputed in the database on every change; `answersVersion` is anything
// that changes when participants' answers do (the dashboard's live answers
// object), so late answers arrive without a reload.
export function useAnswerReviewBoard(sessionId, sectionId, { answersVersion, reviewVersion } = {}) {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!sessionId || !sectionId) return;
    const mine = ++seq.current;
    const { data, error: err } = await supabase.rpc('review_board', {
      p_session_id: sessionId, p_section_id: sectionId,
    });
    if (mine !== seq.current) return; // a newer request is on its way
    setLoading(false);
    if (err) { setError(err.message); return; }
    setError('');
    setBoard(data);
  }, [sessionId, sectionId]);

  useEffect(() => { setLoading(true); setBoard(null); refresh(); }, [refresh]);

  // Answers change in bursts while people type; wait for a pause.
  useEffect(() => {
    if (answersVersion === undefined) return undefined;
    const t = setTimeout(refresh, 1500);
    return () => clearTimeout(t);
  }, [answersVersion, refresh]);

  useEffect(() => { if (reviewVersion !== undefined) refresh(); }, [reviewVersion, refresh]);

  const call = useCallback(async (fn, args) => {
    const { error: err } = await supabase.rpc(fn, { p_session_id: sessionId, p_section_id: sectionId, ...args });
    if (err) { setError(err.message); return { error: err }; }
    await refresh();
    return {};
  }, [sessionId, sectionId, refresh]);

  const open = useCallback(() => call('review_open', {}), [call]);
  const finish = useCallback(() => call('review_finish', {}), [call]);
  const cellAction = useCallback((blockId, slot, action, extra = {}) => call('review_cell', {
    p_block_id: blockId,
    p_slot: slot || '',
    p_action: action,
    p_key: extra.key ?? null,
    p_into: extra.into ?? null,
    p_on: extra.on ?? null,
    p_note: extra.note ?? null,
  }), [call]);

  return { board, error, loading, refresh, open, finish, cellAction };
}
