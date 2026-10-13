// One participant's marks on one question, part by part — what the marking
// screens show while marking is still going on.
//
// scoreBlocks (assessmentScoring.js) answers "what is the score", and a part
// whose criteria are only half-judged counts as unmarked there, worth nothing.
// That is right for a report and wrong for someone in the middle of marking:
// six of nine criteria judged is real progress, and a question total that
// ignores it reads as a poor answer rather than an unfinished one.
//
// So this reports BOTH: `soFar` adds up everything judged so far (criteria
// included), and `complete` says whether it is final. Every screen that shows
// soFar while `complete` is false labels it "so far". Nothing here is stored,
// and nothing that decides a result (Report, close, re-sit list) reads it.
import { isFillableBlock } from './blockHelpers.js';
import {
  isInactiveBlock, isManualQuestion, isManuallyMarkable, isScorableBlock,
  pointsFor, scoreBlock, manualResultFor,
} from './assessmentScoring.js';
import { resolveMarking } from './markingCriteria.js';

const round1 = n => Math.round(n * 10) / 10;

// A part's verdict as a chip: 'full' | 'part' | 'none' | 'open'.
function chipOf(earned, possible) {
  if (earned >= possible) return 'full';
  return earned > 0 ? 'part' : 'none';
}

// blocks — the question's blocks (prose is skipped). Returns
//   { parts: [{ blockId, chip, earned, possible, auto, done, of }],
//     soFar, possible, left, complete }
// `left` counts parts still waiting for a person. A part with no way of being
// marked (auto with no correct answer) is not a part of the score at all, the
// same rule scoreBlocks applies, so it appears in neither list nor total.
export function questionTally(
  blocks, keyByBlockId, answersForP, pointsByBlockId, modeByBlockId, marksForP, guidanceByBlockId,
) {
  const parts = [];
  for (const b of blocks || []) {
    if (!isFillableBlock(b) || isInactiveBlock(b)) continue;
    const possible = pointsFor(b.id, pointsByBlockId);

    if (isManualQuestion(b.id, modeByBlockId)) {
      if (!isManuallyMarkable(b)) continue;
      const guidance = guidanceByBlockId?.[b.id] || null;
      const rec = marksForP?.[b.id];
      if (guidance?.criteria?.length) {
        const r = resolveMarking(guidance, rec?.breakdown || null);
        if (r.complete) {
          const final = manualResultFor(b.id, possible, marksForP, guidance);
          parts.push({ blockId: b.id, chip: chipOf(final.earned, possible), earned: final.earned, possible, auto: false });
        } else {
          parts.push({ blockId: b.id, chip: 'open', earned: r.total, possible, auto: false, done: r.markedCount, of: r.count });
        }
        continue;
      }
      const r = manualResultFor(b.id, possible, marksForP, null);
      parts.push(r.state === 'unmarked'
        ? { blockId: b.id, chip: 'open', earned: 0, possible, auto: false }
        : { blockId: b.id, chip: chipOf(r.earned, possible), earned: r.earned, possible, auto: false });
      continue;
    }

    const key = keyByBlockId?.[b.id];
    if (!isScorableBlock(b) || key == null) continue;
    const entry = answersForP?.[b.id];
    const value = entry && typeof entry === 'object' && 'value' in entry ? entry.value : entry;
    const r = scoreBlock(b, key, value);
    if (!r) continue;
    const earned = r.fraction * possible;
    parts.push({ blockId: b.id, chip: chipOf(earned, possible), earned, possible, auto: true });
  }

  const left = parts.filter(p => p.chip === 'open').length;
  return {
    parts,
    soFar: round1(parts.reduce((s, p) => s + p.earned, 0)),
    possible: round1(parts.reduce((s, p) => s + p.possible, 0)),
    left,
    complete: left === 0,
  };
}
