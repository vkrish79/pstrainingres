import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { isTrainerTier, isSuperTrainerOrAbove } from '../lib/roles.js';

// A pool is "low" when FEWER THAN this many more participants can be FULLY
// prepped (the bottleneck-column count — see useWorkbookPrep.fullyPreppable).
// i.e. fullyPreppable < threshold triggers the alert (0 = exhausted/empty).
// Tune here.
export const LOW_PREP_THRESHOLD = 16;

// Detects prep pools running low for the logged-in trainer's partition (super →
// the shared super pool; vendor tiers → their own vendor). Used by both the
// home-page banner and the TopBar "Prep" badge. Returns low pools sorted worst-
// first: [{ id, title, fullyPreppable }].
export function useLowPrepPools(profile) {
  const [lowPools, setLowPools] = useState([]);
  const [loading, setLoading] = useState(true);

  const role = profile?.role;
  const myVendor = profile?.vendor_id || null;

  useEffect(() => {
    if (!role || !isTrainerTier(role)) { setLowPools([]); setLoading(false); return; }
    const vendorId = isSuperTrainerOrAbove(role) ? null : myVendor;
    let cancelled = false;
    (async () => {
      let kq = supabase.from('workbook_prep_kits').select('workbook_id, status, payload');
      kq = vendorId == null ? kq.is('vendor_id', null) : kq.eq('vendor_id', vendorId);
      const [{ data: kits }, { data: wbs }] = await Promise.all([
        kq,
        supabase.from('workbooks').select('id, title').eq('is_template', true),
      ]);
      if (cancelled) return;

      const titleById = {};
      (wbs || []).forEach(w => { titleById[w.id] = w.title; });

      // Aggregate per workbook, mirroring useWorkbookPrep's fullyPreppable.
      const m = {};
      for (const k of kits || []) {
        const e = m[k.workbook_id] || (m[k.workbook_id] = { total: 0, perSection: {} });
        e.total++;
        for (const [h, v] of Object.entries(k.payload || {})) {
          if (v == null || String(v).trim() === '') continue;
          e.perSection[h] = e.perSection[h] || { available: 0 };
          if (k.status === 'available') e.perSection[h].available++;
        }
      }

      const low = [];
      for (const id of Object.keys(m)) {
        const e = m[id];
        if (e.total === 0) continue; // never stocked → not "low", just unset
        const avs = Object.values(e.perSection).map(p => p.available);
        const fullyPreppable = avs.length ? Math.min(...avs) : 0;
        if (fullyPreppable < LOW_PREP_THRESHOLD) {
          low.push({ id, title: titleById[id] || 'Workbook', fullyPreppable });
        }
      }
      low.sort((a, b) => a.fullyPreppable - b.fullyPreppable);
      setLowPools(low);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [role, myVendor]);

  return { lowPools, loading };
}
