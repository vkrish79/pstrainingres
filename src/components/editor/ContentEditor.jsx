import { useRef, useState } from 'react';
import '../../styles/workbook.css';
import '../../styles/editor.css';
import { useSignedWorkbookHtml } from '../../lib/workbookImages.js';
import { ImageCell } from '../blocks/WbImage.jsx';
import RichProseEditor from './RichProseEditor.jsx';
import { EditToastProvider, InlineProse, InlineText } from './DirectEdit.jsx';
import { canEditAsText } from '../../lib/proseHtml.js';
import { isInteractiveBlock } from '../../lib/interactiveBlocks.js';
import Block from '../blocks/Block.jsx';

// Content-only editor for SESSION-level workbook edits (is_template=false).
// Renders the workbook like the participant view, and the *authored* text —
// prose, field labels, option wording, table captions/headers/text cells — is
// typed into where it stands (DirectEdit.jsx). Answer fields and all structure
// (rows, columns, blocks, sections) are locked. Saves go through
// onSaveBlock(blockId, { config }), and each one is live for the class.
export default function ContentEditor({ sections, blocks, onSaveBlock }) {
  return (
    <EditToastProvider>
    <div className="ce-doc">
      <p className="ce-hint">✎ Click any wording and type. It saves when you click away and the class sees it straight away; Undo appears for a few seconds, Esc throws an edit away. Answer boxes and the layout are fixed here — change those on the master.</p>
      {sections.map(sec => {
        const secBlocks = blocks
          .filter(b => b.section_id === sec.id)
          .sort((a, b) => a.order_index - b.order_index);
        const isGroup = sec.kind === 'group';
        return (
          <section key={sec.id} className={`wb-section ce-section${isGroup ? ' wb-section-group' : ''}`}>
            {isGroup ? <h1 className="wb-section-group-title">{sec.title}</h1> : <h2>{sec.title}</h2>}
            {secBlocks.length === 0 && !isGroup && <p className="muted">No content in this exercise.</p>}
            {secBlocks.map(b => (
              <div key={b.id} className="wb-block">
                <EditableBlock block={b} onSave={config => onSaveBlock(b.id, { config })} />
              </div>
            ))}
          </section>
        );
      })}
    </div>
    </EditToastProvider>
  );
}

// Per-block inline content editor. onSave receives the full new config object.
// Exported so the trainer copy (TrainerPracticeView) and a class's assessment
// copy (TrainerAssessmentPreview) can drop it into their own layout behind an
// Edit toggle, sharing one editing UI with the editor page.
//
// lockOptions: an assessment marks a choice by comparing the option's TEXT with
// the answer key (assessmentScoring.js), and trainers cannot edit keys. So in an
// assessment copy option wording is shown, locked, never typed into.
export function EditableBlock({ block, onSave, lockOptions = false }) {
  const save = useQueuedConfigSave(block, onSave);
  if (block.block_type === 'prose') return <ProseEdit block={block} save={save} />;
  if (block.block_type === 'field') return <FieldEdit block={block} save={save} lockOptions={lockOptions} />;
  if (block.block_type === 'table') return <TableEdit block={block} save={save} />;
  if (isInteractiveBlock(block)) return <InteractiveEdit block={block} save={save} />;
  return null;
}

// Fill-blank, card sort, match, reorder: the instruction above the cards is
// wording and is typed into; the cards, blanks and pairs are what the answer
// key is built from, so they are drawn read-only.
function InteractiveEdit({ block, save }) {
  const cfg = block.config || {};
  return (
    <div className="wb-field">
      <div className="wb-label">
        <InlineText value={cfg.prompt || ''} onSave={v => save(c => ({ ...c, prompt: v }))} placeholder="(instruction)" label="Instruction" />
      </div>
      <div className="ce-locked-interactive" data-tip={LOCKED_CARDS_TIP}>
        <Block block={{ ...block, config: { ...cfg, prompt: '' } }} value={undefined} onChange={() => {}} readOnly />
      </div>
    </div>
  );
}

// Every save sends the WHOLE config, so two saves in one block must not each
// be built from the config as last rendered: save a label, then an option
// before the first reply re-renders, and the second save put the old label
// back. Edits are queued per block instead, and each is applied — as a
// change, `config => newConfig` — to the config the previous save left.
// A failed save is dropped from that base, so the edits behind it do not
// carry it to the database after the field has shown the old wording again.
function useQueuedConfigSave(block, onSave) {
  const base = useRef(block.config || {});
  const queue = useRef(Promise.resolve());
  const pending = useRef(0);
  // Idle: the block as rendered is the truth (it may have changed elsewhere).
  if (pending.current === 0) base.current = block.config || {};

  return (change) => {
    pending.current += 1;
    const run = queue.current
      .then(async () => {
        const next = change(base.current);
        let res;
        try {
          res = await onSave(next);
        } catch (err) {
          res = { error: err };
        }
        if (!res?.error) base.current = res?.data?.config ?? next;
        return res;
      })
      .finally(() => { pending.current -= 1; });
    queue.current = run.catch(() => {});
    return run;
  };
}

// Prose stores HTML and is typed into where it stands (InlineProse), saved
// from the same allowlist as the master editor's text editor. A block that
// would not come back unchanged — a link, a styled paragraph — is the one
// exception: clicking it opens the editing panel on its HTML tab, so editing
// one sentence can never strip formatting nobody saw.
function ProseEdit({ block, save }) {
  const html = block.config?.html || '';
  if (canEditAsText(html)) {
    return <InlineProse html={html} onSave={next => save(c => ({ ...c, html: next }))} />;
  }
  return <ProsePanelEdit block={block} save={save} />;
}

function ProsePanelEdit({ block, save }) {
  const html = block.config?.html || '';
  const [editing, setEditing] = useState(false);
  // Display only: the signed URLs never reach the saved block.
  const shown = useSignedWorkbookHtml(html);

  if (editing) {
    return (
      <div className="ce-prose-edit">
        <RichProseEditor
          html={html}
          onSave={async (next) => {
            if (next !== html) await save(c => ({ ...c, html: next }));
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }
  return (
    <div
      className="wb-prose ce-editable ce-prose"
      data-tip="This text has formatting that is edited as HTML — click to open it"
      tabIndex={0}
      role="button"
      onClick={() => setEditing(true)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setEditing(true); } }}
      dangerouslySetInnerHTML={{ __html: shown || '<p class="ce-empty">(empty — click to edit)</p>' }}
    />
  );
}

function FieldEdit({ block, save, lockOptions }) {
  const cfg = block.config || {};
  const { label, input_type, options } = cfg;
  const saveLabel = v => save(c => ({ ...c, label: v }));
  const saveOpt = (i, v) => save(c => ({ ...c, options: (c.options || []).map((o, idx) => (idx === i ? v : o)) }));

  // short_text / long_text — editable label + a locked answer placeholder.
  if (input_type === 'short_text' || input_type === 'long_text') {
    return (
      <div className="wb-field">
        <div className="wb-label"><InlineText value={label} onSave={saveLabel} placeholder="(label)" label="Question" /></div>
        <div className="wb-readonly empty ce-locked" data-tip={LOCKED_TIP}>—</div>
      </div>
    );
  }

  // choice / check_group — editable legend + editable option wording, locked control.
  return (
    <div className="wb-field">
      <fieldset className="wb-fieldset">
        <legend className="wb-label"><InlineText value={label} onSave={saveLabel} placeholder="(label)" label="Question" /></legend>
        {(options || []).map((opt, i) => (
          <div key={i} className="wb-choice ce-choice">
            <input type={input_type === 'choice' ? 'radio' : 'checkbox'} disabled className="ce-locked-control" />
            {lockOptions
              ? <span className="ce-locked-option" data-tip={LOCKED_OPTION_TIP}>{opt}</span>
              : <span><InlineText value={opt} onSave={v => saveOpt(i, v)} placeholder="(option)" label="Option" /></span>}
          </div>
        ))}
      </fieldset>
    </div>
  );
}

function TableEdit({ block, save }) {
  const cfg = block.config || {};
  const headers = Array.isArray(cfg.headers) ? cfg.headers : null;
  const rows = Array.isArray(cfg.rows) ? cfg.rows : [];

  const saveCaption = v => save(c => {
    const next = { ...c };
    if (v.trim()) next.caption = v; else delete next.caption;
    return next;
  });
  const saveHeader = (i, v) => save(c => ({ ...c, headers: (c.headers || []).map((h, idx) => (idx === i ? v : h)) }));
  const saveCell = (ri, ci, v) => save(c => ({
    ...c,
    rows: (c.rows || []).map((row, r) => (r === ri ? row.map((cell, j) => (j === ci ? { ...cell, text: v } : cell)) : row)),
  }));
  // Wording around answer boxes. Each run of text between boxes is edited on
  // its own and the boxes are drawn as boxes, fixed, so an edit can never add
  // or drop one and orphan a participant's answer from it.
  const saveMixedPart = (ri, ci, k, v) => save(c => ({
    ...c,
    rows: (c.rows || []).map((row, r) => (r === ri ? row.map((cell, j) => (j === ci
      ? { ...cell, parts: (cell.parts || []).map((p, i) => (i === k ? { ...p, text: v } : p)) }
      : cell)) : row)),
  }));

  return (
    <div className="wb-table-wrap">
      {cfg.caption ? (
        <div className="wb-table-caption">
          <InlineText value={cfg.caption} onSave={saveCaption} placeholder="(caption)" label="Caption" />
        </div>
      ) : null}
      <table className="wb-table">
        {headers && (
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}><InlineText value={h} onSave={v => saveHeader(i, v)} placeholder="(header)" label="Column heading" /></th>
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
                  className={cell.kind === 'input' ? 'wb-cell-input' : cell.kind === 'mixed' ? 'wb-cell-static wb-cell-mixed' : 'wb-cell-static'}
                  colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                >
                  {cell.kind === 'static' ? (
                    <InlineText value={cell.text || ''} onSave={v => saveCell(ri, ci, v)} placeholder="(empty)" multiline label="Table text" />
                  ) : cell.kind === 'image' ? (
                    <ImageCell cell={cell} />
                  ) : cell.kind === 'mixed' ? (
                    <span className="de-mixed">
                      {(cell.parts || []).map((part, k) => (part.kind === 'box' ? (
                        <span key={k} className="de-box" data-tip={LOCKED_TIP} />
                      ) : (
                        <InlineText key={k} value={part.text || ''} onSave={v => saveMixedPart(ri, ci, k, v)} label="Table text" />
                      )))}
                    </span>
                  ) : (
                    <span className="de-box de-box--wide" data-tip={LOCKED_TIP} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LOCKED_TIP = 'Answer box — fixed in a class copy. Change it on the master.';
const LOCKED_OPTION_TIP = 'Answer option — locked. Answers are marked by matching this exact text against the answer key.';
const LOCKED_CARDS_TIP = 'Cards and blanks — locked. The answer key is built from them; change them on the master.';
