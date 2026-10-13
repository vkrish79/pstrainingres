// A correct answer, as a marker reads it: "25 Kgs", "Yes + No",
// "Collect fee → Change name → …". Shown beside a participant's answer on the
// marking screen so "what does right look like" never needs the Scorecard open.
// Key shapes are the ones assessmentScoring.js documents. Pure.
import { inputCellsOf } from './blockHelpers.js';

const asMap = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export function answerKeyText(block, key) {
  if (key == null || !block) return '';
  const c = block.config || {};
  switch (block.block_type) {
    case 'field':
      return Array.isArray(key) ? key.join(' + ') : String(key);
    case 'table': {
      const m = asMap(key);
      return inputCellsOf(block)
        .filter(cell => m[cell.id] != null && String(m[cell.id]).trim() !== '')
        .map(cell => `${cell.label}: ${m[cell.id]}`)
        .join(' · ');
    }
    case 'reorder': {
      const byId = Object.fromEntries((c.items || []).map(it => [it.id, it.text]));
      return (Array.isArray(key) ? key : []).map(id => byId[id] || '?').join(' → ');
    }
    case 'match_pairs': {
      const right = Object.fromEntries((c.right || []).map(r => [r.id, r.text]));
      const m = asMap(key);
      return (c.left || []).filter(l => m[l.id]).map(l => `${l.text} → ${right[m[l.id]] || '?'}`).join(' · ');
    }
    case 'card_sort': {
      const buckets = Object.fromEntries((c.buckets || []).map(b => [b.id, b.label]));
      const m = asMap(key);
      return (c.cards || []).filter(card => m[card.id]).map(card => `${card.text} → ${buckets[m[card.id]] || '?'}`).join(' · ');
    }
    case 'fill_blank': {
      const m = asMap(key);
      return (c.blanks || []).map((b, i) => (m[b.id] ? `Blank ${i + 1}: ${m[b.id]}` : null)).filter(Boolean).join(' · ');
    }
    default:
      return '';
  }
}
