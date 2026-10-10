import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSignedWorkbookHtml } from '../../lib/workbookImages.js';
import { cleanProseHtml, serializeProse } from '../../lib/proseHtml.js';
import '../../styles/direct-edit.css';

// Direct editing for a class's own copy of a workbook (ContentEditor) and the
// trainer's practice copy (TrainerPracticeView): the wording is typed where it
// is, on a page that looks like the participant's.
//
// Every save here is LIVE for the class the moment it lands, and it is logged
// as a session change that will turn up for review on the master. So:
//   - a save happens only when the text was actually typed in (never because a
//     browser re-wrapped whitespace), when you click away or press Enter;
//   - each save says so, with Undo for a few seconds;
//   - Esc throws an edit away before it saves.
//
// EditToastProvider holds the "Saved · Undo" note and the formatting bar that
// appears over a text selection in prose. Without a provider the editing still
// works; there is just no note.

const ToastCtx = createContext(null);

export function EditToastProvider({ children }) {
  const [toast, setToast] = useState(null); // { msg, undo? }
  const timer = useRef(null);

  const show = useCallback((msg, undo = null) => {
    clearTimeout(timer.current);
    setToast({ msg, undo });
    timer.current = setTimeout(() => setToast(null), undo ? 6000 : 3000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <SelectionBar />
      {toast && createPortal(
        <div className="de-toast" role="status">
          <span>{toast.msg}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => { const u = toast.undo; u(); show('Undone · the class sees the old wording again'); }}
            >
              Undo
            </button>
          )}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

function useSavedNote() {
  return useContext(ToastCtx) || (() => {});
}

const SAVED = 'Saved · live for the class';

// Runs a save and reports a refusal. A save that fails must not leave the new
// wording on screen looking saved — in a live class that is worse than an
// error — so onFail puts the old wording back.
function runSave(save, value, onFail, note) {
  Promise.resolve()
    .then(() => save(value))
    .then((res) => { if (res?.error) throw res.error; })
    .catch((err) => { onFail(); note(`Not saved — ${err?.message || 'the change could not be stored'}. The old wording is back.`); });
}

// ── Plain wording: labels, options, table text ──────────────────────────
// These are plain strings in the block's config, so they take no formatting.
//
// The span is always editable (contentEditable="plaintext-only"), so a click
// puts the caret exactly where you clicked. React does not render into it while
// you type: after each edit the span is remounted (key) from the saved value,
// which is what keeps React and the browser from fighting over its text.
export function InlineText({ value, onSave, placeholder = '', multiline = false, label = 'Text', className = '' }) {
  const current = value ?? '';
  const [optimistic, setOptimistic] = useState(null);
  const [ver, setVer] = useState(0);
  const [edited, setEdited] = useState(false);
  const shown = optimistic ?? current;
  const note = useSavedNote();
  const before = useRef('');
  const dirty = useRef(false);
  const cancelled = useRef(false);
  // Undo runs seconds later, possibly after another line of the same block was
  // saved, so it must use the newest onSave (built from the newest config).
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    if (optimistic !== null && current === optimistic) setOptimistic(null);
  }, [current, optimistic]);

  function read(el) {
    let t = (el.innerText || '').replace(/\u00a0/g, ' ');
    if (!multiline) t = t.replace(/\n/g, ' ');
    return t.replace(/\n$/, '');
  }

  function onBlur(e) {
    const next = read(e.currentTarget);
    const was = before.current;
    const changed = dirty.current && !cancelled.current && next !== was;
    dirty.current = false;
    cancelled.current = false;
    if (changed) {
      setOptimistic(next);
      setEdited(true);
      note(SAVED, () => { setOptimistic(was); setEdited(false); runSave(saveRef.current, was, () => {}, note); setVer(v => v + 1); });
      runSave(saveRef.current, next, () => { setOptimistic(null); setEdited(false); setVer(v => v + 1); }, note);
    }
    setVer(v => v + 1);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); cancelled.current = true; e.currentTarget.blur(); return; }
    if (e.key === 'Enter' && !(multiline && e.shiftKey)) { e.preventDefault(); e.currentTarget.blur(); return; }
    // Plain text in the data: no bold or italic to give it.
    if ((e.ctrlKey || e.metaKey) && /^[biu]$/i.test(e.key)) e.preventDefault();
  }

  function onPaste(e) {
    e.preventDefault();
    let text = e.clipboardData.getData('text/plain');
    if (!multiline) text = text.replace(/\s*\n\s*/g, ' ');
    document.execCommand('insertText', false, text);
  }

  return (
    <span
      key={ver}
      className={`de-text${edited ? ' de-edited' : ''}${multiline ? ' de-multi' : ''} ${className}`}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      aria-multiline={multiline ? 'true' : undefined}
      data-placeholder={placeholder}
      spellCheck
      onFocus={() => { before.current = shown; dirty.current = false; cancelled.current = false; }}
      onInput={() => { dirty.current = true; }}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    >
      {shown}
    </span>
  );
}

// ── Prose: formatted text, typed in place ───────────────────────────────
// The block's HTML is shown with signed picture URLs and edited as it stands.
// What is saved is rebuilt from the allowlist in lib/proseHtml.js, so the
// browser's own markup and the signed URLs never reach the block. Only blocks
// that pass canEditAsText() come here; the caller sends the rest to the panel.
export function InlineProse({ html, onSave }) {
  const [optimistic, setOptimistic] = useState(null);
  const [edited, setEdited] = useState(false);
  const [reset, setReset] = useState(0); // bumped to rewrite the box from `display`
  const source = optimistic ?? html ?? '';
  const display = useSignedWorkbookHtml(source);
  const ref = useRef(null);
  const editing = useRef(false);
  const dirty = useRef(false);
  const cancelled = useRef(false);
  const note = useSavedNote();
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    if (optimistic !== null && html === optimistic) setOptimistic(null);
  }, [html, optimistic]);

  // Written by hand, and never while you are typing: a picture's signed URL
  // arriving mid-edit must not wipe what you have typed.
  useLayoutEffect(() => {
    if (ref.current && !editing.current) ref.current.innerHTML = display || '';
  }, [display, reset]);

  function onFocus() {
    editing.current = true;
    dirty.current = false;
    cancelled.current = false;
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* older browsers */ }
  }

  function onBlur() {
    editing.current = false;
    const el = ref.current;
    if (!el) return;
    const was = source;
    if (cancelled.current || !dirty.current) {
      cancelled.current = false;
      el.innerHTML = display || '';
      return;
    }
    dirty.current = false;
    const next = serializeProse(el);
    // Compared on the saved form, so markup the browser merely re-wrote is not
    // an edit.
    if (next === cleanProseHtml(was)) { el.innerHTML = display || ''; return; }
    setOptimistic(next);
    setEdited(true);
    note(SAVED, () => { setOptimistic(was); setEdited(false); runSave(saveRef.current, was, () => {}, note); });
    runSave(saveRef.current, next, () => {
      setOptimistic(null);
      setEdited(false);
      // The box still holds what was typed; put the stored text back.
      setReset(r => r + 1);
    }, note);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); cancelled.current = true; e.currentTarget.blur(); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.blur(); }
  }

  // Plain text in: Word and web pages paste fonts and spans the participant
  // view would never show.
  function onPaste(e) {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  }

  return (
    <div
      ref={ref}
      className={`wb-prose de-rich${edited ? ' de-edited' : ''}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Text"
      data-placeholder="(empty — click to type)"
      onFocus={onFocus}
      onBlur={onBlur}
      onInput={() => { dirty.current = true; }}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    />
  );
}

// ── The bar over a selection in prose ───────────────────────────────────
// Appears only when text is selected inside a prose block being edited, so it
// is never in the way of reading. Its buttons keep the focus where it is
// (mousedown is cancelled), so using it is not "clicking away" and does not save.
const TOOLS = [
  { cmd: 'bold', label: <b>B</b>, tip: 'Bold (Ctrl+B)' },
  { cmd: 'italic', label: <i>I</i>, tip: 'Italic (Ctrl+I)' },
  { cmd: 'insertUnorderedList', label: '• List', tip: 'Bulleted list' },
  { cmd: 'insertOrderedList', label: '1. List', tip: 'Numbered list' },
];

function SelectionBar() {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const onSel = () => {
      const s = window.getSelection();
      const host = s?.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement)?.closest('.de-rich');
      if (!s || s.isCollapsed || !s.rangeCount || !host || document.activeElement !== host) { setPos(null); return; }
      const r = s.getRangeAt(0).getBoundingClientRect();
      if (!r.width && !r.height) { setPos(null); return; }
      setPos({ top: Math.max(8, r.top - 40), left: Math.max(8, r.left + r.width / 2 - 80) });
    };
    document.addEventListener('selectionchange', onSel);
    window.addEventListener('scroll', onSel, true);
    return () => { document.removeEventListener('selectionchange', onSel); window.removeEventListener('scroll', onSel, true); };
  }, []);
  if (!pos) return null;
  return createPortal(
    <div className="de-selbar" role="toolbar" aria-label="Format the selected text" style={{ top: pos.top, left: pos.left }}>
      {TOOLS.map(t => (
        <button
          key={t.cmd}
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => document.execCommand(t.cmd, false, null)}
          aria-label={t.tip}
          data-tip={t.tip}
        >
          {t.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
