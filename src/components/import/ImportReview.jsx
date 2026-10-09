import { useEffect, useMemo, useRef, useState } from 'react';
import Block from '../blocks/Block.jsx';
import { countsOf } from '../../lib/docxImport.js';
import {
  prepareReview, suggestionsOf, resolveSuggestion, resolveAll, cycleCell, canCycle,
  toggleColumn, setBlockKind, answerBoxCount, finishReview, tableGrid, proseLines,
} from '../../lib/importSuggestions.js';
import { isPnrQuestion } from '../../lib/pnrQuestion.js';
import '../../styles/workbook.css';
import '../../styles/import-review.css';

// Step 2 of a Word import: the document drawn as participants will see it, with
// everything the importer was not sure about listed for a yes or no. Shared by
// the workbook and assessment import pages. Nothing is saved here: Create hands
// the edited parse back to the page (same shape parseDocxToWorkbook returns),
// which saves it exactly as before.
export default function ImportReview({ parsed, kind = 'workbook', title, onTitle, onCreate, onDiscard, busy = false, extra = null }) {
  const [draft, setDraft] = useState(() => prepareReview(parsed, { kind }));
  const [selected, setSelected] = useState(() => firstExercise(draft));
  const [menuFor, setMenuFor] = useState(null);
  const docRef = useRef(null);
  const pictures = usePictureUrls(parsed.images);
  const noun = kind === 'assessment' ? 'assessment' : 'workbook';

  const items = useMemo(() => suggestionsOf(draft), [draft]);
  const wordBoxes = useMemo(() => countsOf(parsed).boxes, [parsed]);
  // Per section: answer boxes waiting (the rail's "+n") and whether anything at
  // all is waiting — a short row is not a box, but it still wants a look.
  const pendingBySection = useMemo(() => {
    const m = {};
    for (const it of items) {
      const e = m[it.secRid] || (m[it.secRid] = { boxes: 0, any: false });
      e.any = true;
      if (it.type !== 'widen') e.boxes += it.count;
    }
    return m;
  }, [items]);
  const totals = useMemo(() => ({
    exercises: draft.sections.filter(s => s.kind !== 'group').length,
    boxes: draft.sections.reduce((n, s) => n + answerBoxCount(s), 0),
    pictures: countsOf(draft).pictures,
  }), [draft]);

  const section = draft.sections.find(s => s._rid === selected) || draft.sections[0];
  const sectionItems = items.filter(it => it.secRid === section?._rid);
  const otherItems = items.filter(it => it.secRid !== section?._rid);

  useEffect(() => {
    if (!menuFor) return undefined;
    const close = (e) => { if (!e.target.closest?.('.ir-menu, .ir-what')) setMenuFor(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuFor]);

  function pick(secRid, blockRid) {
    setSelected(secRid);
    setMenuFor(null);
    // The window is scrolled by hand: scrollIntoView also scrolls overflow:hidden
    // ancestors, which slid the whole app shell down under its own top bar.
    requestAnimationFrame(() => {
      const el = (blockRid && docRef.current?.querySelector(`[data-rid="${blockRid}"]`)) || docRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const target = el === docRef.current ? top - 80 : top - window.innerHeight / 3;
      if (el !== docRef.current || top < 0) window.scrollTo({ top: window.scrollY + target, behavior: 'smooth' });
    });
  }

  const resolve = (item, accept, opts) => setDraft(d => resolveSuggestion(d, item, accept, opts));

  return (
    <div className="ir-review">
      <div className="ir-head">
        <div className="ir-head-file">
          <span className="ir-mini-doc" aria-hidden="true">W</span>
          <input
            className="ir-title"
            value={title}
            onChange={e => onTitle(e.target.value)}
            aria-label={`${noun} title`}
          />
        </div>
        <div className="ir-chips">
          <span className="ir-chip">{totals.exercises} exercise{totals.exercises === 1 ? '' : 's'}</span>
          <span className="ir-chip ok">{totals.boxes} answer box{totals.boxes === 1 ? '' : 'es'}</span>
          {totals.pictures > 0 && <span className="ir-chip">{totals.pictures} picture{totals.pictures === 1 ? '' : 's'}</span>}
          {items.length > 0 && <span className="ir-chip warn">{items.length} need{items.length === 1 ? 's' : ''} a look</span>}
        </div>
        <div className="ir-head-actions">
          <span className="ir-note">Nothing saved yet</span>
          <button type="button" className="ir-btn-ghost" onClick={onDiscard} disabled={busy}>Discard</button>
          <button type="button" onClick={() => onCreate(finishReview(draft))} disabled={busy || !title.trim()}>
            {busy ? 'Creating…' : `Create ${noun}`}
          </button>
        </div>
        {extra && <div className="ir-head-extra">{extra}</div>}
      </div>

      <div className="ir-grid">
        <nav className="ir-rail" aria-label="Sections">
          <div className="ir-rail-h">Sections</div>
          {draft.sections.map((s) => {
            const n = answerBoxCount(s);
            const { boxes: p = 0, any = false } = pendingBySection[s._rid] || {};
            return (
              <button
                type="button"
                key={s._rid}
                className={`ir-rail-item ${s.kind === 'group' ? 'group' : ''} ${s._rid === section?._rid ? 'on' : ''}`}
                onClick={() => pick(s._rid)}
              >
                <span className={`ir-dot ${any ? 'w' : n ? '' : 'z'}`} aria-hidden="true" />
                <span className="ir-rail-t">{s.title}</span>
                <span className="ir-rail-n">{n}{p > 0 && <em> +{p}</em>}</span>
              </button>
            );
          })}
          <div className="ir-rail-legend">
            <span><span className="ir-dot" /> has answer boxes</span>
            <span><span className="ir-dot w" /> suggestions waiting (+n)</span>
            <span><span className="ir-dot z" /> reading only</span>
          </div>
        </nav>

        <div className="ir-doc" ref={docRef}>
          {section ? (
            <>
              <h2 className="ir-doc-title">{section.title}</h2>
              <div className="ir-doc-rule" />
              {section.blocks.length === 0 && <p className="muted">Nothing in this section.</p>}
              {section.blocks.map(b => (
                <ReviewBlock
                  key={b._rid}
                  block={b}
                  kind={kind}
                  pictures={pictures}
                  menuOpen={menuFor === b._rid}
                  onMenu={() => setMenuFor(m => (m === b._rid ? null : b._rid))}
                  onKind={(to) => { setDraft(d => setBlockKind(d, b._rid, to)); setMenuFor(null); }}
                  onCell={(ri, ci) => setDraft(d => cycleCell(d, b._rid, ri, ci))}
                  onColumn={col => setDraft(d => toggleColumn(d, b._rid, col))}
                  pending={sectionItems.filter(it => it.blockRid === b._rid)}
                  onResolve={resolve}
                />
              ))}
            </>
          ) : <p className="muted">No sections were found. Add Heading 2 paragraphs in Word to define sections.</p>}
        </div>

        <aside className="ir-side">
          <div className="ir-issues">
            <div className="ir-issues-top">
              <h3>Needs a look · {items.length}</h3>
              {items.length > 0 && (
                <button type="button" className="ir-btn-ghost sm" onClick={() => setDraft(d => resolveAll(d, true))}>Accept all</button>
              )}
            </div>
            {items.length === 0 && <p className="ir-quiet">Nothing left to check.</p>}
            {sectionItems.map(it => <Issue key={it.key} item={it} onResolve={resolve} onGo={() => pick(it.secRid, it.blockRid)} />)}
            {otherItems.length > 0 && (
              <>
                {sectionItems.length > 0 && <div className="ir-issues-sep">Elsewhere</div>}
                {otherItems.map(it => <Issue key={it.key} item={it} onResolve={resolve} onGo={() => pick(it.secRid, it.blockRid)} />)}
              </>
            )}
            {wordBoxes > 0 && (
              <div className="ir-issue done">
                <div className="ir-issue-where">Done</div>
                <div className="ir-issue-q">{wordBoxes} "Click or tap here" box{wordBoxes === 1 ? '' : 'es'} from Word became answer box{wordBoxes === 1 ? '' : 'es'}.</div>
              </div>
            )}
          </div>
          <div className="ir-legend">
            <h3>Click to change anything</h3>
            <div className="ir-lg"><span className="ir-box" /><span>Answer box. Click to cycle: short → long → text.</span></div>
            <div className="ir-lg"><span className="ir-box sug" /><span>Suggested. Accept here or in the list, or click it.</span></div>
            <div className="ir-lg"><span className="ir-box empty" /><span>Empty cell. Click to make it an answer box.</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function firstExercise(draft) {
  const s = draft.sections.find(x => x.kind !== 'group' && x.blocks.length) || draft.sections.find(x => x.blocks.length) || draft.sections[0];
  return s?._rid || null;
}

// Imported pictures are held as bytes until Create uploads them; the review
// shows them from object URLs, released when the review closes.
function usePictureUrls(images) {
  const urls = useMemo(() => {
    const m = {};
    for (const img of images || []) {
      try { m[img.key] = URL.createObjectURL(new Blob([img.bytes], { type: img.contentType || 'image/png' })); } catch { /* shown as missing */ }
    }
    return m;
  }, [images]);
  useEffect(() => () => Object.values(urls).forEach(u => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

function withPictures(html, pictures) {
  return (html || '').replace(/data-wb-pending="([^"]+)"/g, (attr, key) => (
    pictures[key] ? `src="${pictures[key]}" ${attr}` : attr
  ));
}

function Issue({ item, onResolve, onGo }) {
  const quote = s => `“${s}”`;
  let q, actions;
  if (item.type === 'cells') {
    q = `${item.count} empty cell${item.count === 1 ? '' : 's'} beside ${item.samples.map(quote).join(', ')}${item.count > item.samples.length ? ' and others' : ''}. Make ${item.count === 1 ? 'it an answer box' : 'them answer boxes'}?`;
    actions = (
      <>
        <button type="button" className="ir-btn-gold sm" onClick={() => onResolve(item, true)}>Make answer box{item.count === 1 ? '' : 'es'}</button>
        <button type="button" className="ir-btn-ghost sm" onClick={() => onResolve(item, false)}>Leave as text</button>
      </>
    );
  } else if (item.type === 'widen') {
    q = `${item.count} row${item.count === 1 ? '' : 's'} in this table stop${item.count === 1 ? 's' : ''} short of its right edge. Line ${item.count === 1 ? 'it' : 'them'} up?`;
    actions = (
      <>
        <button type="button" className="ir-btn-gold sm" onClick={() => onResolve(item, true)}>Line up rows</button>
        <button type="button" className="ir-btn-ghost sm" onClick={() => onResolve(item, false)}>Leave as is</button>
      </>
    );
  } else if (item.type === 'lines') {
    const s = item.samples[0] || '';
    q = `${quote(s.length > 70 ? s.slice(0, 70) + '…' : s)} has a typed underline, not a Word box. Make it an answer box?`;
    actions = (
      <>
        <button type="button" className="ir-btn-gold sm" onClick={() => onResolve(item, true)}>Make answer box</button>
        <button type="button" className="ir-btn-ghost sm" onClick={() => onResolve(item, false)}>No</button>
      </>
    );
  } else {
    q = `These ${item.count} lines look like questions with nowhere to answer. Give each one an answer box?`;
    actions = (
      <>
        <button type="button" className="ir-btn-gold sm" onClick={() => onResolve(item, true, { as: 'long_text' })}>Long answers</button>
        <button type="button" className="ir-btn-ghost sm" onClick={() => onResolve(item, true, { as: 'short_text' })}>Short answers</button>
        <button type="button" className="ir-btn-ghost sm" onClick={() => onResolve(item, false)}>No</button>
      </>
    );
  }
  return (
    <div className="ir-issue">
      <button type="button" className="ir-issue-where" onClick={onGo}>{item.section} · {item.type === 'subq' ? 'questions' : 'table'} ›</button>
      <div className="ir-issue-q">{q}</div>
      <div className="ir-issue-row">{actions}</div>
    </div>
  );
}

const KIND_ICON = { prose: '¶', field: '▭', table: '▦' };

function ReviewBlock({ block, kind, pictures, menuOpen, onMenu, onKind, onCell, onColumn, pending, onResolve }) {
  const options = menuOptions(block, kind);
  const hasSug = block._subq || pending.length > 0;
  return (
    <div className={`ir-blk ${menuOpen ? 'focus' : ''} ${block._subq ? 'sugq' : ''}`} data-rid={block._rid}>
      {options.length > 0 ? (
        <button
          type="button"
          className={`ir-what ${hasSug ? 'w' : ''}`}
          onClick={onMenu}
          data-tip="What is this?"
          aria-label="What is this?"
        >{KIND_ICON[block.block_type] || '•'}</button>
      ) : <span className="ir-what static" aria-hidden="true">{KIND_ICON[block.block_type] || '•'}</span>}

      {block.block_type === 'prose' ? (
        <div className="wb-prose" dangerouslySetInnerHTML={{ __html: withPictures(block.config.html, pictures) }} />
      ) : block.block_type === 'table' ? (
        <ReviewTable block={block} pictures={pictures} onCell={onCell} onColumn={onColumn} pending={pending} onResolve={onResolve} />
      ) : (
        <div className="ir-field">
          {isPnrQuestion(block) && <div className="ir-pnr-tag">PNR question · marked by hand with the ARDW scheme</div>}
          <Block block={block} preview />
        </div>
      )}

      {menuOpen && (
        <div className="ir-menu" role="menu">
          <div className="ir-menu-t">What is this?</div>
          {options.map(o => (o === '-' ? <div key={o} className="ir-menu-sep" /> : (
            <button type="button" role="menuitem" key={o.to} className={`ir-menu-i ${o.on ? 'on' : ''}`} onClick={() => onKind(o.to)}>
              <span className="ir-menu-ic">{o.icon}</span>{o.label}{o.hint && <span className="ir-menu-k">{o.hint}</span>}
            </button>
          )))}
        </div>
      )}
    </div>
  );
}

function menuOptions(block, kind) {
  const opts = [];
  const pnr = kind === 'assessment' && !isPnrQuestion(block)
    ? [{ to: 'pnr', icon: '✈', label: 'PNR question after this', hint: 'ARDW' }]
    : [];
  if (block.block_type === 'prose') {
    if (/data-wb-(pending|image)=/.test(block.config.html || '') && !proseLines(block.config.html).length) return [];
    const lines = proseLines(block.config.html).length;
    opts.push({ to: 'text', icon: '¶', label: 'Just text', on: true });
    opts.push({ to: 'short_text', icon: '▭', label: 'Short answer' });
    opts.push({ to: 'long_text', icon: '▤', label: 'Long answer' });
    if (lines >= 3) {
      opts.push({ to: 'choice', icon: '◉', label: 'Choice – pick one', hint: 'line 1 asks' });
      opts.push({ to: 'check_group', icon: '☑', label: 'Choice – pick several', hint: 'line 1 asks' });
    }
    if (lines >= 2) opts.push('-', { to: 'subq', icon: '↳', label: 'Questions, one box per line', hint: `${lines} lines` });
    if (pnr.length) opts.push('-', ...pnr);
    return opts;
  }
  if (block.block_type === 'field' && ['short_text', 'long_text'].includes(block.config.input_type) && !isPnrQuestion(block)) {
    const t = block.config.input_type;
    opts.push({ to: 'text', icon: '¶', label: 'Just text' });
    opts.push({ to: 'short_text', icon: '▭', label: 'Short answer', on: t === 'short_text' });
    opts.push({ to: 'long_text', icon: '▤', label: 'Long answer', on: t === 'long_text' });
    return opts;
  }
  if (block.block_type === 'field' && ['choice', 'check_group'].includes(block.config.input_type)) {
    const t = block.config.input_type;
    opts.push({ to: 'choice', icon: '◉', label: 'Choice – pick one', on: t === 'choice' });
    opts.push({ to: 'check_group', icon: '☑', label: 'Choice – pick several', on: t === 'check_group' });
    return opts;
  }
  if (block.block_type === 'table') return pnr;
  return [];
}

function ReviewTable({ block, pictures, onCell, onColumn, pending, onResolve }) {
  const cfg = block.config;
  const rows = useMemo(() => cfg.rows || [], [cfg.rows]);
  const { pos } = useMemo(() => tableGrid(rows), [rows]);
  // Column buttons only where the heading row lines up with the grid — a
  // plain table like the practice log, not a merged-cell form.
  const width = rows.reduce((w, row) => Math.max(w, row.reduce((n, c) => n + (c.colSpan > 1 ? c.colSpan : 1), 0)), 0);
  const columnar = cfg.headers && cfg.headers.length === width && width > 1;
  const cellsItem = pending.find(p => p.type === 'cells');
  const widenItem = pending.find(p => p.type === 'widen');

  return (
    <div className="wb-table-wrap ir-table-wrap">
      {(cellsItem || widenItem) && (
        <div className="ir-table-bar">
          <span>
            {cellsItem && `${cellsItem.count} suggested answer box${cellsItem.count === 1 ? '' : 'es'}`}
            {cellsItem && widenItem && ' · '}
            {widenItem && `${widenItem.count} short row${widenItem.count === 1 ? '' : 's'}`}
          </span>
          {cellsItem && <button type="button" className="ir-btn-gold sm" onClick={() => onResolve(cellsItem, true)}>Make answer box{cellsItem.count === 1 ? '' : 'es'}</button>}
          {cellsItem && <button type="button" className="ir-btn-ghost sm" onClick={() => onResolve(cellsItem, false)}>Leave as text</button>}
          {widenItem && (
            <button type="button" className="ir-btn-gold sm" onClick={() => onResolve(widenItem, true)} data-tip="Widen the last cell of each short row to the table's right edge">
              Line up rows
            </button>
          )}
        </div>
      )}
      <table className="wb-table ir-table">
        {cfg.headers && (
          <thead>
            <tr>
              {cfg.headers.map((h, i) => (
                <th key={i}>
                  {h}
                  {columnar && i > 0 && (
                    <button type="button" className="ir-colhint" onClick={() => onColumn(i)} data-tip="Make every empty cell in this column an answer box (click again to undo)">
                      Column answer boxes
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                  className={`${canCycle(cell) ? 'ir-td-click' : ''}${cell._sugWiden ? ' ir-td-short' : ''}`}
                  data-col={pos[ri]?.[ci]}
                >
                  <ReviewCell cell={cell} pictures={pictures} onClick={canCycle(cell) ? () => onCell(ri, ci) : null} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewCell({ cell, pictures, onClick }) {
  if (cell.kind === 'image') {
    return (
      <span className="wb-cell-image-stack">
        {(cell.images || []).map(k => (pictures[k] ? <img key={k} className="wb-img" src={pictures[k]} alt="" /> : <span key={k} className="wb-img-missing-note">Picture</span>))}
        {cell.text && <span className="wb-cell-image-text">{cell.text}</span>}
      </span>
    );
  }
  if (cell.kind === 'mixed') {
    return (
      <span className="wb-mixed">
        {(cell.parts || []).map((p, i) => (p.kind === 'box'
          ? <span key={i} className="ir-box inline" />
          : <span key={i} className="wb-mixed-text">{p.text}</span>))}
      </span>
    );
  }
  if (cell.kind === 'input') {
    return (
      <button
        type="button"
        className={`ir-box ${cell.input_type === 'long_text' ? 'long' : ''}`}
        onClick={onClick}
        data-tip={cell.input_type === 'long_text' ? 'Long answer — click to make it text' : 'Short answer — click for a long answer'}
        aria-label={cell.input_type === 'long_text' ? 'Long answer box' : 'Short answer box'}
      />
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        className={`ir-box ${cell._sug ? 'sug' : 'empty'}`}
        onClick={onClick}
        data-tip={cell._sug ? 'Suggested answer box — click to accept' : 'Empty cell — click to make it an answer box'}
        aria-label={cell._sug ? 'Suggested answer box' : 'Empty cell'}
      />
    );
  }
  if (cell._sugLine) {
    const parts = (cell.text || '').split(/(_{3,})/);
    return <span>{parts.map((p, i) => (/^_{3,}$/.test(p) ? <span key={i} className="ir-box sug inline" /> : p))}</span>;
  }
  return cell.text || null;
}
