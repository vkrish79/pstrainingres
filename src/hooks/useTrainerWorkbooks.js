import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { isSuperTrainerOrAbove } from '../lib/roles.js';

// Template library. Super-tier sees every template; vendor-tier sees only those
// flagged vendor_visible (custom/composed workbooks default off — see the
// workbook_vendor_visible migration).
export function useTrainerWorkbooks(trainerId, role) {
  const [loading, setLoading] = useState(true);
  const [workbooks, setWorkbooks] = useState([]);

  useEffect(() => {
    if (!trainerId) return;
    let cancelled = false;
    (async () => {
      let q = supabase
        .from('workbooks')
        .select('id, title, description, updated_at')
        .eq('is_template', true)
        .order('updated_at', { ascending: false });
      if (!isSuperTrainerOrAbove(role)) q = q.eq('vendor_visible', true);
      const { data } = await q;
      if (!cancelled) {
        setWorkbooks(data || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [trainerId, role]);

  return { loading, workbooks };
}
