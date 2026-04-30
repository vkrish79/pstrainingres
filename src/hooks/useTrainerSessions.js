import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

export function useTrainerSessions(trainerId) {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!trainerId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('sessions')
          .select(`
            id, name, created_at,
            workbooks ( id, title ),
            session_participants ( participant_id )
          `)
          .eq('trainer_id', trainerId)
          .order('created_at', { ascending: false });
        if (error) throw error;
        if (cancelled) return;
        setSessions(data || []);
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setError(err.message); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [trainerId]);

  return { loading, error, sessions };
}
