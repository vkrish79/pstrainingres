// Turning a marked assessment into a report.
//
// Everything here is PURE. It reads the same blocks, keys, answers and marks
// the trainer's marking screen reads, and it reaches the same verdicts by
// calling the same functions — earnedFor, manualResultFor, pointsFor,
// scoreBlocks, resultOf from assessmentScoring.js, and buildQuestions from
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
//
// TWO SITTINGS, ONE ROW. A re-sit is a separate session with its own paper, so
// its marks arrive through `resits` rather than through `marks`. It is never a
// second row: the person sat the same course once, and a second row would
// double-count them in every tally on the sheet.

import {
  earnedFor, manualResultFor, pointsFor, scoreBlocks, isInactiveBlock, resultOf,
} from './assessmentScoring.js';
import { buildQuestions } from './assessmentStructure.js';
import { labelOf, isFillableBlock } from './blockHelpers.js';
import { areasOfError } from './markingCriteria.js';

// The sentinel domain the enrolment function synthesizes usernames into —
// `${username}@${join_code}.pstrainingres.local`. It is not a real address and
// must never be printed as one: on a report "ahassan" is the staff member's
// identifier and the rest is plumbing.
const SENTINEL_DOMAIN = 'pstrainingres.local';

export function usernameOf(participant) {
  // A closed session's saved summary carries the username itself — the
  // account, and so the email, was deleted at close.
  if (participant?.username) return participant.username;
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

// Is this the same question, or has its given information been changed?
//
// An amendment is an ordinary edit to the question's `config` — a new date, a
// different passenger count — made on the re-sit's copy. The answer and the key
// are never touched, so comparing the two configs is the whole test. It is done
// on a STABLE serialisation because an edit through the builder rewrites the
// object, and key order alone must not read as a change.
function stableJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  return '{' + Object.keys(v).sort()
    .map(k => JSON.stringify(k) + ':' + stableJson(v[k]))
    .join(',') + '}';
}

// Every question's verdict for one participant, keyed by block id.
//
// Split out of buildParticipantReport because a RE-SIT needs exactly this, for
// a different paper, and the two sittings have to be judged the same way. A
// second loop reaching its own verdicts is the thing the note at the top of
// this file forbids.
export function questionResults({
  blocks, answersForP, answerKey, answerPoints, answerModes, marksForP, labelByBlockId, guidance = null,
}) {
  const marks = marksForP || {};
  const answersOf = answersForP || {};
  const out = new Map();

  for (const block of blocks) {
    if (!isFillableBlock(block)) continue;
    const points = pointsFor(block.id, answerPoints);
    const isManual = answerModes?.[block.id] === 'manual';
    const key = answerKey ? answerKey[block.id] : null;
    const value = answersOf[block.id]?.value;

    // Exactly the reasoning BlockAnswer uses, so a row here and a row there
    // never disagree.
    const blockGuidance = isManual ? (guidance?.[block.id] || null) : null;

    const result = isManual
      ? manualResultFor(block.id, points, marks, blockGuidance)
      : key != null
        ? earnedFor(block, key, value, points)
        : null;
    if (!result) continue; // unmarked question type — not scored, so not an error

    // A question marked criterion by criterion reports the criteria that fell
    // short, in the order they are written on the scorecard. That IS the
    // question's comment: the reasons were written against individual criteria
    // while marking, and gathering them here is what turns them into one
    // explanation the participant can read. Criteria that earned full marks are
    // left out — any note on those was for the next instructor, not a fault.
    const criteria = blockGuidance
      ? areasOfError(blockGuidance, marks[block.id]?.breakdown)
      : [];

    out.set(block.id, {
      blockId: block.id,
      // The pointer to the master question, and the ONLY thing a re-sit's paper
      // shares with the paper it was copied from. Null on a question swapped in
      // from the bank, which is how "a different question" is detected rather
      // than guessed.
      templateBlockId: block.template_block_id || null,
      config: block.config ?? null,
      label: labelByBlockId?.[block.id] || '',
      title: labelOf(block),
      state: result.state,
      earned: Math.round((result.earned || 0) * 10) / 10,
      // Unrounded, and used ONLY for the "did this lose marks?" test. Rounding
      // first would quietly turn 4.96 out of 5 into full marks.
      earnedRaw: result.earned || 0,
      possible: points,
      manual: isManual,
      criteria,
      // A criteria question has no question-level comment box, so there is
      // nothing to print from it; the criteria above carry the reasons.
      comment: criteria.length ? '' : (marks[block.id]?.comment || ''),
      markedBy: marks[block.id]?.marked_by_name || '',
      answerText: answerTextOf(block, value),
    });
  }

  return out;
}

// How a re-sit question relates to the one it stands in for.
//
//   same      it pairs, and the given information is identical
//   amended   it pairs — the same master question — but a value was changed
//   replaced  it does not pair: a question drawn from the bank, which has no
//             master and therefore nothing to compare against
function pairingFor(resitRow, firstByTemplate) {
  if (!resitRow.templateBlockId) return { pairing: 'replaced', first: null };
  const first = firstByTemplate.get(resitRow.templateBlockId) || null;
  if (!first) return { pairing: 'replaced', first: null };
  const pairing = stableJson(first.config) === stableJson(resitRow.config) ? 'same' : 'amended';
  return {
    pairing,
    first: { earned: first.earned, possible: first.possible, state: first.state, label: first.label },
  };
}

// One participant's report.
//
// Returns { participant, username, score, record, verdict, resit, resitDue,
//           errors[], unmarked[] } where
//   score    — THIS session's sitting, always, so a first attempt is still
//              readable after it has been superseded
//   record   — the result of record: the re-sit when there is a marked one,
//              otherwise this sitting. Every tally and every verdict is built
//              from this and not from `score`
//   errors   — questions that lost marks, on the paper `record` came from
//   unmarked — questions on that same paper still awaiting judgement
export function buildParticipantReport({
  participant, blocks, answers, answerKey, answerPoints, answerModes, marksForP, labelByBlockId,
  guidance = null, resit = null, passMark = null,
}) {
  const answersForP = answers?.[participant.id] || {};
  const marks = marksForP || {};

  const rows = questionResults({
    blocks, answersForP, answerKey, answerPoints, answerModes, marksForP: marks, labelByBlockId, guidance,
  });

  const score = scoreBlocks(blocks, answerKey || {}, answersForP, answerPoints, answerModes, marks, guidance);

  // A RE-SIT NOBODY HAS MARKED YET IS NOT A SCORE OF ZERO. Until somebody marks
  // it, the only real figure this person has is their first attempt, and
  // substituting an empty paper would supersede a genuine result with a nought,
  // drag the cohort average down with it, and turn a pass into a fail.
  const superseded = !!resit && resit.marked;

  // WHICH SITTING THE FEEDBACK DESCRIBES. When the re-sit is the result of
  // record, the areas of error have to come from the paper that produced it —
  // printing the first sitting's mistakes beside the second sitting's score
  // would describe a paper nobody is being judged on.
  const sourceRows = superseded ? resit.rows : rows;

  // The first sitting, reachable by master question, which is the only join
  // the two papers have.
  const firstByTemplate = new Map();
  for (const row of rows.values()) {
    if (row.templateBlockId) firstByTemplate.set(row.templateBlockId, row);
  }

  const errors = [];
  const unmarked = [];
  for (const row of sourceRows.values()) {
    const out = superseded ? { ...row, ...pairingFor(row, firstByTemplate) } : row;
    if (row.state === 'unmarked') unmarked.push(out);
    else if (row.earnedRaw < row.possible) errors.push(out);
  }

  const record = superseded
    ? {
      earned: resit.earned, possible: resit.possible, pct: resit.pct,
      unmarked: resit.unmarked, source: 'resit',
    }
    : {
      earned: score.earned, possible: score.possible, pct: score.pct,
      unmarked: score.unmarked, source: 'first',
    };

  const verdict = resultOf(record, passMark, record.unmarked);

  return {
    participant,
    username: usernameOf(participant),
    score,
    record,
    verdict,
    resit,
    // Below the pass mark with no re-sit pointing back at this row. Derived,
    // never stored — the moment a re-sit is arranged the chip has to disappear
    // on its own, and a stored flag is one somebody has to remember to clear.
    resitDue: verdict === 'FAIL' && !resit,
    errors,
    unmarked,
  };
}

// The whole cohort, in the same name order the roster uses everywhere else.
//
// `resits` — Map of participant id IN THIS SESSION to their re-sit, from
// useSessionResits. Optional, and deliberately absent wherever a re-sit cannot
// apply (a closed session's recorded scores). With no map, every row's result
// of record is simply its own sitting, which is what this function did before
// re-sits existed.
//
// `passMark` — needed here, not only in the view, because "re-sit due" is the
// answer to "did this person fail and has nobody arranged anything?" and that
// question cannot be asked without the threshold.
export function buildCohortReport({
  participants, sections, blocks, answers, answerKey, answerPoints, answerModes, marks,
  guidance = null, resits = null, passMark = null,
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
      guidance,
      resit: resits?.get?.(p.id) || null,
      passMark,
    }))
    .sort((a, b) => (a.participant.full_name || '').localeCompare(b.participant.full_name || ''));

  // Which questions the cohort as a whole struggled with. The trainer's own
  // use for this is deciding what to go over in the debrief, so it is ordered
  // by how many people got it wrong rather than by question number.
  //
  // Keyed by MASTER question, not by block: a re-sitter's copy of a question is
  // a different row with a different id, and counting it separately would list
  // the same question twice with its tally split between the two.
  const byQuestion = new Map();
  for (const r of reports) {
    for (const e of r.errors) {
      const k = e.templateBlockId || e.blockId;
      const cur = byQuestion.get(k)
        || { blockId: e.blockId, label: e.label, title: e.title, count: 0, possible: e.possible };
      cur.count += 1;
      byQuestion.set(k, cur);
    }
  }
  const commonErrors = [...byQuestion.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const totalUnmarked = reports.reduce((n, r) => n + r.unmarked.length, 0);
  // Built from the result of record, so a re-sitter counts once, at the mark
  // that now stands.
  const scored = reports.filter(r => r.record.possible > 0);
  const avgPct = scored.length
    ? Math.round(scored.reduce((n, r) => n + (r.record.pct || 0), 0) / scored.length)
    : null;

  return {
    reports,
    commonErrors,
    totalUnmarked,
    avgPct,
    resatCount: reports.filter(r => r.resit).length,
    resitDueCount: reports.filter(r => r.resitDue).length,
    questionCount: ordered.filter(isFillableBlock).length,
  };
}
