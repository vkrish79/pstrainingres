import { useEffect, useMemo, useState } from 'react';
import { isFillableBlock, expectedInputs, filledInputs } from '../lib/blockHelpers.js';

// A participant counts as "live" (vs. idle) if they changed exercise or saved
// an answer within this window; otherwise the dot decays to idle.
const IDLE_MS = 45000;
// No heartbeat within this window → treated as offline (must exceed the
// participant heartbeat interval, currently 20s, with headroom).
const OFFLINE_MS = 45000;

// Each participant's workbook progress and live presence on the session
// dashboard, from the answers and the live cursors.
export function useRoomPresence({ participants, cursors, answers, blocks, sections }) {
  // live/idle/offline are time-based, so tick periodically to let dots decay
  // even when no cursor/answer event arrives.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick(n => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const fillableBlocks = useMemo(() => blocks.filter(isFillableBlock), [blocks]);
  // Inputs, not blocks — the cohort roster must agree with the exercise views.
  const totalFillable = fillableBlocks.reduce((n, b) => n + expectedInputs(b), 0);

  function progressFor(participantId) {
    const ans = answers[participantId] || {};
    let answered = 0; let lastTs = null;
    for (const b of fillableBlocks) {
      const a = ans[b.id];
      answered += filledInputs(b, a?.value);
      if (a?.updated_at && (!lastTs || a.updated_at > lastTs)) lastTs = a.updated_at;
    }
    return { answered, total: totalFillable, lastTs };
  }

  // Section title of the participant's most recently edited answer — the
  // offline fallback for the "On now" column.
  function lastSectionTitleFor(participantId) {
    const ans = answers[participantId] || {};
    let lastTs = null; let lastBlockId = null;
    for (const b of fillableBlocks) {
      const a = ans[b.id];
      if (a?.updated_at && (!lastTs || a.updated_at > lastTs)) { lastTs = a.updated_at; lastBlockId = b.id; }
    }
    if (!lastBlockId) return null;
    const secId = blocks.find(b => b.id === lastBlockId)?.section_id;
    return sections.find(s => s.id === secId)?.title || null;
  }

  // Live "On now" state for a row. A fresh last_seen (heartbeat) means online;
  // moved_at (server-stamped only on a section change) OR a recent answer
  // (`lastTs`) within IDLE_MS keeps them "live" vs. "idle".
  function presenceFor(participantId, lastTs) {
    const cur = cursors[participantId];
    const now = Date.now();
    const online = cur?.last_seen && now - new Date(cur.last_seen).getTime() < OFFLINE_MS;
    if (online) {
      const movedRecently = cur.moved_at && now - new Date(cur.moved_at).getTime() < IDLE_MS;
      const answeredRecently = lastTs && now - new Date(lastTs).getTime() < IDLE_MS;
      return {
        state: movedRecently || answeredRecently ? 'live' : 'idle',
        label: cur.section_title || 'In workbook',
      };
    }
    const last = lastSectionTitleFor(participantId);
    return { state: 'offline', label: last ? `last · ${last}` : 'offline' };
  }

  const onlineCount = useMemo(() => {
    const now = Date.now();
    return participants.filter(p => {
      const cur = cursors[p.id];
      return cur?.last_seen && now - new Date(cur.last_seen).getTime() < OFFLINE_MS;
    }).length;
    // nowTick forces recompute so the count decays as heartbeats go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, cursors, nowTick]);

  // Which online participants are parked on each exercise right now — the
  // cohort-spread read for the "By exercise" sidebar (count = list length; the
  // names feed the hover popover). Keyed by section id (clone sections, which
  // the cursor writes and the dashboard loads).
  const liveBySection = useMemo(() => {
    const now = Date.now();
    const out = {};
    for (const p of participants) {
      const cur = cursors[p.id];
      if (cur?.section_id && cur.last_seen && now - new Date(cur.last_seen).getTime() < OFFLINE_MS) {
        (out[cur.section_id] = out[cur.section_id] || []).push({ id: p.id, full_name: p.full_name });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, cursors, nowTick]);

  // The same heartbeat test as the "N online" count.
  function isOnline(pid) {
    const cur = cursors[pid];
    return !!(cur?.last_seen && Date.now() - new Date(cur.last_seen).getTime() < OFFLINE_MS);
  }

  return { totalFillable, progressFor, presenceFor, onlineCount, liveBySection, isOnline };
}
