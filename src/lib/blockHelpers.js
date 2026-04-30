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
