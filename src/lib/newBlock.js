import { parseFillBlank, newItemId } from './interactiveBlocks.js';
import { newPnrConfig } from './pnrQuestion.js';

// What a block added from the editor's add menu starts as: { blockType, config }.
// Moved out of ContentEditorScaffold, unchanged.
//
// `type` is the add-menu choice, which is not always a block_type.
export function newBlock(type) {
  // 'pnr' is a shorthand from the add menu, not a block_type. It expands into
  // the manual question the app already has — a long-text field — carrying the
  // ARDW scenario fields. Expanded here so there is one definition of what a
  // PNR question is, and so nothing downstream has to know the shorthand
  // existed: what gets created is an ordinary `field`.
  if (type === 'pnr') return { blockType: 'field', config: newPnrConfig() };

  // The four `field` flavours, expanded here so the add menu can offer them by
  // the name a marking scheme uses. The choice types arrive WITH options: an
  // empty options list renders as nothing at all in the preview, and
  // FieldForm strips blank ones on save, so seeding them is what makes the
  // question visible and editable straight away rather than after a detour
  // through the Input type dropdown.
  const FIELD_SHORTHANDS = {
    choice: {
      label: 'New question',
      input_type: 'choice',
      options: ['Option A', 'Option B', 'Option C'],
    },
    check_group: {
      label: 'New question — select all that apply',
      input_type: 'check_group',
      options: ['Option A', 'Option B', 'Option C'],
    },
    short_answer: { label: 'New question', input_type: 'short_text' },
    written: { label: 'New question', input_type: 'long_text' },
  };
  if (FIELD_SHORTHANDS[type]) return { blockType: 'field', config: FIELD_SHORTHANDS[type] };

  let config;
  if (type === 'prose') config = { html: '<p>New prose block</p>' };
  else if (type === 'field') config = { label: 'New field', input_type: 'short_text' };
  else if (type === 'table') config = {
    headers: ['Column 1', 'Column 2'],
    rows: [
      [{ kind: 'static', text: 'Row label' }, { kind: 'input', id: `c_${Date.now()}_1`, input_type: 'short_text' }],
    ],
  };
  else if (type === 'fill_blank') {
    const text = 'Type your sentence here with a {{}} to fill in.';
    const { parts, blanks } = parseFillBlank(text);
    config = { text, parts, blanks };
  }
  else if (type === 'card_sort') config = {
    prompt: 'Sort each card into the right category',
    cards: [{ id: newItemId('card'), text: 'Card 1' }, { id: newItemId('card'), text: 'Card 2' }],
    buckets: [{ id: newItemId('bkt'), label: 'Category A' }, { id: newItemId('bkt'), label: 'Category B' }],
  };
  else if (type === 'match_pairs') config = {
    prompt: 'Match each item on the left to the right',
    left: [{ id: newItemId('l'), text: 'Term 1' }, { id: newItemId('l'), text: 'Term 2' }],
    right: [{ id: newItemId('r'), text: 'Match 1' }, { id: newItemId('r'), text: 'Match 2' }],
  };
  else if (type === 'reorder') config = {
    prompt: 'Put these in the correct order',
    items: [{ id: newItemId(), text: 'First' }, { id: newItemId(), text: 'Second' }, { id: newItemId(), text: 'Third' }],
  };
  return { blockType: type, config };
}
