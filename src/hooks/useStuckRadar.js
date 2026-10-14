import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { median } from '../lib/sessionPace.js';

// Who's stuck, quietly (D2): anyone online who has been on one exercise far
// longer than the class usually takes, so the trainer notices the people a
// raised-hand button misses.
//
// "How long they've been on it" = earlier stays on that exercise + the current
// one (cursor last_seen − on_since). Both times are stamped by the server, so
// the laptop's clock, ~32 s behind the server's, never enters into it.
// "How long the class usually takes" = the median, per PERSON, of the time
// spent on it by people who are not on it now (section_time_by_person). Per
// person, not per visit: a glance back at an exercise splits one stay in two.
//
// Honest by construction: nothing is flagged until at least MIN_FINISHED
// people have finished with an exercise. Before the SQL is applied the RPC
// fails and nothing is flagged at all.
const REFRESH_MS = 60000;
const MIN_FINISHED = 3;       // people the median is taken from
const MIN_STAY_S = 60;        // shorter than this is paging past, not doing it
const FLOOR_S = 10 * 60;      // never "stuck" under 10 minutes
const FACTOR = 2;             // …and at least twice the usual

export function useStuckRadar({ sessionId, cursors, participants, isOnline, enabled = true }) {
  const [prior, setPrior] = useState({});   // { pid: { sectionId: seconds } }

  const reload = useCallback(async () => {
    if (!sessionId || !enabled) return;
    const { data, error } = await supabase.rpc('section_time_by_person', { p_session_id: sessionId });
    if (error) return; // not applied yet, or offline: keep what we had
    const m = {};
    for (const r of data || []) (m[r.participant_id] ||= {})[r.section_id] = r.seconds;
    setPrior(m);
  }, [sessionId, enabled]);

  useEffect(() => {
    reload();
    if (!enabled) return undefined;
    const t = setInterval(reload, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload, enabled]);

  // A move to another exercise finishes a stay: re-read soon after, so the
  // median includes it without waiting a minute.
  const moves = Object.values(cursors || {}).map(c => `${c.section_id}`).join('|');
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setTimeout(reload, 3000);
    return () => clearTimeout(t);
  }, [moves, reload, enabled]);

  return useMemo(() => {
    if (!enabled) return { stuck: [], groups: [], typical: {} };
    const active = (participants || []).filter(p => !p.deactivated_at);
    const onNow = {};   // pid -> sectionId
    for (const p of active) {
      const c = cursors?.[p.id];
      if (c?.section_id && isOnline(p.id)) onNow[p.id] = c.section_id;
    }

    // Usual time per exercise, from people not on it now.
    const bySection = {};
    for (const p of active) {
      for (const [sec, secs] of Object.entries(prior[p.id] || {})) {
        if (onNow[p.id] === sec || secs < MIN_STAY_S) continue;
        (bySection[sec] ||= []).push(secs);
      }
    }
    const typical = {};
    for (const [sec, list] of Object.entries(bySection)) {
      if (list.length >= MIN_FINISHED) typical[sec] = median(list);
    }

    const stuck = [];
    for (const p of active) {
      const sec = onNow[p.id];
      const c = cursors[p.id];
      const usual = typical[sec];
      if (!sec || !usual) continue;
      const since = c.on_since || c.moved_at;
      if (!since || !c.last_seen) continue;
      const current = Math.max(0, (new Date(c.last_seen).getTime() - new Date(since).getTime()) / 1000);
      const total = current + (prior[p.id]?.[sec] || 0);
      if (total >= Math.max(FACTOR * usual, FLOOR_S)) {
        stuck.push({
          id: p.id,
          name: p.full_name || '(unnamed)',
          sectionId: sec,
          sectionTitle: c.section_title || 'this exercise',
          minutes: Math.round(total / 60),
          usualMinutes: Math.max(1, Math.round(usual / 60)),
        });
      }
    }
    stuck.sort((a, b) => b.minutes - a.minutes);

    // Two or more stuck on one exercise points at the exercise, not the people.
    const groupMap = {};
    for (const s of stuck) (groupMap[s.sectionId] ||= { sectionId: s.sectionId, title: s.sectionTitle, people: [] }).people.push(s);
    const groups = Object.values(groupMap).filter(g => g.people.length >= 2);

    return { stuck, groups, typical };
  }, [enabled, participants, cursors, isOnline, prior]);
}
