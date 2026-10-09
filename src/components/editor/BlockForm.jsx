import TableForm from './TableForm.jsx';
import RichProseEditor from './RichProseEditor.jsx';
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

// Typed as text, with the raw HTML one click away (RichProseEditor).
function ProseForm({ block, onSave, onCancel }) {
  return (
    <RichProseEditor
      html={block.config?.html || ''}
      onSave={html => onSave({ config: { ...block.config, html } })}
      onCancel={onCancel}
    />
  );
}
