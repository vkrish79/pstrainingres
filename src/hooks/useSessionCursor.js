import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// How often a participant re-asserts presence so the trainer can tell they're
// still online. The trainer treats a cursor as offline once last_seen is older
// than the offline window (defined dashboard-side, comfortably > this).
const HEARTBEAT_MS = 20000;

// Live "which exercise is each participant on", backed by the RLS-protected
// `participant_cursor` table (NOT Supabase Presence). RLS is the point: the
// trainer reads every cursor in their session while a participant can read/
// write only their own row, so peers can't see each other — a guarantee a
// shared presence channel can't make.
//
// Modes (one hook, picked by `track`):
//   - participant (track:true): upserts its own cursor whenever `sectionId`
//     changes, plus a heartbeat to keep last_seen fresh. Server triggers stamp
//     moved_at (on section change only) and last_seen (every write).
//   - trainer (track:false): loads all cursors for the session and keeps them
//     live via postgres_changes. Returns `cursors`: participantId -> row.
export function useSessionCursor(sessionId, { selfId, track = false, sectionId = null, sectionTitle = '' } = {}) {
  const [cursors, setCursors] = useState({}); // participantId -> { section_id, section_title, moved_at, last_seen }

  // --- Participant: upsert own cursor ---
  const upsert = useCallback(() => {
    if (!track || !sessionId || !selfId) return;
    supabase
      .from('participant_cursor')
      .upsert(
        { session_id: sessionId, participant_id: selfId, section_id: sectionId, section_title: sectionTitle },
        { onConflict: 'session_id,participant_id' },
      )
      // Best-effort (presence is non-critical) but surface failures: a silent
      // 404/RLS rejection here is exactly what makes "everyone offline" hard to
      // diagnose.
      .then(
        ({ error }) => { if (error) console.warn('[cursor] write failed:', error.message); },
        (err) => { console.warn('[cursor] write threw:', err?.message || err); },
      );
  }, [track, sessionId, selfId, sectionId, sectionTitle]);

  // Write whenever the current section changes (and once on mount).
  useEffect(() => { upsert(); }, [upsert]);

  // Heartbeat while mounted so the trainer can distinguish online from gone.
  useEffect(() => {
    if (!track) return undefined;
    const t = setInterval(upsert, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [track, upsert]);

  // --- Trainer: load + keep live ---
  useEffect(() => {
    if (track || !sessionId) return undefined;
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from('participant_cursor')
        .select('participant_id, section_id, section_title, moved_at, last_seen')
        .eq('session_id', sessionId);
      if (cancelled) return;
      const map = {};
      (data || []).forEach(r => { map[r.participant_id] = r; });
      setCursors(map);
    })();

    const channel = supabase
      .channel(`session-${sessionId}-cursors`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participant_cursor', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          setCursors(prev => {
            const next = { ...prev };
            if (payload.eventType === 'DELETE') {
              const pid = payload.old?.participant_id;
              if (pid) delete next[pid];
            } else if (payload.new) {
              next[payload.new.participant_id] = payload.new;
            }
            return next;
          });
        },
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [track, sessionId]);

  return { cursors };
}
