import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Trainer "spotlight" / focus for a session — one row per session, kept live.
// Anyone in the session (trainer + enrolled participants) loads + subscribes to
// `focus`; the trainer additionally calls the write helpers.
//
//   focus = { section_id, section_title, snap_at, set_at } | null
//
// - `spotlight(section)`     → soft: sets the focused exercise (participants see
//                              a banner + Jump). Leaves snap_at untouched.
// - `spotlight(section,{hard:true})` → hard: also bumps snap_at, the one-time
//                              "pull everyone here now" signal.
// - `clear()`                → removes the spotlight (section_id = null). Never
//                              bumps snap_at.
//
// Participants detect a hard snap by a CHANGE in snap_at (not its magnitude),
// which is clock-skew-proof; see ParticipantWorkbookPage for the jump-once
// logic that seeds from the loaded value so joining mid-session doesn't yank.
export function useSessionFocus(sessionId, selfId) {
  const [focus, setFocus] = useState(null);

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from('session_focus')
        .select('section_id, section_title, snap_at, set_at')
        .eq('session_id', sessionId)
        .maybeSingle();
      if (!cancelled) setFocus(data || null);
    })();

    const channel = supabase
      .channel(`session-${sessionId}-focus`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_focus', filter: `session_id=eq.${sessionId}` },
        (payload) => { setFocus(payload.eventType === 'DELETE' ? null : (payload.new || null)); },
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [sessionId]);

  async function spotlight(section, { hard = false } = {}) {
    if (!sessionId || !section) return;
    const now = new Date().toISOString();
    const row = {
      session_id: sessionId,
      section_id: section.id,
      section_title: section.title,
      set_by: selfId,
      set_at: now,
    };
    // Bump snap_at only on a hard snap, to the SAME timestamp as set_at — so
    // `snap_at === set_at` is a reliable "this focus came from a snap" flag.
    // Omitting it on a soft spotlight leaves the existing value intact (upsert
    // only writes provided columns), so a prior snap doesn't re-fire.
    if (hard) row.snap_at = now;
    await supabase.from('session_focus').upsert(row, { onConflict: 'session_id' });
  }

  async function clear() {
    if (!sessionId) return;
    await supabase.from('session_focus').upsert(
      { session_id: sessionId, section_id: null, section_title: null, set_by: selfId, set_at: new Date().toISOString() },
      { onConflict: 'session_id' },
    );
  }

  return { focus, spotlight, clear };
}
