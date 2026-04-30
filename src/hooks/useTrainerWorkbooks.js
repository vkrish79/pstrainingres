import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

export function useTrainerWorkbooks(trainerId) {
  const [loading, setLoading] = useState(true);
  const [workbooks, setWorkbooks] = useState([]);

  useEffect(() => {
    if (!trainerId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('workbooks')
        .select('id, title, description, updated_at')
        .order('updated_at', { ascending: false });
      if (!cancelled) {
        setWorkbooks(data || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [trainerId]);

  return { loading, workbooks };
}
