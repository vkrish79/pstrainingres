import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// The poll library. One question, up to four answers, reused across sessions.
//
// Unlike a quiz there is no attach step and no session copy: a session reads
// the library live, and the snapshot happens when the poll is FIRED. So this
// hook is the whole authoring surface — there is no second editor to keep in
// step with it.
//
// RLS does the scoping. polls_read decides which polls a vendor trainer sees,
// so this asks for what it wants and lets the database narrow it, rather than
// filtering by role here where a mistake would be a security bug.

// Answers are always carried as six slots, blanks included, so the editor can
// render six inputs without inventing rows. The blanks are stripped when the
// poll is fired (poll_fire), which is why nothing downstream ever sees a hole.
//
// Six, not four: a five-point scale is the commonest thing a trainer asks a
// room, and four cannot hold one. The ceiling is the room, not the schema —
// slots 4 and 5 are the star and the plus, and the shapes after those are not
// nameable at the back of a hall. See 20260921000004_polls_six_answers.sql.
export const POLL_SLOTS = 6;
const emptyOptions = () => Array(POLL_SLOTS).fill('');

// Four slots in, four slots out, whatever the row actually holds. A poll saved
// with two answers comes back as two; the editor still needs four boxes.
export function padOptions(options) {
  const a = Array.isArray(options) ? options.map(o => (typeof o === 'string' ? o : '')) : [];
  return Array.from({ length: POLL_SLOTS }, (_, i) => a[i] ?? '');
}

// CASE 06: a poll with fewer than two written answers cannot be fired, and the
// list says so BEFORE the trainer tries. poll_fire refuses it as well — this is
// the visible half of the same rule, not a substitute for it.
export function filledAnswers(options) {
  return padOptions(options).map(o => o.trim()).filter(Boolean);
}
export function pollIsReady(poll) {
  return Boolean(poll?.question?.trim()) && filledAnswers(poll?.options).length >= 2;
}

export function usePolls() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [polls, setPolls] = useState([]);

  const refresh = useCallback(async () => {
    setError(null);
    const { data, error: e } = await supabase
      .from('polls')
      .select('id, question, options, vendor_id, created_at, updated_at, vendor:vendors ( id, name )')
      .order('updated_at', { ascending: false });
    if (e) { setError(e.message); setLoading(false); return; }
    setPolls((data || []).map(p => ({ ...p, options: padOptions(p.options) })));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createPoll = useCallback(async ({ question, created_by, vendor_id = null }) => {
    if (!question?.trim()) return { error: new Error('A poll needs a question.') };
    const { data, error: e } = await supabase
      .from('polls')
      .insert({ question: question.trim(), options: emptyOptions(), vendor_id, created_by })
      .select('id')
      .single();
    if (e) return { error: e };
    await refresh();
    return { data };
  }, [refresh]);

  // Saving the whole poll at once rather than per-field: it is one question and
  // four short answers on one screen, so there is no partial state worth the
  // extra round trips.
  //
  // updated_at is set HERE because nothing in the database sets it. The list is
  // ordered by it and polls_vendor_idx is built on it, so leaving it at its
  // insert default would make "most recently edited" mean "first created".
  const savePoll = useCallback(async (id, { question, options }) => {
    const { data, error: e } = await supabase
      .from('polls')
      .update({
        question: (question ?? '').trim(),
        options: padOptions(options).map(o => o.trim()),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, question, options, updated_at');
    if (e) return { error: e };
    // An update refused by RLS returns 200 with zero rows and no error.
    if (!data || data.length === 0) {
      return { error: new Error('That poll was not saved — you may not have permission to edit it.') };
    }
    await refresh();
    return { data: data[0] };
  }, [refresh]);

  const deletePoll = useCallback(async (id) => {
    const { data, error: e } = await supabase.from('polls').delete().eq('id', id).select('id');
    if (e) return { error: e };
    if (!data || data.length === 0) {
      return { error: new Error('That poll was not deleted — you may not have permission to remove it.') };
    }
    await refresh();
    return { data: data[0] };
  }, [refresh]);

  return { loading, error, polls, createPoll, savePoll, deletePoll, refresh };
}
