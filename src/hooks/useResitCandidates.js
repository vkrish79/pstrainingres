import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Who can be re-sat, and who in that session needs it.
//
// "Who failed" is not stored anywhere. It is arithmetic: the marks a person was
// awarded, over the marks their paper is out of, against the pass mark. That
// same sum already exists twice — in link_resit_participant (SQL) and in
// buildCohortReport (JS) — and this is the third. They must agree, so this file
// spells out the rules it follows rather than leaving them to be inferred:
//
//   earned    sum of assessment_marks.awarded for that person IN THIS SESSION,
//             counting only blocks that are still part of this session's paper.
//             Marks left behind by a withdrawn question would otherwise push
//             someone over a total their paper cannot reach.
//   possible  sum of assessment_answer_keys.points across the session's OWN
//             paper — never the master's. A session's copy can carry different
//             marks from the master it came from, and the number that matters is
//             the one they sat.
//   pass_mark from the master, via assessment_pass_mark(). A clone never carries
//             one; it late-binds.
//
// No pass mark means nobody can be called failed, so everyone is offered and
// nobody is pre-ticked. That is the honest reading, and it matches
// ClosedSessionView, which says "no pass mark set" rather than inventing one.

// Everyone enrolled in one session, with what they scored.
export function useResitCandidates(sessionId) {
  const [candidates, setCandidates] = useState([]);
  const [passMark, setPassMark] = useState(null);
  const [possible, setPossible] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!sessionId) { setCandidates([]); setPassMark(null); setPossible(0); return; }
    setLoading(true); setError('');
    try {
      const { data: sess, error: e1 } = await supabase
        .from('sessions').select('id, assessment_id').eq('id', sessionId).single();
      if (e1) throw e1;

      const { data: rows, error: e2 } = await supabase
        .from('session_participants')
        .select('participant_id, deactivated_at, profiles!session_participants_participant_id_fkey ( id, full_name, email )')
        .eq('session_id', sessionId);
      if (e2) throw e2;

      // The session's own paper: its blocks, and what each keyed block is worth.
      const { data: secs } = await supabase
        .from('assessment_sections').select('id').eq('assessment_id', sess.assessment_id);
      const sectionIds = (secs || []).map(s => s.id);
      const { data: blks } = sectionIds.length
        ? await supabase.from('assessment_blocks').select('id').in('section_id', sectionIds)
        : { data: [] };
      const blockIds = (blks || []).map(b => b.id);
      const { data: keys } = blockIds.length
        ? await supabase.from('assessment_answer_keys').select('assessment_block_id, points').in('assessment_block_id', blockIds)
        : { data: [] };

      const inPaper = new Set(blockIds);
      const total = (keys || []).reduce((s, k) => s + (Number(k.points) || 0), 0);

      const { data: marks } = await supabase
        .from('assessment_marks')
        .select('participant_id, assessment_block_id, awarded')
        .eq('session_id', sessionId);

      const earned = {};
      (marks || []).forEach(m => {
        if (!inPaper.has(m.assessment_block_id)) return;   // withdrawn question
        earned[m.participant_id] = (earned[m.participant_id] || 0) + (Number(m.awarded) || 0);
      });

      const { data: pm } = await supabase.rpc('assessment_pass_mark', { p_assessment_id: sess.assessment_id });
      const mark = Number(pm);
      const pass = Number.isFinite(mark) && pm != null ? mark : null;

      const list = (rows || [])
        .filter(r => r.profiles)
        .map(r => {
          const got = earned[r.participant_id] || 0;
          const pct = total > 0 ? Math.round((got / total) * 1000) / 10 : null;
          return {
            id: r.participant_id,
            name: r.profiles.full_name || r.profiles.email,
            username: (r.profiles.email || '').split('@')[0],
            deactivated: !!r.deactivated_at,
            earned: got,
            pct,
            // null = cannot be judged: no pass mark, or a paper worth nothing.
            failed: pass == null || pct == null ? null : pct < pass,
            marked: (marks || []).some(m => m.participant_id === r.participant_id),
          };
        })
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      setCandidates(list);
      setPassMark(pass);
      setPossible(total);
    } catch (err) {
      setError(err.message || String(err));
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  return { candidates, passMark, possible, loading, error, reload: load };
}
