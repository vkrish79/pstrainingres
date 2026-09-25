// What kind of question is this, in words — for browsing a question bank.
//
// This is a DESCRIPTOR, not a new source of truth. The type is already carried by
// assessment_blocks.block_type plus config.input_type for the `field` flavours;
// all this does is give each combination a name and a glyph so a bank can be
// filtered and skimmed. Nothing here decides behaviour, so it cannot drift out of
// step with how a question is rendered or scored.
//
// It is deliberately read-only and additive. The app has eight separate
// hand-maintained lists of block types already (the add menu, the authoring
// dispatch, the render switch, the key dispatch, two in blockHelpers, two in
// assessmentScoring, plus the SQL CHECK); consolidating those is a real piece of
// work and is not smuggled in here.

import { isFillableBlock } from './blockHelpers.js';
import { isPnrQuestion } from './pnrQuestion.js';

// Order matters: this is the order the filter chips appear in, commonest first.
export const QUESTION_TYPES = [
  { key: 'choice',      label: 'Multiple choice', glyph: '◉' },
  { key: 'check_group', label: 'Multi-select',    glyph: '☑' },
  { key: 'short_text',  label: 'Short answer',    glyph: '▭' },
  { key: 'written',     label: 'Written answer',  glyph: '¶' },
  { key: 'pnr',         label: 'PNR build/change', glyph: '✈' },
  { key: 'table',       label: 'Table',           glyph: '▦' },
  { key: 'fill_blank',  label: 'Fill in the blank', glyph: '⌷' },
  { key: 'card_sort',   label: 'Card sort',       glyph: '⊞' },
  { key: 'match_pairs', label: 'Matching',        glyph: '⇄' },
  { key: 'reorder',     label: 'Reorder',         glyph: '↕' },
];

const BY_KEY = new Map(QUESTION_TYPES.map(t => [t.key, t]));

export function typeLabel(key) {
  return BY_KEY.get(key)?.label || key;
}

export function typeGlyph(key) {
  return BY_KEY.get(key)?.glyph || '•';
}

// One block's type key, or null if the block is not a question at all (prose is
// narration). PNR is checked FIRST because it is a long-text field wearing a
// scenario — a pseudo-type derived from config, not a block_type value, so the
// ordinary long_text branch would otherwise claim it.
export function blockTypeKey(block) {
  if (!isFillableBlock(block)) return null;
  if (isPnrQuestion(block)) return 'pnr';
  if (block.block_type === 'field') {
    const t = block.config?.input_type;
    if (t === 'long_text') return 'written';
    if (t === 'choice' || t === 'check_group' || t === 'short_text') return t;
    return 'short_text';
  }
  return block.block_type;
}

// A question is a section holding several blocks, so it can legitimately be more
// than one type — a scenario in prose, a multiple choice, then a written answer.
// Returns the distinct type keys in the order they appear on the page.
export function questionTypeKeys(blocks) {
  const seen = [];
  for (const b of blocks || []) {
    const k = blockTypeKey(b);
    if (k && !seen.includes(k)) seen.push(k);
  }
  return seen;
}
