import { useEffect, useRef, useState } from 'react';
import '../../styles/settings-lists.css';

// The shared frame for the Settings lists (Program types, Cities & venues,
// Vendors, Staff): heading, at-a-glance row, toolbar, list, slide-over and
// toast. One frame so the four can't drift apart again; every gap lives in
// settings-lists.css as one of three spacing steps.

export function SettingsFrame({ title, note, addLabel, onAdd, glance, toolbar, notice, children }) {
  return (
    <section className="stl" aria-labelledby="stl-title">
      <div className="stl-head">
        <div className="stl-head-text">
          <h2 id="stl-title">{title}</h2>
          {note && <p>{note}</p>}
        </div>
        {addLabel && <button type="button" onClick={onAdd}>{addLabel}</button>}
      </div>
      {glance && <div className="stl-glance">{glance}</div>}
      {notice}
      {toolbar && <div className="stl-toolbar">{toolbar}</div>}
      {children}
    </section>
  );
}

// One at-a-glance box. `alert` puts the amber edge on it when value > 0.
export function Glance({ label, value, hint, alert = false }) {
  return (
    <div className={`stl-g${alert && value ? ' is-alert' : ''}`}>
      <span className="stl-g-k">{label}</span>
      <span className="stl-g-v">{value}</span>
      <span className="stl-g-h">{hint || ' '}</span>
    </div>
  );
}

// options: [{ id, label, count }]
export function FilterChips({ options, value, onChange, label = 'Show' }) {
  return (
    <span className="stl-chips" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}<b>{o.count}</b>
        </button>
      ))}
    </span>
  );
}

export function SearchBox({ value, onChange, placeholder }) {
  return (
    <input
      type="search"
      className="form-input stl-search"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
    />
  );
}

// The list: a header row and rows laid out on the same grid. `columns` is a
// grid-template-columns value; `head` the column titles.
export function SettingsList({ columns, head, children }) {
  return (
    <div className="stl-list" role="table" style={{ '--stl-cols': columns }}>
      <div className="stl-row stl-lhead" role="row">
        {head.map((h, i) => <span key={i} role="columnheader">{h}</span>)}
      </div>
      {children}
    </div>
  );
}
export function ListRow({ off = false, children, ...rest }) {
  return <div className={`stl-row${off ? ' is-off' : ''}`} role="row" {...rest}>{children}</div>;
}
export function ListGroup({ title }) {
  return <div className="stl-group" role="row"><span role="cell">{title}</span></div>;
}
export function ListEmpty({ children }) {
  return <div className="stl-empty" role="row"><span role="cell">{children}</span></div>;
}

// Asked in the page, directly under the row it is about (was ConfirmRow, which
// needed a table). The button says what it does, never "OK".
export function RowConfirm({ message, confirmLabel, onConfirm, onCancel, busy = false }) {
  return (
    <div className="stl-confirm" role="group" aria-label="Confirm">
      <span className="stl-confirm-text">{message}</span>
      <span className="stl-confirm-actions">
        <button type="button" className="stl-danger" onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>Keep</button>
      </span>
    </div>
  );
}

// Drag handle that also reorders from the keyboard: ↑ / ↓ while it has focus.
export function Grip({ label, onKeyMove, ...dragProps }) {
  return (
    <button
      type="button"
      className="stl-grip"
      aria-label={`${label}. Drag, or press up or down, to move it.`}
      data-tip="Drag to reorder"
      onKeyDown={e => {
        if (e.key === 'ArrowUp') { e.preventDefault(); onKeyMove('up'); }
        if (e.key === 'ArrowDown') { e.preventDefault(); onKeyMove('down'); }
      }}
      {...dragProps}
    >⠿</button>
  );
}

// Slide-over for add / edit. Esc and the scrim close it; focus goes to the
// first field and back to what opened it.
export function SlideOver({ title, sub, onClose, onSubmit, submitLabel, busy = false, submitDisabled = false, error, children }) {
  const panelRef = useRef(null);
  useEffect(() => {
    const back = document.activeElement;
    const first = panelRef.current?.querySelector('input:not([disabled]), select:not([disabled])');
    first?.focus();
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); back?.focus?.(); };
  }, [onClose, busy]);
  return (
    <>
      <div className="stl-scrim" onClick={() => !busy && onClose()} />
      <aside className="stl-drawer" role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <header className="stl-drawer-head">
          <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
          <button type="button" className="stl-x" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </header>
        <form className="stl-drawer-body" id="stl-form" onSubmit={e => { e.preventDefault(); onSubmit(); }} noValidate>
          {children}
          {error && <p className="error" role="alert">{error}</p>}
        </form>
        <footer className="stl-drawer-foot">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="stl-form" disabled={busy || submitDisabled}>{busy ? 'Saving…' : submitLabel}</button>
        </footer>
      </aside>
    </>
  );
}

// One labelled field. Every field here is required, so every label carries
// the mark; `help` says the rule up front, `error` says what is wrong.
export function Field({ id, label, help, error, children }) {
  return (
    <div className="stl-field">
      <label htmlFor={id}>{label} <span className="stl-req" aria-hidden="true">*</span></label>
      {children}
      {help && <span className="stl-help">{help}</span>}
      {error && <span className="stl-err">{error}</span>}
    </div>
  );
}

// "Deactivated Certification · Undo" at the bottom of the window.
export function useSettingsToast() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const node = toast && (
    <div className="stl-toast" role="status">
      <span>{toast.text}</span>
      {toast.undo && <button type="button" onClick={() => { toast.undo(); setToast(null); }}>Undo</button>}
    </div>
  );
  return { show: (text, undo) => setToast({ text, undo }), node };
}

// Reorder by drag. Each step is the list's existing move(id, 'up'|'down'),
// so the order is stored exactly as the ↑ ↓ buttons used to store it.
export function useDragReorder(items, move, onError) {
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  async function moveTo(id, targetId) {
    const from = items.findIndex(x => x.id === id);
    const to = items.findIndex(x => x.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const dir = to > from ? 'down' : 'up';
    for (let i = 0; i < Math.abs(to - from); i++) {
      const { error } = await move(id, dir);
      if (error) { onError?.(error.message); return; }
    }
  }
  const gripProps = item => ({
    draggable: true,
    onDragStart: e => { setDragId(item.id); e.dataTransfer.effectAllowed = 'move'; },
    onDragEnd: () => { setDragId(null); setOverId(null); },
  });
  const rowProps = item => ({
    onDragOver: e => { if (dragId) { e.preventDefault(); setOverId(item.id); } },
    onDrop: e => { e.preventDefault(); if (dragId) moveTo(dragId, item.id); setDragId(null); setOverId(null); },
    'data-drop': overId === item.id && dragId !== item.id ? 'true' : undefined,
    'data-dragging': dragId === item.id ? 'true' : undefined,
  });
  return { gripProps, rowProps };
}

export const plural = (n, w, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
