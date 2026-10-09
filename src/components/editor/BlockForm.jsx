import { useState } from 'react';
import TableForm from './TableForm.jsx';
import FieldForm from './FieldForm.jsx';
import { FillBlankForm, ReorderForm, CardSortForm, MatchPairsForm } from './InteractiveForms.jsx';

// answerKey / canSetAnswer are only meaningful in an assessment or a question
// bank, where a question has a correct answer at all. A workbook passes neither,
// so its form is exactly as it was.
export default function BlockForm({ block, onSave, onCancel, answerKey = undefined, canSetAnswer = false }) {
  if (block.block_type === 'prose') return <ProseForm block={block} onSave={onSave} onCancel={onCancel} />;
  if (block.block_type === 'field') {
    return (
      <FieldForm
        block={block}
        onSave={onSave}
        onCancel={onCancel}
        answerKey={answerKey}
        canSetAnswer={canSetAnswer}
      />
    );
  }
  if (block.block_type === 'table') return <TableForm block={block} onSave={onSave} onCancel={onCancel} />;
  // THE FOUR INTERACTIVE TYPES NOW TAKE THE KEY TOO. They did not, so their
  // forms told the author to go and use an "Answer key" panel — which is on
  // the assessment editor but has never been on the question bank. In a bank,
  // a drag-and-drop question therefore had nowhere at all to record its
  // answer, and the hint pointed at a control that was not on the page.
  const keyProps = { answerKey, canSetAnswer };
  if (block.block_type === 'fill_blank') return <FillBlankForm block={block} onSave={onSave} onCancel={onCancel} {...keyProps} />;
  if (block.block_type === 'card_sort') return <CardSortForm block={block} onSave={onSave} onCancel={onCancel} {...keyProps} />;
  if (block.block_type === 'match_pairs') return <MatchPairsForm block={block} onSave={onSave} onCancel={onCancel} {...keyProps} />;
  if (block.block_type === 'reorder') return <ReorderForm block={block} onSave={onSave} onCancel={onCancel} {...keyProps} />;
  return null;
}

function ProseForm({ block, onSave, onCancel }) {
  const [html, setHtml] = useState(block.config?.html || '');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    await onSave({ config: { ...block.config, html } });
    setBusy(false);
  }
  return (
    <div className="block-form">
      <label className="form-label">HTML content</label>
      <textarea
        className="form-textarea"
        rows="6"
        value={html}
        onChange={e => setHtml(e.target.value)}
      />
      <p className="hint">Supports basic HTML — <code>&lt;p&gt;</code>, <code>&lt;h3&gt;</code>, <code>&lt;h4&gt;</code>, <code>&lt;ul&gt;</code>/<code>&lt;li&gt;</code>, <code>&lt;strong&gt;</code>, <code>&lt;em&gt;</code>.</p>
      <div className="form-actions">
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
