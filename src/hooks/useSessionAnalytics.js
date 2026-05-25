import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Loads the cross-session analytics rows, RLS-scoped to the caller (super: all;
// vendor_manager: their vendor; trainer: own sessions). The analytics tables
// store denormalized dimension uuids only, so names come via the
// session_analytics -> sessions FK embed (and sessions' own embeds).
export function useSessionAnalytics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sessions, setSessions] = useState([]); // session_analytics rows + names
  const [sections, setSections] = useState([]); // session_section_analytics rows

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sa, ssa] = await Promise.all([
          supabase.from('session_analytics').select(`
            session_id, workbook_id, vendor_id, trainer_id, session_type_id,
            closed_at, duration_minutes, first_activity_at, last_activity_at,
            participant_count, section_count, block_count,
            total_slots, answered_slots, completion_pct,
            fully_completed_count, not_started_count,
            flagged_count, trainer_noted_count, section_note_count, prepped_participant_count,
            session_type:session_types ( id, name ),
            sessions (
              name, city_code, starts_at, closed_at,
              workbooks ( id, title ),
              vendors ( id, name ),
              trainer:profiles!sessions_trainer_id_fkey ( id, full_name )
            )
          `),
          supabase.from('session_section_analytics').select(`
            session_id, section_id, workbook_id, title, order_index,
            participant_count, total_slots, answered_slots, completion_pct, flagged_count
          `),
        ]);
        if (sa.error) throw sa.error;
        if (ssa.error) throw ssa.error;
        if (cancelled) return;
        setSessions(sa.data || []);
        setSections(ssa.data || []);
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setError(err.message); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { loading, error, sessions, sections };
}
