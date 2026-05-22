import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Trainer-side hook for a master workbook's prep repository, scoped to ONE
// vendor partition. `vendorId` is the partition selector: a vendor's uuid, or
// `null` for the shared super pool. Vendor-tier callers pass their own vendor;
// super-tier callers can switch partitions via a vendor filter in the panel.
//
// Exposes the loaded kits, a computed balance (total/available/allocated/used
// + per-exercise availability), append (upload), and clear-unconsumed.
export function useWorkbookPrep(workbookId, vendorId) {
  const [kits, setKits] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!workbookId) { setKits([]); setLoading(false); return; }
    setLoading(true);
    let q = supabase
      .from('workbook_prep_kits')
      .select('id, vendor_id, kit_index, payload, status, consumed_session_id, consumed_participant_id, consumed_at')
      .eq('workbook_id', workbookId)
      .order('kit_index');
    q = vendorId == null ? q.is('vendor_id', null) : q.eq('vendor_id', vendorId);
    const { data, error } = await q;
    setKits(error ? [] : (data || []));
    setLoading(false);
  }, [workbookId, vendorId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Realtime: filter by workbook only (vendor-null can't be filtered in the
  // realtime channel), then re-query the partition on any change.
  useEffect(() => {
    if (!workbookId) return;
    const channel = supabase
      .channel(`wpk-${workbookId}-${vendorId || 'super'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'workbook_prep_kits', filter: `workbook_id=eq.${workbookId}` },
        () => { refresh(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [workbookId, vendorId, refresh]);

  const balance = useMemo(() => {
    let available = 0, allocated = 0, used = 0;
    const perSection = {}; // masterSectionId -> { total, available }
    for (const k of kits) {
      if (k.status === 'available') available++;
      else if (k.status === 'allocated') allocated++;
      else if (k.status === 'used') used++;
      for (const [sid, v] of Object.entries(k.payload || {})) {
        if (v == null || String(v).trim() === '') continue;
        perSection[sid] = perSection[sid] || { total: 0, available: 0 };
        perSection[sid].total++;
        if (k.status === 'available') perSection[sid].available++;
      }
    }
    return { total: kits.length, available, allocated, used, perSection };
  }, [kits]);

  // Append new kits to this partition. `payloadRows` is an array of objects
  // keyed by master section id: [{ "<sectionId>": "content", ... }, ...].
  const appendKits = useCallback(async (payloadRows) => {
    if (!workbookId || !payloadRows?.length) return { count: 0 };
    // Robustly compute the next kit_index from the DB (not local state).
    let mq = supabase
      .from('workbook_prep_kits')
      .select('kit_index')
      .eq('workbook_id', workbookId)
      .order('kit_index', { ascending: false })
      .limit(1);
    mq = vendorId == null ? mq.is('vendor_id', null) : mq.eq('vendor_id', vendorId);
    const { data: maxRow } = await mq;
    const start = (maxRow?.[0]?.kit_index ?? -1) + 1;

    const rows = payloadRows.map((payload, i) => ({
      workbook_id: workbookId,
      vendor_id: vendorId ?? null,
      kit_index: start + i,
      payload,
      status: 'available',
    }));
    const { error } = await supabase.from('workbook_prep_kits').insert(rows);
    if (error) return { error };
    await refresh();
    return { count: rows.length };
  }, [workbookId, vendorId, refresh]);

  // Delete only the unconsumed (available) kits in this partition. Allocated /
  // used kits are preserved.
  const clearUnconsumed = useCallback(async () => {
    if (!workbookId) return {};
    let q = supabase
      .from('workbook_prep_kits')
      .delete()
      .eq('workbook_id', workbookId)
      .eq('status', 'available');
    q = vendorId == null ? q.is('vendor_id', null) : q.eq('vendor_id', vendorId);
    const { error } = await q;
    if (error) return { error };
    await refresh();
    return {};
  }, [workbookId, vendorId, refresh]);

  return { kits, balance, loading, refresh, appendKits, clearUnconsumed };
}
