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
// was never analyzed/backfilled).
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
            session_participants ( count )
          `),
          supabase.from('session_analytics').select('session_id, participant_count'),
          supabase.from('cities').select('code, name'),
        ]);
        if (s.error) throw s.error;
        if (a.error) throw a.error;
        if (c.error) throw c.error;
        if (cancelled) return;

        const closedParticipants = new Map();
        for (const r of a.data || []) closedParticipants.set(r.session_id, r.participant_count || 0);
        // code -> name from the city registry (legacy codes not in the registry
        // just show their raw code).
        const cityName = new Map();
        for (const r of c.data || []) cityName.set(r.code, r.name);

        const mapped = (s.data || []).map((row) => {
          const isClosed = !!row.closed_at;
          const live = row.session_participants?.[0]?.count ?? 0;
          const code = row.city_code || null;
          return {
            id: row.id,
            isClosed,
            // Time axis: when the session runs (starts_at), falling back to when
            // it was set up (created_at, always present).
            date: row.starts_at || row.created_at,
            participants: isClosed ? (closedParticipants.get(row.id) ?? 0) : live,
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
