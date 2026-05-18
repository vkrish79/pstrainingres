import { useEffect, useMemo, useRef, useState } from 'react';
import { wordCount } from '../../lib/markdownLite.js';

// Rotating placeholders so participants who don't know what to write get a
// nudge. Deterministically picked per section so it doesn't shuffle.
const PROMPTS = [
  "Why did this exercise matter?",
  "What's the rule of thumb here?",
  "Anything the trainer said that you want to remember?",
  "How would you explain this to a teammate?",
  "What surprised you?",
  "Where might you get this wrong in practice?",
  "A question to follow up on later…",
];

function promptFor(sectionId) {
  let h = 0;
  for (let i = 0; i < sectionId.length; i++) h = (h * 31 + sectionId.charCodeAt(i)) | 0;
  return PROMPTS[Math.abs(h) % PROMPTS.length];
}

function formatSavedAt(updatedAt) {
  if (!updatedAt) return '';
  const d = new Date(updatedAt);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `Saved ${hh}:${mm}`;
}

export default function NotesDrawer({
  open, onClose, sections, notes, savingMap, saveNote, currentSectionId,
}) {
  // Per-section expand/collapse. `currentSectionId` is opened by default
  // when the drawer opens; toggleSet tracks user overrides.
  const [toggleSet, setToggleSet] = useState(() => new Set());

  function isExpanded(id) {
    const defaultOpen = id === currentSectionId;
    return toggleSet.has(id) ? !defaultOpen : defaultOpen;
  }
  function toggle(id) {
    setToggleSet(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Reset toggles when the drawer is closed so re-opening shows a clean default.
  useEffect(() => {
    if (!open) setToggleSet(new Set());
  }, [open]);

  return (
    <>
      <div
        className={`notes-drawer-backdrop ${open ? 'visible' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`notes-drawer ${open ? 'open' : ''}`}
        role="dialog"
        aria-label="My notes"
        aria-hidden={!open}
      >
        <header className="notes-drawer-head">
          <h2>📝 My notes</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close notes"
          >
            ×
          </button>
        </header>
        <p className="notes-drawer-hint">
          One note per exercise. Tip: <code>**bold**</code>, <code>_italic_</code>, <code>- bullet</code>.
        </p>
        <div className="notes-drawer-body">
          {sections.map(sec => (
            <NoteCard
              key={sec.id}
              section={sec}
              note={notes[sec.id]}
              saving={savingMap[sec.id]}
              expanded={isExpanded(sec.id)}
              onToggle={() => toggle(sec.id)}
              onChange={text => saveNote(sec.id, text)}
              isCurrent={sec.id === currentSectionId}
            />
          ))}
        </div>
      </aside>
    </>
  );
}

function NoteCard({ section, note, saving, expanded, onToggle, onChange, isCurrent }) {
  const ref = useRef(null);
  const text = note?.note || '';
  const count = useMemo(() => wordCount(text), [text]);

  // Autofocus the current section's textarea when the card is expanded.
  useEffect(() => {
    if (expanded && isCurrent && ref.current) {
      // Defer to next tick so the transition doesn't fight focus.
      const t = setTimeout(() => ref.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [expanded, isCurrent]);

  return (
    <div className={`notes-card ${expanded ? 'expanded' : 'collapsed'} ${isCurrent ? 'current' : ''}`}>
      <button
        type="button"
        className="notes-card-head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="notes-card-chevron" aria-hidden>{expanded ? '▾' : '▸'}</span>
        <span className="notes-card-title">{section.title}</span>
        {count > 0 && <span className="notes-card-count">{count} word{count === 1 ? '' : 's'}</span>}
      </button>
      {expanded && (
        <div className="notes-card-body">
          <textarea
            ref={ref}
            className="notes-card-textarea"
            value={text}
            placeholder={promptFor(section.id)}
            onChange={e => onChange(e.target.value)}
            rows={5}
          />
          <div className="notes-card-status">
            {saving === 'saving' && <span className="muted">Saving…</span>}
            {saving === 'saved' && note?.updated_at && (
              <span className="muted">{formatSavedAt(note.updated_at)}</span>
            )}
            {saving === 'error' && <span className="error">Save failed — will retry</span>}
            {!saving && note?.updated_at && (
              <span className="muted">{formatSavedAt(note.updated_at)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
