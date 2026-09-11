import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const SUPER_ROLES = new Set(['super_admin', 'super_trainer']);

// Loads one flat, RLS-scoped row per session the caller can see, with the
// dimensions needed for the Analytics rollups (session type / vendor / super
// trainer) already resolved. The page aggregates these client-side so a
// session-type filter can re-roll the vendor & super-trainer breakdowns
// without another round-trip.
//
// Participant counts: active sessions use the live session_participants count;
// closed sessions' participants are hard-deleted, so their count comes from the
// frozen session_analytics.participant_count snapshot (0 if a closed session
// was never analyzed/backfilled). Dropouts follow the same split.
//
// Assessment results come ONLY from closed sessions (session_analytics): a
// live session's scores are interim until it closes, and sessions closed
// before close-session started recording them have none.
//
// Both enrolment and analytics rows are read with `*`, not by column name, so
// this page keeps working on a database that has not yet had
// 20260917000000_participant_dropout_close_check.sql applied — the new fields
// simply read as zero.
export function useSessionRollup() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, a, c] = await Promise.all([
          supabase.from('sessions').select(`
            id, vendor_id, trainer_id, program_id, city_code, closed_at, created_at, starts_at,
            vendors ( id, name ),
            program:programs ( id, program_type_id, program_type:program_types ( id, name ) ),
            trainer:profiles!sessions_trainer_id_fkey ( id, full_name, role ),
            session_participants ( * )
          `),
          supabase.from('session_analytics').select('*'),
          supabase.from('cities').select('code, name'),
        ]);
        if (s.error) throw s.error;
        if (a.error) throw a.error;
        if (c.error) throw c.error;
        if (cancelled) return;

        const analyticsBySession = new Map();
        for (const r of a.data || []) analyticsBySession.set(r.session_id, r);
        // code -> name from the city registry (legacy codes not in the registry
        // just show their raw code).
        const cityName = new Map();
        for (const r of c.data || []) cityName.set(r.code, r.name);

        const mapped = (s.data || []).map((row) => {
          const isClosed = !!row.closed_at;
          const enrolled = row.session_participants || [];
          const sa = analyticsBySession.get(row.id) || null;
          const code = row.city_code || null;
          return {
            id: row.id,
            isClosed,
            // Time axis: when the session runs (starts_at), falling back to when
            // it was set up (created_at, always present).
            date: row.starts_at || row.created_at,
            participants: isClosed ? (sa?.participant_count ?? 0) : enrolled.length,
            dropouts: isClosed ? (sa?.deactivated_count ?? 0) : enrolled.filter(sp => sp.deactivated_at).length,
            belowThreshold: isClosed ? (sa?.below_threshold_count ?? 0) : 0,
            // null unless this is a closed session whose assessment was recorded.
            assessment: isClosed && sa?.has_assessment ? {
              title: sa.assessment_title || '(untitled assessment)',
              passMark: sa.assessment_pass_mark != null ? Number(sa.assessment_pass_mark) : null,
              participants: sa.assessment_participant_count || 0,
              sat: sa.assessment_sat_count || 0,
              scored: sa.assessment_scored_count || 0,
              incomplete: sa.assessment_incomplete_count || 0,
              avgPct: sa.assessment_avg_pct != null ? Number(sa.assessment_avg_pct) : null,
              pass: sa.assessment_pass_count || 0,
              fail: sa.assessment_fail_count || 0,
              scorePcts: Array.isArray(sa.assessment_score_pcts) ? sa.assessment_score_pcts.map(Number) : [],
            } : null,
            vendorId: row.vendor_id,
            vendorName: row.vendors?.name || null,
            trainerId: row.trainer_id,
            trainerName: row.trainer?.full_name || null,
            isSuperTrainer: SUPER_ROLES.has(row.trainer?.role),
            typeId: row.program?.program_type_id ?? null,
            typeName: row.program?.program_type?.name || null,
            cityCode: code,
            cityName: code ? (cityName.get(code) || code) : null,
          };
        });

        setSessions(mapped);
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setError(err.message); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { loading, error, sessions };
}
