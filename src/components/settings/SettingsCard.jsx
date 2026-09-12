import KebabMenu from '../KebabMenu.jsx';

// The frame every managed list on Settings shares: title, one line of
// explanation, and an add form that stays folded away until it is wanted.
//
// It exists because Program types and Cities are the same screen twice, and
// they had drifted apart in spacing and wording. One frame keeps them honest.
export function SettingsCard({ title, note, addLabel, addOpen, onToggleAdd, addForm, children }) {
  return (
    <section className="editor-card settings-card">
      <div className="settings-card-head">
        <div className="settings-card-title">
          <h2 className="section-title" style={{ margin: 0 }}>{title}</h2>
          {note && <p className="muted settings-card-note">{note}</p>}
        </div>
        {addLabel && (
          <button type="button" className="ghost" onClick={onToggleAdd}>
            {addOpen ? 'Cancel' : addLabel}
          </button>
        )}
      </div>
      {addOpen && addForm && <div className="settings-add">{addForm}</div>}
      {children}
    </section>
  );
}

// Up / down on one line. Two stacked buttons made every row twice as tall as
// its content.
export function OrderButtons({ index, count, onMove, disabled }) {
  return (
    <span className="order-btns">
      <button type="button" className="ghost btn-xs" title="Move up"
        disabled={disabled || index === 0} onClick={() => onMove('up')}>↑</button>
      <button type="button" className="ghost btn-xs" title="Move down"
        disabled={disabled || index === count - 1} onClick={() => onMove('down')}>↓</button>
    </span>
  );
}

// Rename / activate, behind the same ⋯ the participant rows use. Two buttons
// on every row, on every list, was the loudest thing on this page.
export function RowActions({ label, isActive, onEdit, onToggleActive }) {
  return (
    <KebabMenu
      label={label}
      items={[
        { label: 'Rename…', glyph: '✎', onClick: onEdit },
        { separator: true },
        isActive
          ? { label: 'Deactivate', glyph: '⊘', onClick: onToggleActive }
          : { label: 'Activate', glyph: '↺', onClick: onToggleActive },
      ]}
    />
  );
}

// The inline rename editor, identical on both lists.
export function NameEditor({ value, onChange, onSave, onCancel }) {
  return (
    <span className="settings-edit">
      <input
        className="form-input"
        value={value}
        autoFocus
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && value.trim()) onSave();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <button type="button" className="btn-xs" onClick={onSave} disabled={!value.trim()}>Save</button>
      <button type="button" className="ghost btn-xs" onClick={onCancel}>Cancel</button>
    </span>
  );
}
