import { useMemo, useState } from 'react';
import { useBusyOverlay } from '../../contexts/BusyOverlayContext.jsx';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';
import { placeholderFixes, applyPlaceholderFixes, newBoxId, boxesOf } from '../../lib/tableCells.js';
import '../../styles/placeholder-repair.css';

// Word forms leave "Click or tap here to enter text." where an answer goes.
// Content imported before the importer understood that shows the sentence as
// plain text and nobody can answer it. This finds those cells and, once the
// trainer has looked at the list, turns each into an answer box — nothing is
// written until they press Fix.
//
// isSessionCopy: the workbook belongs to a running session, so adding boxes
// also adds to every participant's total for those exercises. Said up front.
export default function PlaceholderRepair({ sections, blocks, onSaveBlock, isSessionCopy = false }) {
  const [open, setOpen] = useState(false);

  // Ids are minted once per content version, so the preview and the save agree.
  const found = useMemo(() => {
    const order = new Map((sections || []).map((s, i) => [s.id, { i, title: s.title }]));
    const out = [];
    for (const b of blocks || []) {
      if (b.block_type !== 'table') continue;
      const fixes = placeholderFixes(b.config, newBoxId);
      if (!fixes.length) continue;
      const sec = order.get(b.section_id);
      out.push({ block: b, fixes, sectionTitle: sec?.title || 'Exercise', sectionIndex: sec?.i ?? 9999 });
    }
    return out.sort((a, b) => a.sectionIndex - b.sectionIndex || a.block.order_index - b.block.order_index);
  }, [sections, blocks]);

  const cellCount = found.reduce((n, f) => n + f.fixes.length, 0);
  if (!cellCount) return null;

  return (
    <>
      <div className="phr-banner" role="status">
        <span className="phr-banner-icon" aria-hidden>▭</span>
        <span className="phr-banner-text">
          <strong>{cellCount} cell{cellCount === 1 ? '' : 's'}</strong> still show Word’s
          “Click or tap here to enter text.” as plain text — participants can’t type there.
        </span>
        <button type="button" className="phr-banner-btn" onClick={() => setOpen(true)}>Review and fix</button>
      </div>
      {open && (
        <RepairModal
          found={found}
          isSessionCopy={isSessionCopy}
          onSaveBlock={onSaveBlock}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function RepairModal({ found, isSessionCopy, onSaveBlock, onClose }) {
  useBodyScrollLock();
  const { run: runBusy } = useBusyOverlay();
  const keyOf = (blockId, f) => `${blockId}:${f.row}:${f.col}`;
  const [picked, setPicked] = useState(() => new Set(found.flatMap(g => g.fixes.map(f => keyOf(g.block.id, f)))));
  const [error, setError] = useState('');

  const chosen = found
    .map(g => ({ ...g, fixes: g.fixes.filter(f => picked.has(keyOf(g.block.id, f))) }))
    .filter(g => g.fixes.length);
  const boxCount = chosen.reduce((n, g) => n + g.fixes.reduce((m, f) => m + (f.after.kind === 'input' ? 1 : boxesOf(f.after).length), 0), 0);
  const cellCount = chosen.reduce((n, g) => n + g.fixes.length, 0);

  function toggle(k) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  async function fix() {
    setError('');
    const failed = [];
    await runBusy(`Adding ${boxCount} answer box${boxCount === 1 ? '' : 'es'}…`, async () => {
      for (const g of chosen) {
        const patch = { config: applyPlaceholderFixes(g.block.config, g.fixes) };
        let res = await onSaveBlock(g.block.id, patch);
        // Block saves occasionally hit the database's statement timeout under
        // load; the same write goes through a moment later. One retry, then say so.
        if (res?.error && /timeout/i.test(res.error.message || String(res.error))) {
          res = await onSaveBlock(g.block.id, patch);
        }
        if (res?.error) failed.push(`${g.sectionTitle}: ${res.error.message || res.error}`);
      }
    });
    if (failed.length) { setError(`Some cells were not fixed — ${failed.join('; ')}`); return; }
    onClose();
  }

  return (
    <div className="modal-backdrop visible" onClick={onClose}>
      <div className="modal-card phr-card" role="dialog" aria-modal="true" aria-labelledby="phr-title" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2 id="phr-title">Turn Word placeholders into answer boxes</h2>
            <p className="phr-sub">The grey sentence becomes a box; the wording around it stays.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="modal-body">
          {isSessionCopy && (
            <p className="phr-warn">
              This is a running session’s workbook. Each new box also counts toward participants’
              progress for its exercise, so someone who had finished it will show one box to go.
            </p>
          )}
          {found.map(g => (
            <section key={g.block.id} className="phr-group">
              <h3>{g.sectionTitle}</h3>
              <ul>
                {g.fixes.map(f => {
                  const k = keyOf(g.block.id, f);
                  return (
                    <li key={k} className={picked.has(k) ? '' : 'is-off'}>
                      <label>
                        <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} />
                        <span className="phr-where">Row {f.row + 1}, col {f.col + 1}</span>
                      </label>
                      <div className="phr-compare">
                        <div className="phr-before"><Highlighted text={f.before} /></div>
                        <span className="phr-arrow" aria-hidden>→</span>
                        <div className="phr-after"><AfterPreview cell={f.after} /></div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {error && <p className="error">{error}</p>}
        </div>

        <footer className="modal-foot">
          <button type="button" onClick={fix} disabled={!cellCount}>
            Fix {cellCount} cell{cellCount === 1 ? '' : 's'}
          </button>
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <span className="phr-foot-note">
            Adds {boxCount} answer box{boxCount === 1 ? '' : 'es'}. Nothing else changes.
          </span>
        </footer>
      </div>
    </div>
  );
}

const PH_SPLIT = /(click (?:or tap )?(?:here )?to enter (?:text|a date)\.?)/gi;

function Highlighted({ text }) {
  return text.split(PH_SPLIT).map((part, i) =>
    i % 2 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>);
}

function AfterPreview({ cell }) {
  if (cell.kind === 'input') return <span className="phr-box" aria-label="answer box" />;
  return (cell.parts || []).map((p, i) =>
    p.kind === 'box'
      ? <span key={i} className="phr-box" aria-label="answer box" />
      : <span key={i}>{p.text}</span>);
}
