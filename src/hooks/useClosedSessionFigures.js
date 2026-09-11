import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// The analytics rows kept for one closed session, for when its saved summary
// has been slimmed by the retention job and the answers the closed view
// normally counts from are gone. These rows are never deleted.
//
// Returns { session: session_analytics row | null, sections: [] | null }.
// `enabled` false skips the reads (an unslimmed session counts from its own
// summary, which is more precise).
export function useClosedSessionFigures(sessionId, enabled) {
  const [figures, setFigures] = useState(null);

  useEffect(() => {
    if (!enabled || !sessionId) { setFigures(null); return undefined; }
    let cancelled = false;
    (async () => {
      const [a, s] = await Promise.all([
        supabase.from('session_analytics').select('*').eq('session_id', sessionId).maybeSingle(),
        supabase.from('session_section_analytics').select('*').eq('session_id', sessionId).order('order_index'),
      ]);
      if (cancelled) return;
      setFigures({ session: a.data || null, sections: s.data || [], error: a.error?.message || s.error?.message || null });
    })();
    return () => { cancelled = true; };
  }, [sessionId, enabled]);

  return figures;
}
