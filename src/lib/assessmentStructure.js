// A question is an assessment_section. Its parts are the fillable blocks inside
// it; prose blocks inside it are narration.
//
// This replaces the old flat reading, where every fillable block in the whole
// assessment silently took the next number and prose was skipped entirely
// (`questionNumbers` in blockHelpers.js — still used by workbooks' shared
// views, still correct there).
//
// THREE RULES THAT ARE DECISIONS, NOT DERIVATIONS:
//
// 1. EVERY QUESTION CONSUMES A POSITION, whatever it is called. Rename question
//    3 to "Scenario A" and question 4 is still question 4 — the paper has five
//    questions, one of which has a name instead of a number. This is the
//    opposite of `renumberExercisesIn`, where a descriptively-titled exercise
//    does NOT consume a number. Exercises are a mixed list by design; an exam
//    paper is a numbered sequence, and a gap in it reads as a mistake.
//
// 2. A ONE-PART QUESTION SHOWS NO LETTER. "Question 4", not "Question 4(a)".
//    Letters appear only once there is something to tell apart.
//
// 3. NARRATION IS PROSE THAT PRECEDES A PART. When splitting a flat assessment,
//    prose attaches to the question BELOW it, because that is how a scenario
//    reads on a page — the stem comes first, then what it asks.
import { isFillableBlock } from './blockHelpers.js';

// "Question 12", "Q12", "question1" — an auto-generated question heading.
// Anything else is a title the author wrote, shown verbatim and never
// renumbered.
const AUTO_QUESTION_RE = /^\s*(?:question|q)\s*\d+\s*$/i;

// The name the old flat editor gave its single hidden backing section. Nobody
// chose it, so it must NOT count as an author's heading — otherwise every
// assessment written before the question model opens showing "Questions"
// with a "custom number" badge, which is both wrong and alarming.
const LEGACY_DEFAULT_RE = /^\s*questions?\s*$/i;

export function isAutoQuestionTitle(title) {
  const t = title || '';
  return AUTO_QUESTION_RE.test(t) || LEGACY_DEFAULT_RE.test(t);
}

// a, b, c … z, aa, ab. Sub-question letters; assessments never get near 26.
export function subLetter(index) {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

// Build the question view of an assessment.
//
// Returns { questions, labelByBlockId, questionOfBlockId }:
//   questions — [{ section, number, heading, isAuto, narration[], parts[], partCount }]
//     parts[] — [{ block, letter, label }]; letter is null on a one-part question
//   labelByBlockId — { [blockId]: '3' | '3(b)' } for every FILLABLE block, so the
//     editor, the paper and the marking view all say the same thing.
//   partLabelByBlockId — { [blockId]: '(b)' } for parts of MULTI-part questions
//     only. The editor shows this next to a block; on a one-part question it is
//     absent, because the question's own heading already says which it is.
//   questionOfBlockId — { [blockId]: sectionId }, narration blocks included.
export function buildQuestions(sections, blocks) {
  const ordered = [...(sections || [])].sort((a, b) => a.order_index - b.order_index);
  const questions = [];
  const labelByBlockId = {};
  const partLabelByBlockId = {};
  const questionOfBlockId = {};

  ordered.forEach((section, qi) => {
    const number = qi + 1;
    const isAuto = isAutoQuestionTitle(section.title);
    const own = (blocks || [])
      .filter(b => b.section_id === section.id)
      .sort((a, b) => a.order_index - b.order_index);

    const narration = [];
    const fillable = [];
    for (const b of own) {
      questionOfBlockId[b.id] = section.id;
      (isFillableBlock(b) ? fillable : narration).push(b);
    }

    const multi = fillable.length > 1;
    const parts = fillable.map((block, pi) => {
      const letter = multi ? subLetter(pi) : null;
      const label = letter ? `${number}(${letter})` : String(number);
      labelByBlockId[block.id] = label;
      if (letter) partLabelByBlockId[block.id] = `(${letter})`;
      return { block, letter, label };
    });

    questions.push({
      section,
      number,
      // What to show as the question's heading. An auto title is regenerated
      // from position so it is right even before a renumber has been run.
      heading: isAuto || !section.title?.trim() ? `Question ${number}` : section.title,
      isAuto,
      // Everything inside, in document order — what the editor renders. The
      // narration/parts split above is the same blocks, grouped by role.
      blocks: own,
      narration,
      parts,
      partCount: parts.length,
    });
  });

  return { questions, labelByBlockId, partLabelByBlockId, questionOfBlockId };
}

// Plan the split of a flat assessment into one question per part.
//
// Pure. Used for the organiser's "one question per part" preset — it proposes
// a grouping, it never writes one.
//
// Each fillable block becomes a question, carrying any prose that immediately
// precedes it as its narration (rule 3 above). Trailing prose with no part
// after it joins the previous question rather than becoming an empty question.
export function planQuestionSplit(sections, blocks) {
  const ordered = [...(sections || [])].sort((a, b) => a.order_index - b.order_index);
  const planned = [];
  const droppedTitles = [];
  let pendingProse = [];

  for (const section of ordered) {
    const own = (blocks || [])
      .filter(b => b.section_id === section.id)
      .sort((a, b) => a.order_index - b.order_index);
    // Only an author's heading is worth warning about losing. An auto number
    // and the legacy "Questions" default are both regenerated, not lost.
    if (own.length && section.title?.trim() && !isAutoQuestionTitle(section.title)) {
      droppedTitles.push(section.title.trim());
    }

    for (const b of own) {
      if (isFillableBlock(b)) {
        planned.push({ blocks: [...pendingProse, b], partBlockId: b.id });
        pendingProse = [];
      } else {
        pendingProse.push(b);
      }
    }
  }

  // Prose with no part after it belongs to the last question, not to one of
  // its own — a question with nothing to answer is not a question.
  if (pendingProse.length) {
    if (planned.length) planned[planned.length - 1].blocks.push(...pendingProse);
    else planned.push({ blocks: [...pendingProse], partBlockId: null });
  }

  return {
    questions: planned.map((q, i) => ({ ...q, title: `Question ${i + 1}` })),
    droppedTitles,
    // Already one question per section with exactly one part each — nothing to do.
    alreadySplit: planned.length === ordered.length
      && ordered.every(s => (blocks || []).filter(b => b.section_id === s.id && isFillableBlock(b)).length <= 1),
  };
}

// ── Grouping, for the organiser UI ──────────────────────────────────────────
//
// The organiser works on ONE flat list of blocks in document order plus a set
// of "this block starts a new question" boundaries. That is the whole model:
// every grouping is expressible as boundaries, so merge, split and the presets
// are all the same operation with a different set.

// Every block in the assessment, in document order.
export function orderedBlocksOf(sections, blocks) {
  return [...(sections || [])]
    .sort((a, b) => a.order_index - b.order_index)
    .flatMap(sec =>
      (blocks || [])
        .filter(b => b.section_id === sec.id)
        .sort((a, b) => a.order_index - b.order_index)
    );
}

// Boundaries matching how the assessment is grouped RIGHT NOW — the organiser's
// starting point, so opening it and pressing Apply changes nothing.
export function currentBoundaries(sections, blocks) {
  const ordered = [...(sections || [])].sort((a, b) => a.order_index - b.order_index);
  const out = new Set();
  for (const sec of ordered) {
    const first = (blocks || [])
      .filter(b => b.section_id === sec.id)
      .sort((a, b) => a.order_index - b.order_index)[0];
    if (first) out.add(first.id);
  }
  return out;
}

// Preset: one question per answerable part, prose attaching to the part below.
export function oneQuestionPerPartBoundaries(sections, blocks) {
  const plan = planQuestionSplit(sections, blocks);
  return new Set(plan.questions.map(q => q.blocks[0]?.id).filter(Boolean));
}

// Turn boundaries into the groups `applyQuestionGrouping` writes. The first
// block always starts a question whether or not it is marked, so a grouping can
// never begin with orphaned blocks.
export function groupsFromBoundaries(orderedBlocks, boundaries, titleFor = null) {
  const groups = [];
  orderedBlocks.forEach((b, i) => {
    if (i === 0 || boundaries.has(b.id)) groups.push({ blockIds: [], firstBlockId: b.id });
    groups[groups.length - 1].blockIds.push(b.id);
  });
  return groups.map((g, i) => ({
    ...g,
    title: titleFor?.(g, i) ?? `Question ${i + 1}`,
  }));
}

// ── No writes here ─────────────────────────────────────────────────────────
//
// Everything above is pure. Applying a grouping is the assessment editor's
// draft-save job (hooks/useAssessmentDraft.js), which reuses existing question
// rows rather than replacing them — this file used to create-move-delete, which
// meant four un-transacted stages and a cascade delete standing behind every
// failure. One write path, in one place.

// THERE IS DELIBERATELY NO renumberQuestions() EITHER.
//
// An auto question's displayed number is DERIVED from its position by
// buildQuestions above, on every render. It cannot go stale, so there is
// nothing for a renumber to fix — move a question and it renumbers itself, and
// a question imported from another assessment adopts its new position rather
// than carrying the old number across.
//
// A heading the author wrote is shown verbatim and never touched. What a stored
// "Question 2" says on a question now sitting fifth is simply ignored, which is
// why the rename box is seeded from the displayed heading rather than the row.
//
// Workbooks keep renumberExercisesIn() because an exercise's title IS its
// identity there — descriptive, author-owned, and not positional.
