import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { mirrorWorkbookKitCells } from '../lib/prepMirror.js';

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

  // The ONLY writer of kit payloads, driving the bulk edit sheet: many cells
  // across many kits in one go. Writes one UPDATE per kit (not per cell), mirrors
  // the allocated workbook cells in one batch, and refreshes ONCE at the end.
  //
  // `changes` is [{ kitId, header, value }]. The new payload is merged onto the
  // kit's CURRENT payload rather than a snapshot the caller holds, so a
  // concurrent edit to a different column of the same kit survives.
  //
  // Returns { count, failed: [{ kitId, header, message }] } — a batch can
  // half-succeed, and the caller needs to say which cells landed.
  const editKitCells = useCallback(async (changes, structure = []) => {
    if (!changes?.length) return { count: 0, failed: [] };
    const byId = new Map(kits.map(k => [k.id, k]));
    const failed = [];

    // Group by kit so each row is a single UPDATE.
    const groups = new Map();
    for (const c of changes) {
      const kit = byId.get(c.kitId);
      if (!kit) { failed.push({ ...c, message: 'This kit no longer exists — reload the pool.' }); continue; }
      if (kit.status !== 'available' && kit.status !== 'allocated') {
        failed.push({
          ...c,
          message: "This kit has been spent — its class closed while you were editing, and a closed session's prep is already snapshotted.",
        });
        continue;
      }
      if (!groups.has(kit.id)) groups.set(kit.id, { kit, cells: [] });
      groups.get(kit.id).cells.push({ header: c.header, content: String(c.value ?? '').trim() });
    }

    let count = 0;
    const toMirror = [];
    for (const { kit, cells } of groups.values()) {
      const payload = { ...(kit.payload || {}) };
      for (const { header, content } of cells) {
        if (content) payload[header] = content; else delete payload[header];
      }
      const { error } = await supabase.from(kitsTable).update({ payload }).eq('id', kit.id);
      if (error) {
        cells.forEach(({ header }) => failed.push({ kitId: kit.id, header, message: error.message }));
        continue;
      }
      count += cells.length;
      if (mirrorsParticipantPrep && kit.status === 'allocated') {
        cells.forEach(({ header, content }) => toMirror.push({ kit, header, content }));
      }
    }

    if (toMirror.length) {
      const { failed: mirrorFailed } = await mirrorWorkbookKitCells({ items: toMirror, structure });
      for (const f of mirrorFailed) {
        failed.push({ kitId: f.kit.id, header: f.header, message: `Kit updated, but the participant's copy was not: ${f.message}` });
      }
    }

    await refresh();
    return { count, failed };
  }, [kits, kitsTable, mirrorsParticipantPrep, refresh]);

  return {
    kits, balance, loading, refresh,
    appendKits, clearUnconsumed, setKitStatus, editKitCells,
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
