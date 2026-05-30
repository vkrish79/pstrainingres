import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { isTrainerTier, isSuperTrainerOrAbove } from '../lib/roles.js';

// A pool is "low" when FEWER THAN this many more participants can be FULLY
// prepped (the bottleneck-column count — see useContentPrep.fullyPreppable).
// i.e. fullyPreppable < threshold triggers the alert (0 = exhausted/empty).
// Tune here.
export const LOW_PREP_THRESHOLD = 16;

// Detects prep pools running low for the logged-in trainer's partition (super →
// the shared super pool; vendor tiers → their own vendor) across BOTH workbook
// and assessment pools. Used by both the home-page banner and the TopBar "Prep"
// badge. Returns low pools sorted worst-first:
// [{ id, kind: 'workbook'|'assessment', title, fullyPreppable }].
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
      const workbookLow = await loadKind({
        kitsTable: 'workbook_prep_kits',
        parentsTable: 'workbooks',
        parentFK: 'workbook_id',
        kind: 'workbook',
        vendorId,
      });
      const assessmentLow = await loadKind({
        kitsTable: 'assessment_prep_kits',
        parentsTable: 'assessments',
        parentFK: 'assessment_id',
        kind: 'assessment',
        vendorId,
      });
      if (cancelled) return;

      const all = [...workbookLow, ...assessmentLow]
        .sort((a, b) => a.fullyPreppable - b.fullyPreppable);
      setLowPools(all);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [role, myVendor]);

  return { lowPools, loading };
}

async function loadKind({ kitsTable, parentsTable, parentFK, kind, vendorId }) {
  let kq = supabase.from(kitsTable).select(`${parentFK}, status, payload`);
  kq = vendorId == null ? kq.is('vendor_id', null) : kq.eq('vendor_id', vendorId);
  const [{ data: kits, error: kErr }, { data: parents, error: pErr }] = await Promise.all([
    kq,
    supabase.from(parentsTable).select('id, title, prep_template').eq('is_template', true),
  ]);
  // assessment tables may not be present pre-PR2b SQL apply — degrade quietly.
  if (kErr || pErr) return [];

  const titleById = {};
  const hasTemplateById = {};
  (parents || []).forEach(p => {
    titleById[p.id] = p.title;
    hasTemplateById[p.id] = Array.isArray(p.prep_template) && p.prep_template.length > 0;
  });

  const m = {};
  for (const k of kits || []) {
    const pid = k[parentFK];
    const e = m[pid] || (m[pid] = { total: 0, perSection: {} });
    e.total++;
    for (const [h, v] of Object.entries(k.payload || {})) {
      if (v == null || String(v).trim() === '') continue;
      e.perSection[h] = e.perSection[h] || { available: 0 };
      if (k.status === 'available') e.perSection[h].available++;
    }
  }

  const low = [];
  // Parents that have kits — flag the ones whose bottleneck-column count is low.
  for (const id of Object.keys(m)) {
    const e = m[id];
    const avs = Object.values(e.perSection).map(p => p.available);
    const fullyPreppable = avs.length ? Math.min(...avs) : 0;
    if (fullyPreppable < LOW_PREP_THRESHOLD) {
      low.push({ id, kind, title: titleById[id] || (kind === 'assessment' ? 'Assessment' : 'Workbook'), fullyPreppable });
    }
  }
  // Parents with a prep_template but ZERO kits in this partition — empty pools
  // that still need stocking. Without this, an assessment whose super set up
  // the template but nobody has uploaded kits to never surfaces in the banner.
  for (const id of Object.keys(hasTemplateById)) {
    if (!hasTemplateById[id]) continue;
    if (m[id]) continue; // already counted above
    low.push({ id, kind, title: titleById[id] || (kind === 'assessment' ? 'Assessment' : 'Workbook'), fullyPreppable: 0 });
  }
  return low;
}
