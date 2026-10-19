import { useMemo } from 'react';
import { median } from '../lib/sessionPace.js';
import { isAnswered, isFillableBlock } from '../lib/blockHelpers.js';

// Who's stuck, quietly (D2): anyone online who has gone far longer than the
// class usually does without saving an answer on the exercise they are on, so
// the trainer notices the people a raised-hand button misses.
//
// Time since PROGRESS, not time on the page. A workbook tab left open on an
// Amadeus exercise all morning — while the work happens in Amadeus, through a
// demo, through lunch — read as "on it for 322 min". So the clock starts at the
// later of: arriving on this exercise (cursor on_since) and their last saved
// answer on it, and runs to their last heartbeat. All three are stamped by the
// server (answers.updated_at by trg_answers_updated), so the laptop's clock,
// ~32 s behind the server's, never enters into it.
//
// "Usual" = the class median of the gaps between one saved answer and the next
// on that exercise. Gaps over MAX_GAP_S are a break or another day, not pace.
// Someone who has answered every question on the exercise is never stuck on it.
//
// Honest by construction: nothing is flagged on an exercise until at least
// MIN_PEOPLE people have saved two answers on it.
const MIN_PEOPLE = 3;          // people the median is taken from
const MAX_GAP_S = 2 * 60 * 60; // longer than this between saves is not pace
const FLOOR_S = 10 * 60;       // never "stuck" under 10 minutes
const FACTOR = 2;              // …and at least twice the usual

const ts = iso => (iso ? new Date(iso).getTime() : NaN);

export function useStuckRadar({ cursors, participants, isOnline, answers, blocks, enabled = true }) {
  return useMemo(() => {
    if (!enabled) return { stuck: [], groups: [], typical: {} };
    const active = (participants || []).filter(p => !p.deactivated_at);

    const questionsBySection = {};   // sectionId -> fillable blocks
    for (const b of blocks || []) {
      if (isFillableBlock(b)) (questionsBySection[b.section_id] ||= []).push(b);
    }

    // Save times per person per exercise, oldest first.
    const savesOf = (pid, sec) => (questionsBySection[sec] || [])
      .map(b => ts(answers?.[pid]?.[b.id]?.updated_at))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    // Usual gap between saves, per exercise: each person's own median gap,
    // then the median across people, so one fast typist doesn't set the pace.
    const typical = {};
    for (const sec of Object.keys(questionsBySection)) {
      const perPerson = [];
      for (const p of active) {
        const s = savesOf(p.id, sec);
        const gaps = [];
        for (let i = 1; i < s.length; i++) {
          const g = (s[i] - s[i - 1]) / 1000;
          if (g <= MAX_GAP_S) gaps.push(g);
        }
        if (gaps.length) perPerson.push(median(gaps));
      }
      if (perPerson.length >= MIN_PEOPLE) typical[sec] = median(perPerson);
    }

    const stuck = [];
    for (const p of active) {
      const c = cursors?.[p.id];
      const sec = c?.section_id;
      if (!sec || !isOnline(p.id)) continue;
      const usual = typical[sec];
      if (!usual) continue;
      const qs = questionsBySection[sec] || [];
      if (qs.every(b => isAnswered(b, answers?.[p.id]?.[b.id]?.value))) continue;
      const arrived = ts(c.on_since || c.moved_at);
      const seen = ts(c.last_seen);
      if (!Number.isFinite(arrived) || !Number.isFinite(seen)) continue;
      const saves = savesOf(p.id, sec);
      const from = Math.max(arrived, saves.length ? saves[saves.length - 1] : -Infinity);
      const idle = Math.max(0, (seen - from) / 1000);
      if (idle >= Math.max(FACTOR * usual, FLOOR_S)) {
        stuck.push({
          id: p.id,
          name: p.full_name || '(unnamed)',
          sectionId: sec,
          sectionTitle: c.section_title || 'this exercise',
          minutes: Math.round(idle / 60),
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
  }, [enabled, participants, cursors, isOnline, answers, blocks]);
}
