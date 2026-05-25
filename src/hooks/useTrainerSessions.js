import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Loads sessions for the trainer home, vendor drill-in, or archive.
//   scope='own'    -> where trainer_id = userId (vendor_trainer's "your sessions")
//   scope='super'  -> where vendor_id is null (all super-trainer-delivered
//                     sessions; super trainers have a null vendor_id, so a null
//                     session vendor_id == delivered by some super). RLS lets
//                     super read them all.
//   scope='vendor' -> where vendor_id  = vendorId (vendor drill-in page)
//   scope='all'    -> no explicit filter; RLS scopes naturally (vendor_manager
//                     gets their vendor; super gets everything).
//   includeClosed:
//     'live'   -> closed_at is null (default; the active-work views)
//     'closed' -> closed_at is not null (the archive page)
//     'all'    -> no filter on closed_at
export function useTrainerSessions(userId, scope = 'own', vendorId = null, includeClosed = 'live') {
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
            id, name, created_at, starts_at, ends_at, city_code, trainer_id, vendor_id, closed_at, session_type_id,
            workbooks ( id, title ),
            vendors ( id, code, name ),
            session_type:session_types ( id, name ),
            session_participants ( participant_id ),
            trainer:profiles!sessions_trainer_id_fkey ( id, full_name )
          `)
          .order('created_at', { ascending: false });
        if (scope === 'own') q = q.eq('trainer_id', userId);
        else if (scope === 'super') q = q.is('vendor_id', null);
        else if (scope === 'vendor') q = q.eq('vendor_id', vendorId);
        if (includeClosed === 'live') q = q.is('closed_at', null);
        else if (includeClosed === 'closed') q = q.not('closed_at', 'is', null);
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
  }, [userId, scope, vendorId, includeClosed]);

  return { loading, error, sessions, setSessions };
}
