import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// "How did that exercise go?" — Lost / Not sure / Got it, one per participant
// per exercise (engagement rec 1). Both sides, one hook, like useHelpRequests:
//
//   participant (mine: true)   their own taps: { [sectionId]: { level, note } }
//   trainer     (mine: false)  everyone's:     { [participantId]: { [sectionId]: row } }
//
// Live for the trainer through realtime, which applies the table's SELECT
// policy: a participant is only ever sent their own rows. A slow re-read
// underneath catches a dropped message.
const SAFETY_MS = 30000;

export const LEVELS = [
  { id: 'lost', glyph: '😕', label: 'Lost' },
  { id: 'unsure', glyph: '🤔', label: 'Not sure' },
  { id: 'got', glyph: '👍', label: 'Got it' },
];
export const LEVEL_BY_ID = Object.fromEntries(LEVELS.map(l => [l.id, l]));

export function useExerciseConfidence(sessionId, { mine = false, selfId = null } = {}) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  // The table is not there yet (SQL not applied): the strip hides instead of
  // offering a tap that can only fail.
  const [unavailable, setUnavailable] = useState(false);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!sessionId || (mine && !selfId)) return;
    const n = ++seq.current;
    let q = supabase
      .from('exercise_confidence')
      .select('participant_id, section_id, level, note, updated_at')
      .eq('session_id', sessionId);
    if (mine) q = q.eq('participant_id', selfId);
    const { data, error: e } = await q;
    if (n !== seq.current) return;
    // Before the SQL is applied the table does not exist; that is "no taps",
    // not an error worth a red line on the cockpit.
    if (e) {
      const missing = ['42P01', 'PGRST205'].includes(e.code) || /does not exist|could not find the table/i.test(e.message);
      if (missing) setUnavailable(true);
      setError(missing ? '' : e.message);
      return;
    }
    setUnavailable(false);
    setError('');
    setRows(data || []);
  }, [sessionId, mine, selfId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!sessionId || (mine && !selfId)) return undefined;
    const channel = supabase
      .channel(`confidence-${sessionId}-${mine ? selfId : 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*', schema: 'public', table: 'exercise_confidence',
          filter: mine ? `participant_id=eq.${selfId}` : `session_id=eq.${sessionId}`,
        },
        () => { reload(); },
      )
      .subscribe();
    const t = setInterval(reload, SAFETY_MS);
    return () => { clearInterval(t); supabase.removeChannel(channel); };
  }, [sessionId, mine, selfId, reload]);

  // Participant: tap (or change) how an exercise went. Optimistic, then read
  // back: an upsert RLS refuses returns 200 with no rows, so .select() is how
  // a refusal is noticed at all.
  const setLevel = useCallback(async (sectionId, level, note) => {
    if (!sessionId || !selfId) return { error: new Error('Not signed in') };
    const clean = typeof note === 'string' ? note.trim().slice(0, 200) || null : undefined;
    const prev = rows;
    setRows(r => {
      const rest = r.filter(x => x.section_id !== sectionId);
      const old = r.find(x => x.section_id === sectionId);
      return [...rest, { participant_id: selfId, section_id: sectionId, level, note: clean === undefined ? old?.note ?? null : clean }];
    });
    const payload = { session_id: sessionId, participant_id: selfId, section_id: sectionId, level };
    if (clean !== undefined) payload.note = clean;
    const { data, error: e } = await supabase
      .from('exercise_confidence')
      .upsert(payload, { onConflict: 'session_id,participant_id,section_id' })
      .select('section_id');
    if (e || !data?.length) {
      setRows(prev);
      return { error: e || new Error("It wasn't accepted. You may no longer be in this class.") };
    }
    return {};
  }, [sessionId, selfId, rows]);

  const mineBySection = {};
  const byParticipant = {};
  for (const r of rows) {
    if (mine) mineBySection[r.section_id] = r;
    (byParticipant[r.participant_id] ||= {})[r.section_id] = r;
  }
  return { rows, mineBySection, byParticipant, error, unavailable, setLevel, reload };
}

// Per exercise, for the trainer: counts by level, the notes grouped when they
// match ("FXB vs FXA" ×4), and whether the room is worth a recap. Dropouts are
// left out, as in every class figure.
//   activeIds: Set of participant ids still in the class
export function confidenceByExercise(rows, activeIds) {
  const out = {};
  for (const r of rows) {
    if (activeIds && !activeIds.has(r.participant_id)) continue;
    const e = (out[r.section_id] ||= { lost: 0, unsure: 0, got: 0, total: 0, notes: new Map() });
    e[r.level] += 1;
    e.total += 1;
    const note = (r.note || '').trim();
    if (note) {
      const key = note.toLowerCase().replace(/\s+/g, ' ');
      const cur = e.notes.get(key) || { text: note, n: 0 };
      cur.n += 1;
      e.notes.set(key, cur);
    }
  }
  for (const e of Object.values(out)) {
    e.notesList = [...e.notes.values()].sort((a, b) => b.n - a.n || a.text.localeCompare(b.text));
    delete e.notes;
    // Worth a recap: at least two people, and half or more of those who
    // answered, said lost or not sure.
    e.unsureOrLost = e.lost + e.unsure;
    e.recap = e.unsureOrLost >= 2 && e.unsureOrLost * 2 >= e.total;
  }
  return out;
}

// The cockpit's "How it went" card, from the same rows. Exercises are taken in
// workbook order, and only those somebody has tapped; dropouts are left out.
//   recent     — the last `last` tapped exercises, newest first, each with
//                counts, recap, notes and who said what
//   struggling — said Lost on two or more of the last three tapped exercises:
//                one bad exercise is the exercise, two is the person
//   latestLost — said Lost on the newest tapped exercise, not already above
//   silent     — still in the class, never tapped at all
//   sections   [{id, title, order_index}], people [{id, full_name}] (active only)
export function confidenceSummary(rows, sections, people, { last = 4 } = {}) {
  const activeIds = new Set(people.map(p => p.id));
  const nameOf = Object.fromEntries(people.map(p => [p.id, p.full_name || '(unnamed)']));
  const byEx = confidenceByExercise(rows, activeIds);
  const who = {};
  const tapped = new Set();
  for (const r of rows) {
    if (!activeIds.has(r.participant_id)) continue;
    tapped.add(r.participant_id);
    ((who[r.section_id] ||= { lost: [], unsure: [], got: [] })[r.level] ||= []).push({ id: r.participant_id, name: nameOf[r.participant_id] });
  }
  const done = [...sections]
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    .filter(s => byEx[s.id]?.total);
  if (!done.length) return null;
  const recent = done.slice(-last).reverse().map(s => ({ section: s, ...byEx[s.id], who: who[s.id] }));
  const last3 = done.slice(-3);
  const lostTimes = {};
  for (const s of last3) for (const p of who[s.id]?.lost || []) lostTimes[p.id] = (lostTimes[p.id] || 0) + 1;
  const struggling = Object.entries(lostTimes).filter(([, n]) => n >= 2).map(([id]) => ({ id, name: nameOf[id] }));
  const strugglingIds = new Set(struggling.map(p => p.id));
  const latestLost = (recent[0].who?.lost || []).filter(p => !strugglingIds.has(p.id));
  const silent = people.filter(p => !tapped.has(p.id)).map(p => ({ id: p.id, name: nameOf[p.id] }));
  return { recent, struggling, latestLost, silent };
}

// Each person's taps across the session, by level: the counts on their tile.
//   -> { [participantId]: { got, unsure, lost } }
export function tapCounts(rows) {
  const out = {};
  for (const r of rows) {
    const c = (out[r.participant_id] ||= { got: 0, unsure: 0, lost: 0 });
    if (r.level in c) c[r.level] += 1;
  }
  return out;
}

// Each person's newest tap, if it was Lost or Not sure and made today: the
// ring on that count on their tile. Today only, so a Lost from yesterday does not sit on the
// tile all of this morning after they have moved on without tapping again.
//   -> { [participantId]: { level, sectionId } }
export function worriedToday(rows, now = new Date()) {
  const newest = {};
  for (const r of rows) {
    const cur = newest[r.participant_id];
    if (!cur || r.updated_at > cur.updated_at) newest[r.participant_id] = r;
  }
  const out = {};
  for (const [pid, r] of Object.entries(newest)) {
    if (r.level === 'got') continue;
    if (new Date(r.updated_at).toDateString() !== now.toDateString()) continue;
    out[pid] = { level: r.level, sectionId: r.section_id };
  }
  return out;
}
