import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { mirrorWorkbookKitCell } from '../lib/prepMirror.js';

// Trainer-side hook for a master parent's (workbook or assessment) prep
// repository, scoped to ONE vendor partition. `vendorId` is the partition
// selector: a vendor uuid, or `null` for the shared super pool.
//
// kindConfig: { kitsTable, parentFK, channelPrefix, mirrorsParticipantPrep }
//   kitsTable     — 'workbook_prep_kits' | 'assessment_prep_kits'
//   parentFK      — 'workbook_id' | 'assessment_id'
//   channelPrefix — realtime channel name prefix, e.g. 'wpk' | 'apk'
//   mirrorsParticipantPrep — true when the claim COPIES the payload out to the
//                   participant (workbooks), so an allocated-kit edit has to be
//                   mirrored into participant_prep too
//
// Exposes the loaded kits, a computed balance, append (upload), and
// clear-unconsumed — identical surface to the legacy useWorkbookPrep.
export function useContentPrep(kindConfig, parentId, vendorId) {
  const { kitsTable, parentFK, channelPrefix, mirrorsParticipantPrep } = kindConfig;

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

  // Manually flip a kit's status — trainer "withdraw" (available → used, for a
  // PNR consumed off-system) and "restore" (used → available). Pool-write only.
  const setKitStatus = useCallback(async (kitId, nextStatus) => {
    const patch = nextStatus === 'used'
      ? { status: 'used', consumed_at: new Date().toISOString() }
      : { status: nextStatus, consumed_at: null };
    const { error } = await supabase.from(kitsTable).update(patch).eq('id', kitId);
    if (error) return { error };
    await refresh();
    return {};
  }, [kitsTable, refresh]);

  // Edit ONE cell of ONE existing kit — the per-kit fix for a single bad value,
  // as opposed to restockColumn's whole-column sweep. Allowed on kits in the
  // pool (available) and on kits already drawn by a live class (allocated); a
  // spent kit is left alone because close-session has already snapshotted it.
  // An empty value DELETES the key, so the balance stops counting it.
  // `structure` is the master's prep_template — needed only for the mirror.
  const editKitCell = useCallback(async (kit, header, value, structure = []) => {
    if (!kit?.id || !header) return {};
    if (kit.status !== 'available' && kit.status !== 'allocated') {
      return { error: new Error('Only kits in the pool or allocated to a live class can be edited.') };
    }
    const content = String(value ?? '').trim();
    const payload = { ...(kit.payload || {}) };
    if (content) payload[header] = content; else delete payload[header];

    const { error } = await supabase.from(kitsTable).update({ payload }).eq('id', kit.id);
    if (error) return { error };

    // Allocated workbook kit → keep the participant's own copy in step.
    if (mirrorsParticipantPrep && kit.status === 'allocated') {
      const { error: mirrorError } = await mirrorWorkbookKitCell({ kit, header, content, structure });
      if (mirrorError) { await refresh(); return { error: mirrorError }; }
    }
    await refresh();
    return {};
  }, [kitsTable, mirrorsParticipantPrep, refresh]);

  // Re-stock one exercise column across the UNUSED (available) kits — used when a
  // whole exercise's prep goes bad. `values` are fresh PNRs (one per kit, in
  // kit_index order); overwrites payload[header] on as many available kits as
  // there are values. Pool-level fix; allocated participants are handled
  // separately on the session prep grid.
  const restockColumn = useCallback(async (header, values) => {
    if (!parentId || !header || !values?.length) return { count: 0 };
    let q = supabase
      .from(kitsTable)
      .select('id, payload, kit_index')
      .eq(parentFK, parentId)
      .eq('status', 'available')
      .order('kit_index');
    q = vendorId == null ? q.is('vendor_id', null) : q.eq('vendor_id', vendorId);
    const { data: avail, error } = await q;
    if (error) return { error };
    const n = Math.min(values.length, (avail || []).length);
    for (let i = 0; i < n; i++) {
      const kit = avail[i];
      const { error: e } = await supabase
        .from(kitsTable)
        .update({ payload: { ...(kit.payload || {}), [header]: values[i] } })
        .eq('id', kit.id);
      if (e) return { error: e };
    }
    await refresh();
    return { count: n, available: (avail || []).length };
  }, [parentId, vendorId, kitsTable, parentFK, refresh]);

  return {
    kits, balance, loading, refresh,
    appendKits, clearUnconsumed, setKitStatus, restockColumn, editKitCell,
  };
}

// Kind configs exported for wrappers and other prep consumers (low-prep, etc).
export const WORKBOOK_PREP_KIND = {
  kitsTable: 'workbook_prep_kits',
  parentFK: 'workbook_id',
  channelPrefix: 'wpk',
  mirrorsParticipantPrep: true,
};
export const ASSESSMENT_PREP_KIND = {
  kitsTable: 'assessment_prep_kits',
  parentFK: 'assessment_id',
  channelPrefix: 'apk',
  // Participants read their allocated assessment kit row directly — no copy.
  mirrorsParticipantPrep: false,
};
