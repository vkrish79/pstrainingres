import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useSessionAssessmentResponses } from './useSessionAssessmentResponses.js';
import { useAssessmentMarks } from './useAssessmentMarks.js';
import { useSessionCriteria } from './useSessionCriteria.js';
import { useAssessmentPassMark, resultOf } from './useAssessmentPassMark.js';
import { buildCohortReport } from '../lib/assessmentReport.js';

// Who can be re-sat, and who in that session needs it.
//
// "Who failed" is not stored anywhere. It is the session's score against the
// pass mark — and the score is the REPORT'S score, computed by the very same
// call (buildCohortReport) from the very same data the Report tab reads. This
// used to be a third copy of the arithmetic that only added up marks given by
// hand, so every auto-marked part counted as nothing here while the Report
// counted it: on OC, two marks short for everyone, enough to call a pass at
// 80% a fail and offer a re-sit that wasn't needed. Reusing the Report means
// the two can no longer disagree.
//
// It follows the Report's rules exactly:
//   score   — scoreBlocks over the session's OWN paper (never the master's),
//             withdrawn questions out of both earned and possible
//   failed  — resultOf(): null while any question is still unmarked, with no
//             pass mark, or on a paper worth nothing. Never guessed.
//   pass mark from the master, via assessment_pass_mark() (a clone never
//             carries one; it late-binds).
//
// Re-sits are only arranged from an OPEN session, so the answers are always
// still there — no closed-session snapshot is needed here.
//
// sessionId null = do nothing (the drawer is mounted closed behind the page).
export function useResitCandidates(sessionId) {
  const [roster, setRoster] = useState([]);
  const [assessmentId, setAssessmentId] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!sessionId) { setRoster([]); setAssessmentId(null); return; }
    setRosterLoading(true); setError('');
    try {
      const { data: sess, error: e1 } = await supabase
        .from('sessions').select('id, assessment_id').eq('id', sessionId).single();
      if (e1) throw e1;
      const { data: rows, error: e2 } = await supabase
        .from('session_participants')
        .select('participant_id, deactivated_at, profiles!session_participants_participant_id_fkey ( id, full_name, email )')
        .eq('session_id', sessionId);
      if (e2) throw e2;
      setAssessmentId(sess.assessment_id);
      setRoster((rows || []).filter(r => r.profiles));
    } catch (err) {
      setError(err.message || String(err));
      setRoster([]);
    } finally {
      setRosterLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  // The Report's own inputs. Not live: this is a one-off list in a form.
  const active = sessionId && assessmentId ? sessionId : null;
  const {
    loading: paperLoading, error: paperError, sections, blocks, answers, answerKey, answerPoints, answerModes,
  } = useSessionAssessmentResponses(active, active ? assessmentId : null, { live: false });
  const { marks, loaded: marksLoaded, error: marksError } = useAssessmentMarks(active);
  const { guidance, points: criteriaPoints } = useSessionCriteria(active);
  const { passMark } = useAssessmentPassMark(active ? assessmentId : null);

  const { candidates, possible } = useMemo(() => {
    if (!roster.length || !blocks.length) return { candidates: [], possible: 0 };
    // Same participant shape the Report is given (id + full_name).
    const participants = roster.map(r => ({ id: r.participant_id, full_name: r.profiles.full_name, email: r.profiles.email }));
    const cohort = buildCohortReport({
      participants, sections, blocks, answers, answerKey,
      answerPoints: { ...answerPoints, ...criteriaPoints },
      answerModes, marks, guidance,
    });
    const byId = new Map(cohort.reports.map(rep => [rep.participant.id, rep]));
    const list = roster.map(r => {
      const rep = byId.get(r.participant_id);
      const score = rep?.score || { earned: 0, possible: 0, pct: null };
      const unmarked = rep?.unmarked.length || 0;
      const verdict = resultOf(score, passMark, unmarked);
      return {
        id: r.participant_id,
        name: r.profiles.full_name || r.profiles.email,
        username: (r.profiles.email || '').split('@')[0],
        deactivated: !!r.deactivated_at,
        earned: score.earned,
        pct: score.possible > 0 ? score.pct : null,
        // How many questions still wait for a person; while any do, there is
        // no verdict, exactly as on the Report.
        unmarked,
        failed: verdict == null ? null : verdict === 'FAIL',
      };
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return { candidates: list, possible: cohort.reports[0]?.score.possible || 0 };
  }, [roster, sections, blocks, answers, answerKey, answerPoints, criteriaPoints, answerModes, marks, guidance, passMark]);

  const loading = !!sessionId && (rosterLoading || (!!active && (paperLoading || !marksLoaded)));

  return {
    candidates,
    passMark,
    possible,
    loading,
    error: error || paperError || marksError || '',
    reload: load,
  };
}
