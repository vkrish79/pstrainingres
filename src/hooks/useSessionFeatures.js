import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { featureFlags } from '../lib/sessionFeatures.js';

let instanceSeq = 0;

// The features a session has switched off (see lib/sessionFeatures.js), live.
//
// Read on its own rather than added to the session queries: those name their
// columns, and asking for one that does not exist yet fails the WHOLE query —
// the participant's workbook would not load until the SQL is applied. Here a
// missing column (42703) or function just means "everything on" and
// `available` false, which hides the Session features panel.
//
// Follows changes over realtime on the session row, so a feature switched off
// in the cockpit goes from participants' screens without a reload.
export function useSessionFeatures(sessionId) {
  const [off, setOff] = useState(null);
  const [available, setAvailable] = useState(false);
  // The first answer is in (either way). Until then `on` is everything-on,
  // so a page that would look different can wait rather than flash.
  const [readyFor, setReadyFor] = useState(null);

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    supabase.from('sessions').select('features_off').eq('id', sessionId).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setAvailable(false); setOff(null); setReadyFor(sessionId); return; }
        setAvailable(true);
        setOff(data?.features_off || null);
        setReadyFor(sessionId);
      });
    // A name per hook instance: realtime-js returns the EXISTING channel for a
    // name it already holds, and the cockpit and its closed view (or two tabs
    // of one page) can both be watching the same session.
    const channel = supabase
      .channel(`session-features-${sessionId}-${++instanceSeq}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          if (!payload.new || !('features_off' in payload.new)) return;
          setOff(payload.new.features_off || null);
        },
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [sessionId]);

  const on = useMemo(() => featureFlags(off), [off]);

  // Save a new off-list. The function reads the row back, so a refusal is an
  // error here rather than a silent 200.
  const save = useCallback(async (nextOff) => {
    const { data, error } = await supabase.rpc('set_session_features', {
      p_session_id: sessionId, p_off: nextOff,
    });
    if (error) return { error: new Error(error.message) };
    setOff(data || null);
    return { error: null };
  }, [sessionId]);

  return { off: off || [], on, available, ready: !!sessionId && readyFor === sessionId, save };
}
