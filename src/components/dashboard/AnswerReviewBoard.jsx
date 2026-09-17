import { useEffect, useMemo, useState } from 'react';
import { useAnswerReviewBoard } from '../../hooks/useAnswerReview.js';
import {
  buildTabs, cellTone, indexCells, slotKey, slotsOfBlock, topWrongGroup, trainerAnswerOf,
} from '../../lib/answerReview.js';
import { boxLabel } from '../../lib/tableCells.js';
import '../../styles/answer-review.css';

const SUMMARY = '__summary__';

// Going over one exercise's answers with the class. Full screen, because it is
// what goes on the projector: "Present" hides every control so the room sees
// the grid and the groups, never a button. Opening it opens the review in the
// database (participants start seeing their marks); closing it does not end
// the review — Finish does.
export default function AnswerReviewBoard({
  sessionId, section, blocks, answersVersion, reviewVersion, onClose,
}) {
  const { board, error, loading, open, finish, cellAction } = useAnswerReviewBoard(
    sessionId, section.id, { answersVersion, reviewVersion },
  );
  const [present, setPresent] = useState(false);
  const [tabKey, setTabKey] = useState(null);
  const [selected, setSelected] = useState(null); // slotKey
  const [busy, setBusy] = useState(false);

  // Opening the board is "Go over answers": open (or re-open) the review once.
  useEffect(() => { open(); }, [open]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tabs = useMemo(() => buildTabs(blocks), [blocks]);
  const cells = useMemo(() => indexCells(board?.cells), [board]);
  const onSummary = tabKey === SUMMARY;
  const tab = onSummary ? null : (tabs.find(t => t.key === tabKey) || tabs[0] || null);

  // How each part went, once there is a review to summarise.
  const summary = useMemo(() => {
    if (!board?.review) return null;
    return tabs.map(t => {
      const own = [];
      let right = 0, answered = 0, firstWrong = 0, corrected = 0;
      for (const b of t.blocks) for (const s of slotsOfBlock(b)) {
        const c = cells.get(slotKey(b.id, s.slot));
        if (!c || c.answered === 0) continue;
        if (c.personal) { own.push(s.label); continue; }
        if (!c.accepted?.length) continue;
        right += c.right_count; answered += c.answered;
        firstWrong += c.first_wrong; corrected += c.corrected;
      }
      return { key: t.key, title: t.title, right, answered, firstWrong, corrected, own: own.length };
    });
  }, [board, tabs, cells]);

  // Default selection: the weakest compared cell on the tab, which is where a
  // trainer would start talking.
  useEffect(() => {
    if (!tab || !board || onSummary) return;
    const keys = tab.blocks.flatMap(b => slotsOfBlock(b).map(s => slotKey(b.id, s.slot)));
    if (selected && keys.includes(selected)) return;
    const ranked = keys
      .map(k => cells.get(k))
      .filter(c => c && c.answered > 0 && !c.personal && c.accepted.length)
      .sort((a, b) => a.right_count / a.answered - b.right_count / b.answered);
    setSelected(ranked[0] ? slotKey(ranked[0].block_id, ranked[0].slot) : null);
  }, [tab, board, cells, selected]);

  const status = board?.review?.status;
  const answeredMax = useMemo(
    () => Math.max(0, ...(board?.cells || []).map(c => c.answered)),
    [board],
  );

  async function act(fn) {
    setBusy(true);
    await fn();
    setBusy(false);
  }

  const selectedCell = selected ? cells.get(selected) : null;
  const selectedMeta = useMemo(() => {
    if (!selected) return null;
    for (const b of blocks) for (const s of slotsOfBlock(b)) if (slotKey(b.id, s.slot) === selected) return { block: b, ...s };
    return null;
  }, [selected, blocks]);

  return (
    <div className={`arb${present ? ' arb--present' : ''}`} role="dialog" aria-modal="true" aria-label={`Going over ${section.title}`}>
      <header className="arb-head">
        <div className="arb-head-text">
          <div className="arb-eyebrow">Going over answers</div>
          <h2 className="arb-title">{section.title}</h2>
          <div className="arb-meta">
            {board ? `${answeredMax} of ${board.participants} answered · no names` : 'Loading…'}
            {!present && status === 'open' && <span className="arb-live">Participants see their marks</span>}
            {!present && status === 'finished' && <span className="arb-done">Finished</span>}
          </div>
        </div>
        <div className="arb-head-actions">
          <button
            type="button"
            className={`arb-btn${present ? ' is-on' : ''}`}
            onClick={() => setPresent(p => !p)}
            data-tip={present ? 'Show the controls again' : 'Hide every control, for the projector'}
          >
            {present ? 'Show controls' : 'Present'}
          </button>
          {!present && status === 'open' && (
            <button type="button" className="arb-btn" disabled={busy} onClick={() => act(finish)}
              data-tip="End going over this exercise. Participants keep their marks.">
              ✓ Finish
            </button>
          )}
          {!present && status === 'finished' && (
            <button type="button" className="arb-btn" disabled={busy} onClick={() => act(open)}
              data-tip="Open it again, for example after latecomers finish">
              ↺ Open again
            </button>
          )}
          <button type="button" className="arb-btn arb-close" onClick={onClose} aria-label="Close" data-tip="Close the board (Esc)">×</button>
        </div>
      </header>

      {error && <p className="arb-error">{error}</p>}

      {(tabs.length > 1 || summary) && (
        <nav className="arb-tabs" aria-label="Parts of the exercise">
          {tabs.map(t => (
            <button key={t.key} type="button"
              className={`arb-tab${t.key === tab?.key ? ' is-on' : ''}`}
              onClick={() => setTabKey(t.key)}>
              {t.title}
            </button>
          ))}
          {summary && (
            <button type="button" className={`arb-tab${onSummary ? ' is-on' : ''}`} onClick={() => setTabKey(SUMMARY)}>
              How it went
            </button>
          )}
        </nav>
      )}

      <div className="arb-body">
        <div className="arb-grid">
          {onSummary && summary && <ReviewSummary rows={summary} review={board.review} />}
          {loading && !board && <p className="arb-empty">Grouping the class's answers…</p>}
          {board && !tab && !onSummary && <p className="arb-empty">This exercise has no answer boxes to go over.</p>}
          {board && tab?.blocks.filter(b => slotsOfBlock(b).length > 0).map(b => (
            b.block_type === 'field'
              ? <FieldSummary key={b.id} block={b} cells={cells} selected={selected} onSelect={setSelected} />
              : <TableSummary key={b.id} block={b} cells={cells} selected={selected} onSelect={setSelected} />
          ))}
          {board && !onSummary && (
            <div className="arb-legend">
              <span><i className="arb-dot good" />8+ in 10 match the trainer</span>
              <span><i className="arb-dot mixed" />5–7 in 10</span>
              <span><i className="arb-dot poor" />under 5 in 10</span>
              <span><i className="arb-dot own" />everyone's own, not compared</span>
            </div>
          )}
        </div>

        <aside className="arb-panel" aria-live="polite">
          {selectedCell && selectedMeta ? (
            <CellPanel
              cell={selectedCell}
              meta={selectedMeta}
              present={present}
              busy={busy}
              onAction={(action, extra) => act(() => cellAction(selectedMeta.block.id, selectedMeta.slot, action, extra))}
            />
          ) : (
            <p className="arb-empty">Pick a cell to see what the class wrote.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

// How each part of the exercise went, and how many put their answer right
// afterwards. The trainer's record of the debrief.
function ReviewSummary({ rows, review }) {
  const when = review.finished_at || review.opened_at;
  const time = when ? new Date(when).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const weakest = rows.filter(r => r.answered > 0).sort((a, b) => a.right / a.answered - b.right / b.answered)[0];
  return (
    <div className="arb-summary">
      <div className="arb-summary-head">
        <div className="arb-eyebrow">{review.status === 'finished' ? `Gone over at ${time}` : `Started at ${time}`}</div>
        {weakest && <h3>{weakest.title} was the part people got wrong most</h3>}
      </div>
      <table className="wb-table arb-summary-table">
        <thead>
          <tr><th>Part</th><th>Matched your answer</th><th>Corrected afterwards</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td>{r.title}</td>
              <td>{r.answered ? `${r.right} of ${r.answered}` : <span className="muted">nothing answered</span>}
                {r.own > 0 && <span className="arb-summary-own"> · {r.own} everyone's own</span>}</td>
              <td>{r.firstWrong ? `${r.corrected} of ${r.firstWrong}` : <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="arb-small">Counts are answer boxes, not people: one participant can be right in one box and wrong in the next.</p>
    </div>
  );
}

function TableSummary({ block, cells, selected, onSelect }) {
  const cfg = block.config || {};
  return (
    <div className="arb-table-wrap">
      {cfg.caption && <div className="wb-table-caption">{cfg.caption}</div>}
      <table className="wb-table arb-table">
        {cfg.headers && <thead><tr>{cfg.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>}
        <tbody>
          {(cfg.rows || []).map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}
                  className={cell.kind === 'static' ? 'wb-cell-static' : 'arb-td'}
                  colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}>
                  {cell.kind === 'static' && cell.text}
                  {cell.kind === 'input' && (
                    <SlotSummary cell={cells.get(slotKey(block.id, cell.id))} k={slotKey(block.id, cell.id)} selected={selected} onSelect={onSelect} />
                  )}
                  {cell.kind === 'mixed' && <MixedSummary block={block} cell={cell} cells={cells} selected={selected} onSelect={onSelect} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MixedSummary({ block, cell, cells, selected, onSelect }) {
  let boxNo = -1;
  return (
    <span className="arb-mixed">
      {(cell.parts || []).map((p, i) => {
        if (p.kind !== 'box') return <span key={i}>{p.text}</span>;
        boxNo += 1;
        const k = slotKey(block.id, p.id);
        return <SlotSummary key={p.id} compact cell={cells.get(k)} k={k} selected={selected} onSelect={onSelect} label={boxLabel(cell, boxNo, 'Answer')} />;
      })}
    </span>
  );
}

function FieldSummary({ block, cells, selected, onSelect }) {
  const k = slotKey(block.id, '');
  return (
    <div className="arb-field">
      <div className="arb-field-label">{block.config?.label}</div>
      <SlotSummary cell={cells.get(k)} k={k} selected={selected} onSelect={onSelect} />
    </div>
  );
}

// One answer box on the board: the trainer's answer, how many matched it, and
// the biggest different answer.
function SlotSummary({ cell, k, selected, onSelect, compact = false, label }) {
  const tone = cellTone(cell);
  const isSel = selected === k;
  const common = {
    type: 'button',
    className: `arb-slot tone-${tone}${isSel ? ' is-sel' : ''}${compact ? ' is-compact' : ''}`,
    onClick: () => onSelect(k),
    'aria-pressed': isSel,
    'aria-label': label,
  };
  if (tone === 'empty') return <button {...common}><span className="arb-slot-val muted">No answers yet</span></button>;
  if (tone === 'own') {
    return (
      <button {...common}>
        <span className="arb-slot-val muted">Everyone's own</span>
        <span className="arb-slot-n">{cell.answered}</span>
      </button>
    );
  }
  const trainer = trainerAnswerOf(cell);
  const wrong = topWrongGroup(cell);
  const share = cell.answered ? Math.round((100 * cell.right_count) / cell.answered) : 0;
  return (
    <button {...common}>
      <span className="arb-slot-top">
        <span className="arb-slot-val">{trainer || <em className="muted">No trainer answer</em>}</span>
        {tone !== 'unset' && <span className="arb-slot-n">{cell.right_count}/{cell.answered}</span>}
      </span>
      {tone !== 'unset' && <span className="arb-bar"><i style={{ width: `${share}%` }} /></span>}
      {!compact && tone === 'unset' && <span className="arb-slot-hint">Pick the right answer</span>}
      {!compact && wrong && wrong.n > 1 && <span className="arb-slot-hint">{wrong.n} wrote {wrong.sample}</span>}
    </button>
  );
}

function CellPanel({ cell, meta, present, busy, onAction }) {
  const [note, setNote] = useState(cell.note || '');
  useEffect(() => { setNote(cell.note || ''); }, [cell.note, meta.slot, meta.block.id]);

  const trainer = trainerAnswerOf(cell);
  const variantsByGroup = useMemo(() => {
    const m = new Map();
    for (const v of cell.variants || []) {
      if (v.key === v.into) continue;
      if (!m.has(v.into)) m.set(v.into, []);
      m.get(v.into).push(v);
    }
    return m;
  }, [cell]);
  const maxN = Math.max(1, ...(cell.groups || []).map(g => g.n));

  return (
    <div className="arb-cell">
      <div className="arb-cell-head">
        <div className="arb-eyebrow">{meta.label}</div>
        <div className="arb-cell-trainer">
          Trainer's answer: <b className="mono">{trainer || '—'}</b>
        </div>
        <div className="arb-cell-count">
          {cell.personal
            ? `${cell.answered} answered · everyone's own, not compared`
            : `${cell.right_count} of ${cell.answered} match`}
        </div>
      </div>

      {!cell.personal && (
        <ul className="arb-groups">
          {(cell.groups || []).map(g => (
            <li key={g.key} className={`arb-group${g.right ? ' is-right' : ''}`}>
              <div className="arb-group-row">
                <span className="arb-group-val mono">{g.sample}</span>
                <span className="arb-group-n">{g.n}</span>
                {present ? (
                  g.right && <span className="arb-tag right">✓ Right</span>
                ) : (
                  <button type="button" disabled={busy}
                    className={`arb-tag-btn${g.right ? ' right' : ''}`}
                    onClick={() => onAction('right', { key: g.key, on: !g.right })}
                    data-tip={g.right ? 'Stop counting this as right' : 'Count this answer as right'}>
                    {g.right ? '✓ Counts as right' : 'Mark right'}
                  </button>
                )}
              </div>
              <span className="arb-bar"><i style={{ width: `${(100 * g.n) / maxN}%` }} /></span>
              {(variantsByGroup.get(g.key) || []).map(v => (
                <div key={v.key} className="arb-variant">
                  <span className="mono">{v.sample}</span>
                  <span className="arb-group-n">{v.n}</span>
                  {!present && (
                    <button type="button" className="arb-link" disabled={busy}
                      onClick={() => onAction('merge', { key: v.key, into: null })}>
                      Separate
                    </button>
                  )}
                </div>
              ))}
              {!present && (cell.groups || []).length > 1 && (
                <label className="arb-merge">
                  <span>Same as</span>
                  <select value="" disabled={busy}
                    onChange={e => e.target.value && onAction('merge', { key: g.key, into: e.target.value })}>
                    <option value="">…</option>
                    {cell.groups.filter(o => o.key !== g.key).map(o => (
                      <option key={o.key} value={o.key}>{o.sample}</option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          ))}
        </ul>
      )}

      {cell.hidden > 0 && (
        <p className="arb-small">
          {cell.hidden} answer{cell.hidden === 1 ? '' : 's'} given by one person hidden: fewer than 5 answered, so it could point to who wrote it.
        </p>
      )}

      {cell.first_wrong > 0 && (
        <p className="arb-small">{cell.corrected} of {cell.first_wrong} who differed have corrected their answer.</p>
      )}

      {present ? (
        cell.note && <p className="arb-note-show">{cell.note}</p>
      ) : (
        <>
          <label className="arb-note">
            <span>Note for the class (one line)</span>
            <input type="text" value={note} maxLength={200}
              placeholder="e.g. The segment number goes before the asterisk"
              onChange={e => setNote(e.target.value)}
              onBlur={() => { if ((note || '') !== (cell.note || '')) onAction('note', { note }); }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          </label>
          <label className="arb-own">
            <input type="checkbox" checked={cell.personal} disabled={busy}
              onChange={e => {
                const want = e.target.checked;
                onAction('personal', { on: want === cell.personal_auto ? null : want });
              }} />
            <span>
              Everyone's own answer, don't compare
              {cell.personal_auto && <em> (set automatically: nearly every answer is different)</em>}
            </span>
          </label>
        </>
      )}
    </div>
  );
}
