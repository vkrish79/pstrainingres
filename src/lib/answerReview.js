// Going over answers with the class — shared helpers for the trainer's board
// and the participant's marks. The grouping itself happens in the database
// (review_board / review_my_marks); nothing here normalises answer text, so
// the two sides can never disagree about what counts as the same answer.
import { boxesOf, boxLabel } from './tableCells.js';

// Blocks that hold answers the review compares. Matches review_compute's
// block_type filter.
export function isReviewable(block) {
  return block?.block_type === 'table' || block?.block_type === 'field';
}

// Slot key shared with the SQL: a table cell or box by its id, a field by ''.
export const slotKey = (blockId, slot) => `${blockId}|${slot || ''}`;

export function indexCells(cells = []) {
  const map = new Map();
  for (const c of cells) map.set(slotKey(c.block_id, c.slot), c);
  return map;
}

// Every answer slot in a block, in reading order, with a short label.
export function slotsOfBlock(block) {
  if (block.block_type === 'field') {
    return [{ slot: '', label: block.config?.label || 'Answer' }];
  }
  const rows = block.config?.rows || [];
  const headers = block.config?.headers || [];
  const out = [];
  rows.forEach((row, ri) => row.forEach((cell, ci) => {
    const rowLabel = row.find(c => c?.kind === 'static' && (c.text || '').trim())?.text?.trim();
    const colLabel = headers[ci] || rows[0]?.[ci]?.text;
    const place = [rowLabel, ri > 0 ? colLabel : null].filter(Boolean).join(' · ');
    if (cell?.kind === 'input') out.push({ slot: cell.id, label: place || `Row ${ri + 1}, column ${ci + 1}` });
    if (cell?.kind === 'mixed') boxesOf(cell).forEach((b, bi) => out.push({ slot: b.id, label: boxLabel(cell, bi, place || 'Answer') }));
  }));
  return out;
}

const plain = html => (html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Tabs for the board: each heading-like prose block starts a tab holding the
// answer blocks after it ("Itinerary details", "Pricing 1"). Answer blocks
// before any heading fall into the first tab. Tabs without answers are dropped.
export function buildTabs(blocks) {
  const tabs = [];
  let current = null;
  let n = 0;
  for (const b of blocks) {
    if (b.block_type === 'prose') {
      const html = b.config?.html || '';
      const text = plain(html);
      // Imported workbooks mark a part's heading as a paragraph that is bold
      // all the way through ("<p><strong>Pricing 1</strong></p>"). Instructions
      // are only partly bold ("Use the <strong>Create PNR</strong> option").
      const bold = plain((html.match(/<(strong|b)>[\s\S]*?<\/\1>/g) || []).join(' '));
      if (text && text.length <= 60 && bold === text) {
        current = { key: b.id, title: text, blocks: [] };
        tabs.push(current);
      }
      continue;
    }
    if (!isReviewable(b)) continue;
    if (!current) {
      current = { key: `start-${b.id}`, title: '', blocks: [] };
      tabs.push(current);
    }
    current.blocks.push(b);
  }
  return tabs
    .filter(t => t.blocks.some(b => slotsOfBlock(b).length > 0))
    .map(t => ({ ...t, title: t.title || `Part ${(n += 1)}` }));
}

// How the class did on a cell, for its colour.
export function cellTone(cell) {
  if (!cell || cell.answered === 0) return 'empty';
  if (cell.personal) return 'own';
  if (!cell.accepted?.length) return 'unset';
  const share = cell.right_count / cell.answered;
  if (share >= 0.8) return 'good';
  if (share >= 0.5) return 'mixed';
  return 'poor';
}

// What the trainer's answer reads as on the board: the practice copy, else the
// biggest group they ticked.
export function trainerAnswerOf(cell) {
  if (!cell) return null;
  if (cell.model) return cell.model;
  const right = (cell.groups || []).filter(g => g.right).sort((a, b) => b.n - a.n)[0];
  return right?.sample || null;
}

// The biggest wrong group, for the "3 wrote Y" hint under a cell.
export function topWrongGroup(cell) {
  if (!cell?.accepted?.length) return null;
  return (cell.groups || []).filter(g => !g.right).sort((a, b) => b.n - a.n)[0] || null;
}
