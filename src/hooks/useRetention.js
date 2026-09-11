import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Data-retention settings. Both calls go through SECURITY DEFINER functions —
// the tables themselves have RLS on and no policies, so there is no direct
// read or write path. See supabase/migrations/20260918000000_data_retention.sql.
//
// The list is composed by the database from the job's own catalogue, so this
// screen can only ever tune a policy that already exists in code.
export function useRetention() {
  const [data, setData] = useState(null);   // { can_edit, cron_scheduled, policies[], last_run }
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { data: d, error: e } = await supabase.rpc('retention_policy_list');
    if (e) {
      // PGRST202 = the function does not exist: the SQL has not been run yet.
      setError(e.code === 'PGRST202'
        ? 'Data retention is not set up in the database yet — run the data-retention SQL.'
        : e.message);
      setData(null);
      return;
    }
    setError(null);
    setData(d);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (policyKey, days, enabled) => {
    const { error: e } = await supabase.rpc('set_retention_policy', {
      p_key: policyKey, p_days: days, p_enabled: enabled,
    });
    if (e) return { error: new Error(e.message) };
    await load();
    return {};
  }, [load]);

  return { data, error, save, reload: load };
}
