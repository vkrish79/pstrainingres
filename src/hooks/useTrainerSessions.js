import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Loads sessions for the trainer home or a vendor drill-in.
//   scope='own'    -> where trainer_id = userId (vendor_trainer + super's "my sessions" strip)
//   scope='vendor' -> where vendor_id  = vendorId (vendor drill-in page)
//   scope='all'    -> no explicit filter; RLS scopes naturally (vendor_manager
//                     gets their vendor; super gets everything).
export function useTrainerSessions(userId, scope = 'own', vendorId = null) {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!userId) return;
    if (scope === 'vendor' && !vendorId) return;
    let cancelled = false;
    (async () => {
      try {
        let q = supabase
          .from('sessions')
          .select(`
            id, name, created_at, starts_at, ends_at, city_code, trainer_id, vendor_id, closed_at,
            workbooks ( id, title ),
            session_participants ( participant_id ),
            trainer:profiles!sessions_trainer_id_fkey ( id, full_name )
          `)
          .order('created_at', { ascending: false });
        if (scope === 'own') q = q.eq('trainer_id', userId);
        else if (scope === 'vendor') q = q.eq('vendor_id', vendorId);
        const { data, error } = await q;
        if (error) throw error;
        if (cancelled) return;
        setSessions(data || []);
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setError(err.message); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [userId, scope, vendorId]);

  return { loading, error, sessions };
}
