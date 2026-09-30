import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { summariseKits } from '../lib/prepPools.js';

// Kit counts for EVERY parent (workbook or assessment) in one vendor partition,
// for the Prep overview. `vendorId` partition selector: a vendor uuid, or `null`
// for the shared super pool. Returns
//   byParent[parentId] = summariseKits(...) — total, available, allocated,
//   held, stranded, used, withdrawn, fullyPreppable, lastDrawn, session ids
// (see lib/prepPools.js; the same sum the low-prep badge uses).
//
// kindConfig: { kitsTable, parentFK, channelPrefix }
export function useContentPrepBalances(kindConfig, vendorId) {
  const { kitsTable, parentFK, channelPrefix } = kindConfig;
  const [byParent, setByParent] = useState({});
  const [loading, setLoading] = useState(true);
  // Which partition `byParent` currently describes. `loading` goes true on
  // every realtime refresh; `ready` only goes false when the partition itself
  // changes, so a caller can keep its screen up through a refresh.
  const [loadedFor, setLoadedFor] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    let q = supabase.from(kitsTable).select(`${parentFK}, status, payload, consumed_session_id, consumed_at`);
    q = vendorId == null ? q.is('vendor_id', null) : q.eq('vendor_id', vendorId);
    const { data, error } = await q;
    const groups = {};
    for (const k of (error ? [] : data || [])) (groups[k[parentFK]] || (groups[k[parentFK]] = [])).push(k);
    const m = {};
    for (const id of Object.keys(groups)) m[id] = summariseKits(groups[id]);
    setByParent(m);
    setLoadedFor(vendorId || 'super');
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

  return { byParent, loading, ready: loadedFor === (vendorId || 'super'), refresh };
}
