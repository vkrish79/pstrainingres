import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Kit counts for EVERY workbook in one vendor partition, for the Prep modal's
// balance-overview landing. `vendorId` is the partition selector: a vendor uuid,
// or `null` for the shared super pool. Returns
//   byWorkbook[workbookId] = { total, available, allocated, used, fullyPreppable }
// where fullyPreppable is the lowest per-exercise availability (same definition
// as useWorkbookPrep — the bottleneck column). A workbook absent from the map
// simply has no kits in this partition.
export function useWorkbookPrepBalances(vendorId) {
  const [byWorkbook, setByWorkbook] = useState({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('workbook_prep_kits').select('workbook_id, status, payload');
    q = vendorId == null ? q.is('vendor_id', null) : q.eq('vendor_id', vendorId);
    const { data, error } = await q;
    const m = {};
    for (const k of (error ? [] : data || [])) {
      const e = m[k.workbook_id] || (m[k.workbook_id] = { total: 0, available: 0, allocated: 0, used: 0, perSection: {} });
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
    setByWorkbook(m);
    setLoading(false);
  }, [vendorId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Realtime: any kit change refreshes the whole overview (it's a cheap count).
  useEffect(() => {
    const channel = supabase
      .channel(`wpk-overview-${vendorId || 'super'}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'workbook_prep_kits' },
        () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [vendorId, refresh]);

  return { byWorkbook, loading, refresh };
}
