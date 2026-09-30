import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useContentPrepBalances } from './useContentPrepBalances.js';
import { WORKBOOK_PREP_KIND, ASSESSMENT_PREP_KIND } from './useContentPrep.js';
import { EMPTY_SUMMARY, poolState } from '../lib/prepPools.js';

// Every prep pool in one vendor partition — workbooks and assessments together
// — for the Prep cockpit. `vendorId`: a vendor uuid, or null for the shared
// super pool.
//
// Returns
//   pools: [{ id, kind, title, program, structure, summary, state }]
//          summary = lib/prepPools summariseKits(); state = poolState()
//   sessionsById: the classes currently HOLDING kits (allocated), with the
//          dates classState needs. A class the caller cannot read is simply
//          absent — its kits still count as held.
export function usePrepPools(vendorId) {
  const [parents, setParents] = useState({ workbooks: [], assessments: [], programs: [] });
  const [parentsLoading, setParentsLoading] = useState(true);
  const [sessionsById, setSessionsById] = useState({});

  const wb = useContentPrepBalances(WORKBOOK_PREP_KIND, vendorId);
  const as = useContentPrepBalances(ASSESSMENT_PREP_KIND, vendorId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [w, a, p] = await Promise.all([
        supabase.from('workbooks').select('id, title, prep_template, program_id').eq('is_template', true).order('title'),
        // `kind` is on assessments only; a question bank is one with kind='bank'.
        supabase.from('assessments').select('id, title, prep_template, program_id, kind').eq('is_template', true).order('title'),
        supabase.from('programs').select('id, title'),
      ]);
      if (cancelled) return;
      setParents({
        workbooks: w.data || [],
        // A question bank cannot take prep — nobody sits a bank. Filtered here
        // rather than in the query: .neq() would also drop a NULL kind.
        assessments: (a.data || []).filter(x => x.kind !== 'bank'),
        programs: p.data || [],
      });
      setParentsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const pools = useMemo(() => {
    const programTitle = Object.fromEntries(parents.programs.map(p => [p.id, p.title]));
    const build = (rows, kind, byParent) => rows.map(r => {
      const structure = Array.isArray(r.prep_template) ? r.prep_template : [];
      const summary = byParent[r.id] || EMPTY_SUMMARY;
      return {
        id: r.id,
        kind,
        title: r.title,
        program: programTitle[r.program_id] || null,
        structure,
        summary,
        state: poolState(structure.length > 0, summary),
      };
    });
    return [
      ...build(parents.workbooks, 'workbook', wb.byParent),
      ...build(parents.assessments, 'assessment', as.byParent),
    ];
  }, [parents, wb.byParent, as.byParent]);

  // The classes holding kits. Keyed on the id set, so a realtime kit change
  // that moves no kit between classes does not refetch.
  const heldSig = useMemo(() => {
    const ids = new Set();
    for (const p of pools) p.summary.heldSessionIds.forEach(id => ids.add(id));
    return [...ids].sort().join(',');
  }, [pools]);

  useEffect(() => {
    if (!heldSig) { setSessionsById({}); return undefined; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('sessions')
        .select('id, name, starts_at, ends_at, closed_at')
        .in('id', heldSig.split(','));
      if (cancelled) return;
      setSessionsById(Object.fromEntries((data || []).map(s => [s.id, s])));
    })();
    return () => { cancelled = true; };
  }, [heldSig]);

  return {
    // `ready`, not `loading`: a realtime refresh of the balances re-enters
    // `loading`, and hiding the grid for that would flash it away every time a
    // class draws a kit.
    loading: parentsLoading || !wb.ready || !as.ready,
    pools,
    sessionsById,
  };
}
