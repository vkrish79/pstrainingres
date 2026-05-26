import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizeNotesHtml, wordCountHtml } from '../../lib/notesRichText.js';

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
  open, onClose, sections, notes, saveNote, currentSectionId,
}) {
  // Per-section expand/collapse. `currentSectionId` is opened by default
  // when the drawer opens; toggleSet tracks user overrides.
  const [toggleSet, setToggleSet] = useState(() => new Set());

  // Each expanded editor registers a flush fn; on drawer close we save them all
  // (covers ×, backdrop, Esc, and the N shortcut — all just flip `open`).
  const flushersRef = useRef({});
  const register = useCallback((id, fn) => { flushersRef.current[id] = fn; }, []);
  const unregister = useCallback((id) => { delete flushersRef.current[id]; }, []);

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

  // On close: flush every open editor, then reset toggles for a clean re-open.
  useEffect(() => {
    if (!open) {
      Object.values(flushersRef.current).forEach(fn => fn());
      setToggleSet(new Set());
    }
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
          One note per exercise. Select text and use <strong>B</strong> / <em>I</em> / • to format. Saved when you close.
        </p>
        <div className="notes-drawer-body">
          {sections.map(sec => (
            <NoteCard
              key={sec.id}
              section={sec}
              note={notes[sec.id]}
              expanded={isExpanded(sec.id)}
              onToggle={() => toggle(sec.id)}
              onFlush={html => saveNote(sec.id, html)}
              isCurrent={sec.id === currentSectionId}
              register={register}
              unregister={unregister}
            />
          ))}
        </div>
      </aside>
    </>
  );
}

function NoteCard({ section, note, expanded, onToggle, onFlush, isCurrent, register, unregister }) {
  const count = wordCountHtml(note?.note || '');
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
        <NoteEditor
          section={section}
          savedHtml={note?.note || ''}
          updatedAt={note?.updated_at}
          isCurrent={isCurrent}
          onFlush={onFlush}
          register={register}
          unregister={unregister}
        />
      )}
    </div>
  );
}

// Uncontrolled contentEditable: React never owns its children. Initial HTML is
// set once via ref on mount; we read it back (sanitized) only on flush. This is
// what keeps typing responsive — no per-keystroke state/save.
function NoteEditor({ section, savedHtml, updatedAt, isCurrent, onFlush, register, unregister }) {
  const editorRef = useRef(null);

  // Mount: seed the editor and focus the current section's note.
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = sanitizeNotesHtml(savedHtml);
    if (isCurrent) {
      const t = setTimeout(() => editorRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    return undefined;
    // Mount-only: must not re-run on re-render or it would wipe the user's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save the current content if it differs from what's stored.
  function flush() {
    const el = editorRef.current;
    if (!el) return;
    const html = sanitizeNotesHtml(el.innerHTML);
    if (html !== sanitizeNotesHtml(savedHtml)) onFlush(html);
  }
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Register a stable flush wrapper for the drawer's close-flush; flush on
  // unmount too (collapsing this card).
  useEffect(() => {
    const fn = () => flushRef.current();
    register(section.id, fn);
    return () => { fn(); unregister(section.id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.id]);

  function exec(cmd) {
    document.execCommand(cmd, false, null);
    editorRef.current?.focus();
  }

  return (
    <div className="notes-card-body">
      <div className="notes-toolbar" role="toolbar" aria-label="Formatting">
        {/* preventDefault keeps the editor selection while clicking a tool */}
        <button type="button" className="notes-tool" onMouseDown={e => e.preventDefault()} onClick={() => exec('bold')} title="Bold" aria-label="Bold"><strong>B</strong></button>
        <button type="button" className="notes-tool" onMouseDown={e => e.preventDefault()} onClick={() => exec('italic')} title="Italic" aria-label="Italic"><em>I</em></button>
        <button type="button" className="notes-tool" onMouseDown={e => e.preventDefault()} onClick={() => exec('insertUnorderedList')} title="Bullet list" aria-label="Bullet list">• List</button>
      </div>
      <div
        ref={editorRef}
        className="notes-card-editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={`Notes for ${section.title}`}
        data-placeholder={promptFor(section.id)}
        onBlur={flush}
      />
      <div className="notes-card-status">
        {updatedAt && <span className="muted">{formatSavedAt(updatedAt)}</span>}
      </div>
    </div>
  );
}
