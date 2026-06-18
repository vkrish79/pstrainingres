import { parseFillBlank } from '../../lib/interactiveBlocks.js';

// Fill-in-the-blank: a sentence with inline text inputs where the trainer
// placed `{{ }}` markers. Value shape: { [blankId]: text }. The correct answers
// live in the answer key (never in config), so nothing here reveals them.
export default function FillBlankBlock({ block, value, onChange, readOnly = false }) {
  const cfg = block.config || {};
  const { parts } = cfg.parts ? { parts: cfg.parts } : parseFillBlank(cfg.text || '', cfg.blanks || []);
  const answers = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  function setBlank(id, text) {
    onChange({ ...answers, [id]: text });
  }

  let blankNo = 0;
  return (
    <div className="wb-field wb-fillblank">
      {cfg.prompt && <div className="wb-label">{cfg.prompt}</div>}
      <p className="fillblank-sentence">
        {parts.map((part, i) => {
          if (part.kind === 'text') return <span key={i}>{part.text}</span>;
          blankNo += 1;
          const v = answers[part.id] || '';
          if (readOnly) {
            return (
              <span key={i} className={`fillblank-slot readonly ${v ? '' : 'empty'}`}>
                {v || '—'}
              </span>
            );
          }
          return (
            <input
              key={i}
              className="fillblank-input"
              type="text"
              aria-label={`Blank ${blankNo}`}
              value={v}
              size={Math.max(6, v.length + 2)}
              onChange={(e) => setBlank(part.id, e.target.value)}
            />
          );
        })}
      </p>
    </div>
  );
}
