import '../../styles/interactive.css';
import ProseBlock from './ProseBlock.jsx';
import FieldBlock from './FieldBlock.jsx';
import TableBlock from './TableBlock.jsx';
import FillBlankBlock from './FillBlankBlock.jsx';
import CardSortBlock from './CardSortBlock.jsx';
import MatchPairsBlock from './MatchPairsBlock.jsx';
import ReorderBlock from './ReorderBlock.jsx';

// `marks` (optional): slot → mark from going over answers with the class. Only
// field and table blocks take them; absent, every block renders as before.
// `preview` — show the QUESTION, inert, rather than the answer given to it.
// `readOnly` alone means "render what was answered", which is right on a marking
// screen and wrong in a picker, where it draws an em-dash instead of the options.
// `correct` — the answer key, drawn only in a preview and only on surfaces behind
// the super-trainer gate. Never passed on a participant's path.
export default function Block({ block, value, onChange, readOnly = false, preview = false, correct = undefined, recentlyUpdated = false, marks = null, marksAudience = 'participant' }) {
  let inner;
  switch (block.block_type) {
    case 'prose': inner = <ProseBlock block={block} />; break;
    case 'field': inner = <FieldBlock block={block} value={value} onChange={onChange} readOnly={readOnly} preview={preview} correct={correct} marks={marks} marksAudience={marksAudience} />; break;
    case 'table': inner = <TableBlock block={block} value={value} onChange={onChange} readOnly={readOnly} preview={preview} marks={marks} marksAudience={marksAudience} />; break;
    case 'fill_blank': inner = <FillBlankBlock block={block} value={value} onChange={onChange} readOnly={readOnly} />; break;
    case 'card_sort': inner = <CardSortBlock block={block} value={value} onChange={onChange} readOnly={readOnly} />; break;
    case 'match_pairs': inner = <MatchPairsBlock block={block} value={value} onChange={onChange} readOnly={readOnly} />; break;
    case 'reorder': inner = <ReorderBlock block={block} value={value} onChange={onChange} readOnly={readOnly} />; break;
    default: return null;
  }
  return (
    <div className={`wb-block ${recentlyUpdated ? 'wb-block-updated' : ''}`} data-block-id={block.id}>
      {recentlyUpdated && <span className="wb-update-badge">Updated</span>}
      {inner}
    </div>
  );
}
