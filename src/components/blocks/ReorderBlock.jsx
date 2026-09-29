import { presentationOrder } from '../../lib/interactiveBlocks.js';

// Reorder / sequencing: the participant arranges items into the correct order
// using ↑/↓ controls (the same idiom as block reordering in the editor — and
// the reliable touch-friendly choice). Value shape: [itemId, …] in the
// participant's order. The correct order lives in the answer key.
// `correct` — the key, [itemId, …] in the right order, drawn only by the
// super-trainer previews that pass it.
export default function ReorderBlock({ block, value, onChange, readOnly = false, correct = undefined }) {
  const cfg = block.config || {};
  const items = Array.isArray(cfg.items) ? cfg.items : [];
  const byId = Object.fromEntries(items.map((it) => [it.id, it]));
  // The key IS an order, so showing it means listing the items in it rather
  // than in the scramble — and the scramble is deliberately not the answer.
  const key = Array.isArray(correct) && correct.length ? correct.filter((id) => byId[id]) : null;

  // Resolve the current ordering: the saved value if present, otherwise a
  // deterministic scramble so the starting order isn't the answer. Any items
  // added after the participant last saved are appended.
  let orderedIds = key
    || (Array.isArray(value) && value.length
      ? value.filter((id) => byId[id])
      : presentationOrder(items, block.id).map((it) => it.id));
  for (const it of items) if (!orderedIds.includes(it.id)) orderedIds = [...orderedIds, it.id];

  function move(idx, dir) {
    const next = [...orderedIds];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  }

  return (
    <div className="wb-field wb-reorder">
      {cfg.prompt && <div className="wb-label">{cfg.prompt}</div>}
      <ol className={`reorder-list ${key ? 'answer' : ''}`}>
        {orderedIds.map((id, idx) => (
          <li key={id} className="reorder-item">
            <span className="reorder-rank">{idx + 1}</span>
            <span className="reorder-text">{byId[id]?.text || '(item)'}</span>
            {!readOnly && !key && (
              <span className="reorder-controls">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Move up"
                  disabled={idx === 0}
                  onClick={() => move(idx, -1)}
                >↑</button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Move down"
                  disabled={idx === orderedIds.length - 1}
                  onClick={() => move(idx, 1)}
                >↓</button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {key && <p className="wb-answer-note"><span aria-hidden="true">✓</span> Shown in the correct order.</p>}
    </div>
  );
}
