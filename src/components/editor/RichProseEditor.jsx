import { useEffect, useRef, useState } from 'react';
import { useSignedWorkbookHtml } from '../../lib/workbookImages.js';
import { canEditAsText, cleanProseHtml, serializeProse } from '../../lib/proseHtml.js';
import '../../styles/rich-prose.css';

// Prose, typed as text instead of written as HTML.
//
// A small toolbar over an editable box: bold, italic, underline, heading,
// sub-heading, normal text, bullet and numbered lists. What it saves is the
// same handful of tags the participant view already renders (lib/proseHtml.js
// rebuilds it from an allowlist; the browser's own markup is never stored).
//
// Pictures show as pictures but are saved as their storage path; the signed URL
// the box displays them with is dropped on the way out.
//
// A block whose stored HTML the box could not give back unchanged (a <pre>, a
// link, an attribute) opens on the HTML tab instead, with a note, so editing
// one sentence can never strip formatting the author did not see.
const TOOLS = [
  { cmd: 'bold', label: <b>B</b>, tip: 'Bold (Ctrl+B)' },
  { cmd: 'italic', label: <i>I</i>, tip: 'Italic (Ctrl+I)' },
  { cmd: 'underline', label: <u>U</u>, tip: 'Underline (Ctrl+U)' },
  { sep: true },
  { block: 'h3', label: 'Heading', tip: 'Heading' },
  { block: 'h4', label: 'Sub-heading', tip: 'Smaller heading' },
  { block: 'p', label: 'Text', tip: 'Normal text' },
  { sep: true },
  { cmd: 'insertUnorderedList', label: '• List', tip: 'Bulleted list' },
  { cmd: 'insertOrderedList', label: '1. List', tip: 'Numbered list' },
];

export default function RichProseEditor({ html, onSave, onCancel }) {
  const startsAsText = canEditAsText(html);
  const [mode, setMode] = useState(startsAsText ? 'text' : 'html');
  const [source, setSource] = useState(html || '');
  const [note, setNote] = useState(startsAsText ? '' : 'This text has formatting the text editor can’t show, so it opens as HTML. Edit it here and nothing is lost.');
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState({});
  const boxRef = useRef(null);
  const touched = useRef(false);

  // What the box shows: the stored HTML with signed picture URLs. Written into
  // the box until the author first types, so pictures that sign a moment
  // after opening still appear; after that the box is the author's.
  const display = useSignedWorkbookHtml(mode === 'text' ? source : '');
  useEffect(() => {
    if (mode !== 'text' || !boxRef.current || touched.current) return;
    boxRef.current.innerHTML = display;
  }, [display, mode]);

  useEffect(() => {
    if (mode !== 'text') return;
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* older browsers */ }
    const el = boxRef.current;
    if (el) {
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  }, [mode]);

  // Light up B / I / U and the list buttons for where the caret is.
  useEffect(() => {
    if (mode !== 'text') return undefined;
    const onSel = () => {
      const el = boxRef.current;
      const sel = window.getSelection();
      if (!el || !sel?.anchorNode || !el.contains(sel.anchorNode)) return;
      const next = {};
      ['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList'].forEach((c) => {
        try { next[c] = document.queryCommandState(c); } catch { next[c] = false; }
      });
      let n = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      while (n && n !== el && !/^(P|H[1-6]|LI|DIV)$/.test(n.tagName)) n = n.parentElement;
      next.block = n && n !== el ? n.tagName.toLowerCase() : 'p';
      setActive(next);
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [mode]);

  function current() {
    return mode === 'text' ? serializeProse(boxRef.current) : source;
  }

  function run(tool) {
    touched.current = true;
    boxRef.current?.focus();
    if (tool.block) document.execCommand('formatBlock', false, tool.block);
    else document.execCommand(tool.cmd, false, null);
  }

  function toHtml() {
    setSource(current());
    setNote('');
    setMode('html');
  }
  function toText() {
    if (!canEditAsText(source)) {
      setNote('This HTML has formatting the text editor can’t show. Keep editing it here, or remove that formatting first.');
      return;
    }
    touched.current = false;
    setSource(cleanProseHtml(source));
    setNote('');
    setMode('text');
  }

  async function save() {
    setBusy(true);
    await onSave(current());
    setBusy(false);
  }

  function onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  }

  // Paste as plain text: Word and web pages paste fonts, colours and spans
  // that the participant view would never show and the block should not keep.
  function onPaste(e) {
    e.preventDefault();
    touched.current = true;
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }

  return (
    <div className="block-form rte" onKeyDown={onKeyDown}>
      <div className="rte-bar" role="toolbar" aria-label="Text formatting">
        {mode === 'text' ? TOOLS.map((t, i) => (t.sep
          ? <span key={`s${i}`} className="rte-sep" aria-hidden />
          : (
            <button
              key={t.cmd || t.block}
              type="button"
              className={`rte-btn${(t.cmd && active[t.cmd]) || (t.block && active.block === t.block) ? ' on' : ''}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => run(t)}
              data-tip={t.tip}
              aria-label={t.tip}
            >
              {t.label}
            </button>
          ))) : <span className="rte-bar-note">Editing the HTML</span>}
      </div>

      {mode === 'text' ? (
        <div
          ref={boxRef}
          className="rte-area wb-prose"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Text"
          onInput={() => { touched.current = true; }}
          onPaste={onPaste}
        />
      ) : (
        <textarea
          className="form-textarea rte-source"
          rows={Math.max(6, source.split('\n').length + 1)}
          value={source}
          onChange={e => setSource(e.target.value)}
          autoFocus
        />
      )}
      {note && <p className="rte-note">{note}</p>}

      <div className="form-actions rte-foot">
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          type="button"
          className={`rte-btn rte-mode${mode === 'html' ? ' on' : ''}`}
          onMouseDown={e => e.preventDefault()}
          onClick={mode === 'text' ? toHtml : toText}
          data-tip={mode === 'text' ? 'Edit the HTML directly' : 'Back to the text editor'}
        >
          {mode === 'text' ? '‹/› HTML' : 'Aa Text'}
        </button>
        <span className="rte-hint">Ctrl+Enter saves · Esc cancels · pasted text comes in plain</span>
      </div>
    </div>
  );
}
