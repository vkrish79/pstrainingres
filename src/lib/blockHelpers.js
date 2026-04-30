// Shared logic for "is this block fillable / has it been answered".

export function isFillableBlock(block) {
  if (!block) return false;
  if (block.block_type === 'field') return true;
  if (block.block_type === 'table') {
    return (block.config?.rows || []).some(row =>
      row.some(cell => cell?.kind === 'input')
    );
  }
  return false;
}

export function isAnswered(block, value) {
  if (value == null) return false;
  if (block.block_type === 'field') {
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === 'string' && value.trim() !== '';
  }
  if (block.block_type === 'table') {
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value).some(v =>
      Array.isArray(v) ? v.length > 0 : (v != null && String(v).trim() !== '')
    );
  }
  return false;
}

export function countFillable(blocks) {
  return blocks.filter(isFillableBlock).length;
}

export function labelOf(block) {
  if (!block) return '';
  if (block.block_type === 'field') return block.config?.label || '(unlabeled field)';
  if (block.block_type === 'table') {
    return block.config?.caption || `Table (${(block.config?.rows || []).length} rows)`;
  }
  if (block.block_type === 'prose') {
    const text = (block.config?.html || '').replace(/<[^>]+>/g, '').trim();
    return text.slice(0, 60) || '(empty prose)';
  }
  return block.block_type;
}

// For a table block, enumerate every input cell with a best-effort label
// (the nearest preceding static cell in the row, falling back to the column
// header, then a generic "Row R Col C"). Used by aggregate views & CSV export.
export function inputCellsOf(block) {
  if (block?.block_type !== 'table') return [];
  const rows = block.config?.rows || [];
  const headers = block.config?.headers || [];
  const out = [];
  rows.forEach((row, ri) => {
    let lastStatic = null;
    row.forEach((cell, ci) => {
      if (!cell) return;
      if (cell.kind === 'static') {
        const t = (cell.text || '').trim();
        if (t) lastStatic = t;
      } else if (cell.kind === 'input') {
        const header = (headers[ci] || '').trim();
        const label = lastStatic || header || `Row ${ri + 1} Col ${ci + 1}`;
        out.push({ id: cell.id, input_type: cell.input_type, label });
      }
    });
  });
  return out;
}
