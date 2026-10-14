import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Question statistics for one bank (A2): every class's figures for each bank
// question, combined by bank_item_stats. { [bankSectionId]: row }.
// Before the SQL is applied the call fails and the bank simply shows none.
export function useBankItemStats(bankId) {
  const [stats, setStats] = useState({});
  useEffect(() => {
    if (!bankId) return undefined;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('bank_item_stats', { p_bank_id: bankId });
      if (cancelled || error) return;
      setStats(Object.fromEntries((data || []).map(r => [r.bank_section_id, {
        ...r,
        facility: r.facility == null ? null : Number(r.facility),
        top_frac: r.top_frac == null ? null : Number(r.top_frac),
        bottom_frac: r.bottom_frac == null ? null : Number(r.bottom_frac),
      }])));
    })();
    return () => { cancelled = true; };
  }, [bankId]);
  return stats;
}
