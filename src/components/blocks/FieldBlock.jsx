export default function FieldBlock({ block, value, onChange, readOnly = false }) {
  const { label, input_type, options } = block.config || {};

  if (input_type === 'short_text' || input_type === 'long_text') {
    const Tag = input_type === 'long_text' ? 'textarea' : 'input';
    if (readOnly) {
      const v = (value || '').toString();
      return (
        <div className="wb-field">
          <label className="wb-label">{label}</label>
          <div className={`wb-readonly ${v ? '' : 'empty'}`}>{v || '—'}</div>
        </div>
      );
    }
    return (
      <div className="wb-field">
        <label className="wb-label">{label}</label>
        <Tag
          {...(input_type === 'long_text' ? { rows: 6 } : { type: 'text' })}
          className={input_type === 'long_text' ? 'wb-textarea' : 'wb-input'}
          value={value || ''}
          onChange={e => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (input_type === 'choice') {
    if (readOnly) {
      return (
        <div className="wb-field">
          <div className="wb-label">{label}</div>
          <div className={`wb-readonly ${value ? '' : 'empty'}`}>{value || '—'}</div>
        </div>
      );
    }
    return (
      <div className="wb-field">
        <fieldset className="wb-fieldset">
          <legend className="wb-label">{label}</legend>
          {(options || []).map(opt => (
            <label key={opt} className="wb-choice">
              <input
                type="radio"
                name={block.id}
                value={opt}
                checked={value === opt}
                onChange={e => onChange(e.target.value)}
              />
              <span>{opt}</span>
            </label>
          ))}
        </fieldset>
      </div>
    );
  }

  if (input_type === 'check_group') {
    const arr = Array.isArray(value) ? value : [];
    if (readOnly) {
      return (
        <div className="wb-field">
          <div className="wb-label">{label}</div>
          <div className={`wb-readonly ${arr.length ? '' : 'empty'}`}>
            {arr.length ? arr.join(', ') : '—'}
          </div>
        </div>
      );
    }
    function toggle(opt) {
      onChange(arr.includes(opt) ? arr.filter(x => x !== opt) : [...arr, opt]);
    }
    return (
      <div className="wb-field">
        <fieldset className="wb-fieldset">
          <legend className="wb-label">{label}</legend>
          {(options || []).map(opt => (
            <label key={opt} className="wb-choice">
              <input
                type="checkbox"
                checked={arr.includes(opt)}
                onChange={() => toggle(opt)}
              />
              <span>{opt}</span>
            </label>
          ))}
        </fieldset>
      </div>
    );
  }

  return null;
}
