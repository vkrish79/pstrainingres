import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Kit counts for EVERY parent (workbook or assessment) in one vendor partition,
// for the Prep modal's balance-overview landing. `vendorId` partition selector:
// a vendor uuid, or `null` for the shared super pool. Returns
//   byParent[parentId] = { total, available, allocated, used, fullyPreppable }
// where fullyPreppable is the lowest per-header availability (same definition
// as useContentPrep — the bottleneck column).
//
// kindConfig: { kitsTable, parentFK, channelPrefix }
export function useContentPrepBalances(kindConfig, vendorId) {
  const { kitsTable, parentFK, channelPrefix } = kindConfig;
  const [byParent, setByParent] = useState({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    let q = supabase.from(kitsTable).select(`${parentFK}, status, payload`);
    q = vendorId == null ? q.is('vendor_id', null) : q.eq('vendor_id', vendorId);
    const { data, error } = await q;
    const m = {};
    for (const k of (error ? [] : data || [])) {
      const pid = k[parentFK];
      const e = m[pid] || (m[pid] = { total: 0, available: 0, allocated: 0, used: 0, perSection: {} });
      e.total++;
      if (k.status === 'available') e.available++;
      else if (k.status === 'allocated') e.allocated++;
      else if (k.status === 'used') e.used++;
      for (const [h, v] of Object.entries(k.payload || {})) {
        if (v == null || String(v).trim() === '') continue;
        e.perSection[h] = e.perSection[h] || { available: 0 };
        if (k.status === 'available') e.perSection[h].available++;
      }
    }
    for (const id of Object.keys(m)) {
      const avs = Object.values(m[id].perSection).map(p => p.available);
      m[id].fullyPreppable = avs.length ? Math.min(...avs) : m[id].available;
    }
    setByParent(m);
    setLoading(false);
  }, [vendorId, kitsTable, parentFK]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const channel = supabase
      .channel(`${channelPrefix}-overview-${vendorId || 'super'}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: kitsTable },
        () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [vendorId, refresh, kitsTable, channelPrefix]);

  return { byParent, loading, refresh };
}
