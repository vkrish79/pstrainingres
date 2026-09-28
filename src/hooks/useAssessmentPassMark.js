import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// The score at or above which a participant passes, as a percentage.
//
// Read through an RPC rather than a select, because a session uses a CLONE of
// the assessment and a vendor trainer cannot read the master row it was cloned
// from: assessments_clone_trainer_read is restricted to is_template = false,
// and the only policy covering templates is super-trainer-only. An embedded
// read of the master's pass_mark would therefore return null for exactly the
// people who print these reports — silently, with no error.
//
// assessment_pass_mark() is SECURITY DEFINER and re-applies the same access
// rule explicitly. See supabase/migrations/20260913000000_assessment_pass_mark.sql.
//
// null means NOBODY HAS DECIDED, which is a real state and not zero. Callers
// must print an empty Result rather than a fail.
export function useAssessmentPassMark(assessmentId) {
  const [passMark, setPassMark] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!assessmentId) { setPassMark(null); setLoading(false); return undefined; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc('assessment_pass_mark', {
        p_assessment_id: assessmentId,
      });
      if (cancelled) return;
      // A failure here is not worth an error banner on the report: the only
      // consequence is a blank Result column, which is also what "not set"
      // looks like. Reporting it would put a scary message on a page that is
      // otherwise entirely correct.
      const n = Number(data);
      setPassMark(!error && data != null && Number.isFinite(n) ? n : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [assessmentId]);

  return { passMark, loading };
}

// resultOf used to be defined here. It moved to assessmentScoring.js so that
// buildCohortReport — which is pure — can reach the same verdict without
// importing a hook. Re-exported, so every existing import keeps working.
export { resultOf } from '../lib/assessmentScoring.js';
