import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Resolve the participant + session a prep kit was consumed by, so the grid can
// label allocated/used rows with real names instead of ids. Batch-fetches once
// per distinct id set. `consumed_participant_id` can be null (kit allocated to a
// session but not a specific participant) — such rows fall back to the session.
export function usePrepConsumedRefs(kits) {
  const [refs, setRefs] = useState({ participantsById: {}, sessionsById: {} });

  // Stable signature so we only refetch when the referenced ids actually change.
  const sig = useMemo(() => {
    const p = new Set(), s = new Set();
    for (const k of kits || []) {
      if (k.consumed_participant_id) p.add(k.consumed_participant_id);
      if (k.consumed_session_id) s.add(k.consumed_session_id);
    }
    return [[...p].sort().join(','), [...s].sort().join(',')];
  }, [kits]);

  useEffect(() => {
    const [pCsv, sCsv] = sig;
    const pids = pCsv ? pCsv.split(',') : [];
    const sids = sCsv ? sCsv.split(',') : [];
    if (!pids.length && !sids.length) { setRefs({ participantsById: {}, sessionsById: {} }); return; }
    let cancelled = false;
    (async () => {
      const [{ data: profs }, { data: sess }] = await Promise.all([
        pids.length ? supabase.from('profiles').select('id, full_name').in('id', pids) : Promise.resolve({ data: [] }),
        sids.length ? supabase.from('sessions').select('id, name, join_code').in('id', sids) : Promise.resolve({ data: [] }),
      ]);
      if (cancelled) return;
      const participantsById = {}; (profs || []).forEach(p => { participantsById[p.id] = p; });
      const sessionsById = {}; (sess || []).forEach(s => { sessionsById[s.id] = s; });
      setRefs({ participantsById, sessionsById });
    })();
    return () => { cancelled = true; };
  }, [sig]);

  return refs;
}
