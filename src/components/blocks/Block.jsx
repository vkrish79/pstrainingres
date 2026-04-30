import ProseBlock from './ProseBlock.jsx';
import FieldBlock from './FieldBlock.jsx';
import TableBlock from './TableBlock.jsx';

export default function Block({ block, value, onChange, readOnly = false, recentlyUpdated = false }) {
  let inner = null;
  switch (block.block_type) {
    case 'prose': inner = <ProseBlock block={block} />; break;
    case 'field': inner = <FieldBlock block={block} value={value} onChange={onChange} readOnly={readOnly} />; break;
    case 'table': inner = <TableBlock block={block} value={value} onChange={onChange} readOnly={readOnly} />; break;
    default: return null;
  }
  return (
    <div className={`wb-block ${recentlyUpdated ? 'wb-block-updated' : ''}`}>
      {recentlyUpdated && <span className="wb-update-badge">Updated</span>}
      {inner}
    </div>
  );
}
