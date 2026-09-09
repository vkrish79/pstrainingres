// Turning a marked assessment into a report.
//
// Everything here is PURE. It reads the same blocks, keys, answers and marks
// the trainer's marking screen reads, and it reaches the same verdicts by
// calling the same functions — earnedFor, manualResultFor, pointsFor,
// scoreBlocks from assessmentScoring.js, and buildQuestions from
// assessmentStructure.js for the labels.
//
// THAT REUSE IS THE POINT, not an economy. A report that recomputed marks its
// own way would eventually disagree with the screen the trainer just marked
// on, and the trainer would have no way to tell which number was the real one.
// So there is no scoring logic in this file at all: only selection, grouping
// and ordering.
//
// WHAT COUNTS AS AN ERROR
// Every question that did not earn full marks — auto-marked wrong or partial,
// and manual questions awarded less than the total. A question nobody has
// judged yet is NOT an error; it is unfinished business, counted separately
// and reported as such, because printing "0/5" against a question the trainer
// simply has not reached yet would libel the participant.
//
// WITHDRAWN QUESTIONS ARE OUT, and the caller must filter them before calling
// in — the same isInactiveBlock filter the marking view applies. A report whose
// totals disagreed with the screen would be worse than no report.

import { earnedFor, manualResultFor, pointsFor, scoreBlocks, isInactiveBlock } from './assessmentScoring.js';
import { buildQuestions } from './assessmentStructure.js';
import { labelOf, isFillableBlock } from './blockHelpers.js';

// The sentinel domain the enrolment function synthesizes usernames into —
// `${username}@${join_code}.pstrainingres.local`. It is not a real address and
// must never be printed as one: on a report "ahassan" is the staff member's
// identifier and the rest is plumbing.
const SENTINEL_DOMAIN = 'pstrainingres.local';

export function usernameOf(participant) {
  const email = participant?.email || '';
  if (!email) return '';
  if (email.endsWith(SENTINEL_DOMAIN)) return email.split('@')[0];
  return email; // a real address was supplied at enrolment — show it as given
}

// How a participant's answer should read on paper.
//
// Deliberately plain text and deliberately lossy: a report is a printed
// document, so an interactive block's arrangement is summarised rather than
// redrawn. The question label and the trainer's comment carry the meaning.
export function answerTextOf(block, value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.filter(v => v != null && String(v).trim() !== '').join(', ');
  if (typeof value === 'object') {
    // Table answers are { [cellId]: text }; interactive blocks are their own
    // shapes. Both read acceptably as "label: value" pairs.
    const parts = Object.values(value)
      .filter(v => v != null && typeof v !== 'object' && String(v).trim() !== '')
      .map(v => String(v).trim());
    return parts.join(', ');
  }
  return String(value).trim();
}

// One participant's report.
//
// Returns { participant, username, score, errors[], unmarked[] } where
//   score    — the scoreBlocks total, so the figure matches the tile exactly
//   errors   — questions that lost marks, in paper order
//   unmarked — manual questions still awaiting judgement, in paper order
export function buildParticipantReport({
  participant, blocks, answers, answerKey, answerPoints, answerModes, marksForP, labelByBlockId,
}) {
  const answersForP = answers?.[participant.id] || {};
  const marks = marksForP || {};

  const errors = [];
  const unmarked = [];

  for (const block of blocks) {
    if (!isFillableBlock(block)) continue;
    const points = pointsFor(block.id, answerPoints);
    const isManual = answerModes?.[block.id] === 'manual';
    const key = answerKey ? answerKey[block.id] : null;
    const value = answersForP[block.id]?.value;

    // Exactly the reasoning BlockAnswer uses, so a row here and a row there
    // never disagree.
    const result = isManual
      ? manualResultFor(block.id, points, marks)
      : key != null
        ? earnedFor(block, key, value, points)
        : null;
    if (!result) continue; // unmarked question type — not scored, so not an error

    const row = {
      blockId: block.id,
      label: labelByBlockId?.[block.id] || '',
      title: labelOf(block),
      state: result.state,
      earned: Math.round((result.earned || 0) * 10) / 10,
      possible: points,
      manual: isManual,
      comment: marks[block.id]?.comment || '',
      markedBy: marks[block.id]?.marked_by_name || '',
      answerText: answerTextOf(block, value),
    };

    if (result.state === 'unmarked') unmarked.push(row);
    else if ((result.earned || 0) < points) errors.push(row);
  }

  return {
    participant,
    username: usernameOf(participant),
    score: scoreBlocks(blocks, answerKey || {}, answersForP, answerPoints, answerModes, marks),
    errors,
    unmarked,
  };
}

// The whole cohort, in the same name order the roster uses everywhere else.
export function buildCohortReport({
  participants, sections, blocks, answers, answerKey, answerPoints, answerModes, marks,
}) {
  // Withdrawn questions are out of the paper entirely — filter before labels
  // are built, so numbering matches the paper the participants actually sat.
  const liveBlocks = (blocks || []).filter(b => !isInactiveBlock(b));
  const { labelByBlockId } = buildQuestions(sections || [], liveBlocks);

  // Paper order: section by section, block by block within each.
  const ordered = [...(sections || [])]
    .sort((a, b) => a.order_index - b.order_index)
    .flatMap(sec => liveBlocks
      .filter(b => b.section_id === sec.id)
      .sort((a, b) => a.order_index - b.order_index));

  const reports = (participants || [])
    .map(p => buildParticipantReport({
      participant: p,
      blocks: ordered,
      answers,
      answerKey,
      answerPoints,
      answerModes,
      marksForP: marks?.[p.id] || {},
      labelByBlockId,
    }))
    .sort((a, b) => (a.participant.full_name || '').localeCompare(b.participant.full_name || ''));

  // Which questions the cohort as a whole struggled with. The trainer's own
  // use for this is deciding what to go over in the debrief, so it is ordered
  // by how many people got it wrong rather than by question number.
  const byQuestion = new Map();
  for (const r of reports) {
    for (const e of r.errors) {
      const cur = byQuestion.get(e.blockId)
        || { blockId: e.blockId, label: e.label, title: e.title, count: 0, possible: e.possible };
      cur.count += 1;
      byQuestion.set(e.blockId, cur);
    }
  }
  const commonErrors = [...byQuestion.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const totalUnmarked = reports.reduce((n, r) => n + r.unmarked.length, 0);
  const scored = reports.filter(r => r.score.possible > 0);
  const avgPct = scored.length
    ? Math.round(scored.reduce((n, r) => n + (r.score.pct || 0), 0) / scored.length)
    : null;

  return { reports, commonErrors, totalUnmarked, avgPct, questionCount: ordered.filter(isFillableBlock).length };
}
