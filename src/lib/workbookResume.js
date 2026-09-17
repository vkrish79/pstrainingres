// Where a participant should pick up. Used by the workbook header's Continue.
//
// "Where they stopped" is the exercise holding their most recently saved
// answer. From there, the first question not yet complete — in that exercise
// or a later one. If everything after it is done, the earliest unfinished
// question anywhere (they skipped one). Null when every question is complete.
//
// Uses the same per-input completion as the sidebar and the trainer's pace
// (isComplete), so "Continue" never points at something already counted done.

import { isFillableBlock, isComplete, filledInputs } from './blockHelpers.js';

export function resumePoint(sections, blocks, answers, savedAt = {}) {
  const order = new Map((sections || []).map((s, i) => [s.id, i]));
  const fillable = (blocks || [])
    .filter(b => order.has(b.section_id) && isFillableBlock(b))
    .sort((a, b) => order.get(a.section_id) - order.get(b.section_id) || a.order_index - b.order_index);
  if (!fillable.length) return null;

  let lastBlock = null, lastAt = null;
  for (const b of fillable) {
    const t = savedAt[b.id];
    // A saved-but-empty answer (typed, then cleared) is not where they stopped.
    if (!filledInputs(b, answers?.[b.id])) continue;
    if (t && (!lastAt || t > lastAt)) { lastAt = t; lastBlock = b; }
  }

  const startIdx = lastBlock
    ? fillable.findIndex(b => b.section_id === lastBlock.section_id)
    : 0;
  const open = b => !isComplete(b, answers?.[b.id]);
  let target = fillable.slice(startIdx).find(open) || fillable.slice(0, startIdx).find(open);
  if (!target) return null;

  const section = sections.find(s => s.id === target.section_id);
  const inSection = fillable.filter(b => b.section_id === target.section_id);
  return {
    sectionId: target.section_id,
    sectionTitle: section?.title || '',
    blockId: target.id,
    questionNo: inSection.indexOf(target) + 1,
    questionCount: inSection.length,
    lastAt,
    started: !!lastBlock,
  };
}

// "today at 17:42", "yesterday at 09:10", "on 14 Sep at 11:05".
export function whenStopped(ts, now = new Date()) {
  if (!ts) return '';
  const d = new Date(ts);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const dayStart = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  return `on ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} at ${time}`;
}
