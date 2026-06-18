// Match pairs: pair each left-hand prompt with the correct right-hand item.
// Rendered as a dropdown per left row — the most reliable matching control on
// touch devices (drag-to-connect lines are fiddly on phones/tablets).
// config: { prompt, left: [{id,text}], right: [{id,text}] }.
// Value shape: { [leftId]: rightId }. Correct mapping lives in the answer key.
export default function MatchPairsBlock({ block, value, onChange, readOnly = false }) {
  const cfg = block.config || {};
  const left = Array.isArray(cfg.left) ? cfg.left : [];
  const right = Array.isArray(cfg.right) ? cfg.right : [];
  const pairs = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rightById = Object.fromEntries(right.map((r) => [r.id, r]));

  function setMatch(leftId, rightId) {
    const next = { ...pairs };
    if (!rightId) delete next[leftId];
    else next[leftId] = rightId;
    onChange(next);
  }

  return (
    <div className="wb-field wb-matchpairs">
      {cfg.prompt && <div className="wb-label">{cfg.prompt}</div>}
      <div className="matchpairs-list">
        {left.map((l) => {
          const sel = pairs[l.id] || '';
          if (readOnly) {
            return (
              <div key={l.id} className="matchpairs-row">
                <span className="matchpairs-left">{l.text}</span>
                <span className="matchpairs-arrow">→</span>
                <span className={`matchpairs-pick readonly ${sel ? '' : 'empty'}`}>
                  {sel ? (rightById[sel]?.text || '—') : '—'}
                </span>
              </div>
            );
          }
          return (
            <div key={l.id} className="matchpairs-row">
              <span className="matchpairs-left">{l.text}</span>
              <span className="matchpairs-arrow">→</span>
              <select
                className="form-input matchpairs-pick"
                value={sel}
                aria-label={`Match for ${l.text}`}
                onChange={(e) => setMatch(l.id, e.target.value)}
              >
                <option value="">— choose —</option>
                {right.map((r) => (
                  <option key={r.id} value={r.id}>{r.text}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
