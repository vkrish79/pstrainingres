import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Trainer-side hook for a master parent's (workbook or assessment) prep
// repository, scoped to ONE vendor partition. `vendorId` is the partition
// selector: a vendor uuid, or `null` for the shared super pool.
//
// kindConfig: { kitsTable, parentFK, channelPrefix }
//   kitsTable     — 'workbook_prep_kits' | 'assessment_prep_kits'
//   parentFK      — 'workbook_id' | 'assessment_id'
//   channelPrefix — realtime channel name prefix, e.g. 'wpk' | 'apk'
//
// Exposes the loaded kits, a computed balance, append (upload), and
// clear-unconsumed — identical surface to the legacy useWorkbookPrep.
export function useContentPrep(kindConfig, parentId, vendorId) {
  const { kitsTable, parentFK, channelPrefix } = kindConfig;

  const [kits, setKits] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!parentId) { setKits([]); setLoading(false); return; }
    setLoading(true);
    let q = supabase
      .from(kitsTable)
      .select('id, vendor_id, kit_index, payload, status, consumed_session_id, consumed_participant_id, consumed_at')
      .eq(parentFK, parentId)
      .order('kit_index');
    q = vendorId == null ? q.is('vendor_id', null) : q.eq('vendor_id', vendorId);
    const { data, error } = await q;
    setKits(error ? [] : (data || []));
    setLoading(false);
  }, [parentId, vendorId, kitsTable, parentFK]);

  useEffect(() => { refresh(); }, [refresh]);

  // Realtime: filter by parent only (vendor-null can't be filtered in the
  // realtime channel), then re-query the partition on any change.
  useEffect(() => {
    if (!parentId) return;
    const channel = supabase
      .channel(`${channelPrefix}-${parentId}-${vendorId || 'super'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: kitsTable, filter: `${parentFK}=eq.${parentId}` },
        () => { refresh(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [parentId, vendorId, refresh, kitsTable, parentFK, channelPrefix]);

  const balance = useMemo(() => {
    let available = 0, allocated = 0, used = 0;
    const perSection = {}; // payload key (header) -> { total, available }
    for (const k of kits) {
      if (k.status === 'available') available++;
      else if (k.status === 'allocated') allocated++;
      else if (k.status === 'used') used++;
      for (const [key, v] of Object.entries(k.payload || {})) {
        if (v == null || String(v).trim() === '') continue;
        perSection[key] = perSection[key] || { total: 0, available: 0 };
        perSection[key].total++;
        if (k.status === 'available') perSection[key].available++;
      }
    }
    // "Fully preppable" = the lowest per-header availability among AVAILABLE
    // kits. A complete kit needs a value in every prep column, so the column
    // with the fewest filled-in available kits is the bottleneck. Falls back
    // to the kit count when there are no prep columns at all.
    const headerAvails = Object.values(perSection).map(p => p.available);
    const fullyPreppable = headerAvails.length ? Math.min(...headerAvails) : available;
    return { total: kits.length, available, allocated, used, perSection, fullyPreppable };
  }, [kits]);

  // Append new kits to this partition. `payloadRows` is an array of objects
  // keyed by canonical prep_template header.
  const appendKits = useCallback(async (payloadRows) => {
    if (!parentId || !payloadRows?.length) return { count: 0 };
    // Robustly compute the next kit_index from the DB (not local state).
    let mq = supabase
      .from(kitsTable)
      .select('kit_index')
      .eq(parentFK, parentId)
      .order('kit_index', { ascending: false })
      .limit(1);
    mq = vendorId == null ? mq.is('vendor_id', null) : mq.eq('vendor_id', vendorId);
    const { data: maxRow } = await mq;
    const start = (maxRow?.[0]?.kit_index ?? -1) + 1;

    const rows = payloadRows.map((payload, i) => ({
      [parentFK]: parentId,
      vendor_id: vendorId ?? null,
      kit_index: start + i,
      payload,
      status: 'available',
    }));
    const { error } = await supabase.from(kitsTable).insert(rows);
    if (error) return { error };
    await refresh();
    return { count: rows.length };
  }, [parentId, vendorId, refresh, kitsTable, parentFK]);

  // Delete only the unconsumed (available) kits in this partition. Allocated /
  // used kits are preserved.
  const clearUnconsumed = useCallback(async () => {
    if (!parentId) return {};
    let q = supabase
      .from(kitsTable)
      .delete()
      .eq(parentFK, parentId)
      .eq('status', 'available');
    q = vendorId == null ? q.is('vendor_id', null) : q.eq('vendor_id', vendorId);
    const { error } = await q;
    if (error) return { error };
    await refresh();
    return {};
  }, [parentId, vendorId, refresh, kitsTable, parentFK]);

  return { kits, balance, loading, refresh, appendKits, clearUnconsumed };
}

// Kind configs exported for wrappers and other prep consumers (low-prep, etc).
export const WORKBOOK_PREP_KIND = {
  kitsTable: 'workbook_prep_kits',
  parentFK: 'workbook_id',
  channelPrefix: 'wpk',
};
export const ASSESSMENT_PREP_KIND = {
  kitsTable: 'assessment_prep_kits',
  parentFK: 'assessment_id',
  channelPrefix: 'apk',
};
