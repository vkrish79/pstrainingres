import { useState } from 'react';
import '../../styles/interactive.css';
import { parseFillBlank, newItemId } from '../../lib/interactiveBlocks.js';

// ── Marking the correct answer, on the question itself ──────────────────────
//
// The controls below are bound to the form's LIVE items, never to
// block.config. A separate panel could read the saved block because by then it
// was saved; here a card you have only just typed has to be assignable before
// you press Save, and a card you rename has to show its new wording beside its
// own select. Reading block.config would show the stale one.
function InlineKey({ children, note, missing = 0 }) {
  return (
    <div className="inline-key">
      <div className="inline-key-head">
        Correct answer
        {missing > 0 && (
          <span className="inline-key-todo">{missing} still to set</span>
        )}
      </div>
      {children}
      {note && <p className="hint inline-key-note">{note}</p>}
    </div>
  );
}

// Keep only the ids that still exist, and only non-empty values.
//
// Deleting a card otherwise leaves a key entry for a card nobody can be asked
// about — which quietly inflates the denominator that partial credit divides
// by, since a mark is a fraction of the KEYED slots. Returns null, not {}, when
// nothing is set: null is this form's "clear the stored key", and a key row
// holding an empty object would claim the question is marked automatically
// when it cannot be.
function pruneKeyMap(map, liveIds) {
  const out = {};
  for (const id of liveIds) {
    const v = map?.[id];
    if (v != null && `${v}`.trim() !== '') out[id] = typeof v === 'string' ? v.trim() : v;
  }
  return Object.keys(out).length ? out : null;
}

// An object-shaped key read back off the row, defended against the array and
// string shapes the other block types store.
function asKeyMap(answerKey) {
  return answerKey && typeof answerKey === 'object' && !Array.isArray(answerKey) ? answerKey : {};
}

// ── Interactive question editors ──────────────────────────────────────────
// These edit the question's *content* only. Correct answers are set in the
// Answer key panel (kept out of config so participants can't read them).

// A small reusable editor for an ordered list of {id, text} entries.
function ItemRowsEditor({ items, setItems, textKey = 'text', placeholder = 'Item', allowReorder = true }) {
  const setText = (i, v) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [textKey]: v } : it));
  const add = () => setItems(prev => [...prev, { id: newItemId(), [textKey]: '' }]);
  const remove = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const move = (i, dir) => setItems(prev => {
    const next = [...prev];
    const j = i + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  return (
    <div className="options-editor">
      {items.map((it, i) => (
        <div key={it.id} className="option-row">
          {allowReorder && <span className="muted" style={{ minWidth: '1.4rem', textAlign: 'right' }}>{i + 1}.</span>}
          <input className="form-input" value={it[textKey] || ''} placeholder={placeholder} onChange={e => setText(i, e.target.value)} />
          {allowReorder && (
            <>
              <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down">↓</button>
            </>
          )}
          <button className="ghost danger" onClick={() => remove(i)} aria-label="Remove">×</button>
        </div>
      ))}
      <button className="ghost" onClick={add}>+ Add</button>
    </div>
  );
}

export function FillBlankForm({ block, onSave, onCancel, answerKey, canSetAnswer = false }) {
  const cfg = block.config || {};
  const [prompt, setPrompt] = useState(cfg.prompt || '');
  const [text, setText] = useState(cfg.text || '');
  const [keyMap, setKeyMap] = useState(() => asKeyMap(answerKey));
  const [busy, setBusy] = useState(false);
  const { parts, blanks } = parseFillBlank(text, cfg.blanks || []);
  const blankCount = blanks.length;
  const unset = blanks.filter(b => !(keyMap[b.id] || '').trim()).length;

  function answerToSave() {
    if (!canSetAnswer) return undefined;
    return pruneKeyMap(keyMap, blanks.map(b => b.id));
  }

  async function save() {
    setBusy(true);
    await onSave({
      config: { prompt: prompt.trim() || undefined, text, parts, blanks },
      answerKey: answerToSave(),
    });
    setBusy(false);
  }

  return (
    <div className="block-form">
      <label className="form-label">Instruction (optional)</label>
      <input className="form-input" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. Complete the sentence" />

      <label className="form-label" style={{ marginTop: '0.6rem' }}>Sentence with blanks</label>
      <textarea
        className="form-textarea"
        rows="3"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="The capital of France is {{}} and of Japan is {{}}."
      />
      <p className="hint">Type <code>{'{{}}'}</code> wherever you want a blank. Detected blanks: <strong>{blankCount}</strong>.</p>
      <p className="hint" style={{ color: 'var(--gold-dark)' }}>⚠ Blanks are matched by position. If you add or remove a blank after setting the answers, re-check them so each one still lines up.</p>

      {canSetAnswer && (
        <InlineKey
          missing={unset}
          note="Matched exactly as typed, ignoring surrounding spaces and letter case. Only the blanks you fill in are marked."
        >
          {blankCount === 0 ? (
            <p className="hint">Put a {'{{}}'} in the sentence above first.</p>
          ) : (
            <div className="inline-key-rows">
              {blanks.map((b, i) => (
                <label key={b.id} className="inline-key-row">
                  <span className="inline-key-label">Blank {i + 1}</span>
                  <input
                    className="form-input"
                    value={keyMap[b.id] || ''}
                    placeholder="Expected answer"
                    onChange={e => setKeyMap(prev => ({ ...prev, [b.id]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          )}
        </InlineKey>
      )}

      <div className="form-actions">
        <button onClick={save} disabled={busy || blankCount === 0}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

// No `answerKey` here on purpose: this is the one type whose key is DERIVED
// from the content, so there is no stored value to read back into the form.
export function ReorderForm({ block, onSave, onCancel, canSetAnswer = false }) {
  const cfg = block.config || {};
  const [prompt, setPrompt] = useState(cfg.prompt || '');
  const [items, setItems] = useState(Array.isArray(cfg.items) && cfg.items.length ? cfg.items : [{ id: newItemId(), text: '' }]);
  const [busy, setBusy] = useState(false);

  const clean = items.filter(it => (it.text || '').trim());

  // THE AUTHORED ORDER IS THE ANSWER — there is nothing else for it to be.
  // The field above says "enter them in the correct order" and participants
  // are shown them shuffled, so asking for the order a second time in a
  // separate control only created a way for the two to disagree. It is drawn
  // below rather than left implicit, because a key that writes itself should
  // still be a key you can see before you save it.
  function answerToSave() {
    if (!canSetAnswer) return undefined;
    const ids = clean.map(it => it.id);
    return ids.length ? ids : null;
  }

  async function save() {
    setBusy(true);
    await onSave({
      config: { prompt: prompt.trim() || undefined, items: clean },
      answerKey: answerToSave(),
    });
    setBusy(false);
  }
  return (
    <div className="block-form">
      <label className="form-label">Instruction</label>
      <input className="form-input" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. Put the steps in the correct order" />
      <label className="form-label" style={{ marginTop: '0.6rem' }}>Items (enter them in the correct order)</label>
      <ItemRowsEditor items={items} setItems={setItems} placeholder="Step" />
      <p className="hint">Participants see these shuffled and arrange them.</p>

      {canSetAnswer && (
        <InlineKey note="This is the order above — reorder the items to change it.">
          {clean.length < 2 ? (
            <p className="hint">Add at least two items first.</p>
          ) : (
            <ol className="inline-key-order">
              {clean.map(it => <li key={it.id}>{it.text}</li>)}
            </ol>
          )}
        </InlineKey>
      )}

      <div className="form-actions">
        <button onClick={save} disabled={busy || clean.length < 2}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

export function CardSortForm({ block, onSave, onCancel, answerKey, canSetAnswer = false }) {
  const cfg = block.config || {};
  const [prompt, setPrompt] = useState(cfg.prompt || '');
  const [cards, setCards] = useState(Array.isArray(cfg.cards) && cfg.cards.length ? cfg.cards : [{ id: newItemId('card'), text: '' }]);
  const [buckets, setBuckets] = useState(Array.isArray(cfg.buckets) && cfg.buckets.length ? cfg.buckets : [{ id: newItemId('bkt'), label: '' }, { id: newItemId('bkt'), label: '' }]);
  const [keyMap, setKeyMap] = useState(() => asKeyMap(answerKey));
  const [busy, setBusy] = useState(false);

  const cleanCards = cards.filter(c => (c.text || '').trim());
  const cleanBuckets = buckets.filter(b => (b.label || '').trim());
  const unset = cleanCards.filter(c => !keyMap[c.id]).length;

  function answerToSave() {
    if (!canSetAnswer) return undefined;
    return pruneKeyMap(keyMap, cleanCards.map(c => c.id));
  }

  async function save() {
    setBusy(true);
    await onSave({
      config: { prompt: prompt.trim() || undefined, cards: cleanCards, buckets: cleanBuckets },
      answerKey: answerToSave(),
    });
    setBusy(false);
  }
  return (
    <div className="block-form">
      <label className="form-label">Instruction</label>
      <input className="form-input" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. Sort each behaviour into the right column" />
      <label className="form-label" style={{ marginTop: '0.6rem' }}>Categories (buckets)</label>
      <ItemRowsEditor items={buckets} setItems={setBuckets} textKey="label" placeholder="Category name" allowReorder={false} />
      <label className="form-label" style={{ marginTop: '0.6rem' }}>Cards</label>
      <ItemRowsEditor items={cards} setItems={setCards} placeholder="Card text" allowReorder={false} />

      {canSetAnswer && (
        <InlineKey
          missing={unset}
          note="Participants drag each card into a category. Only the cards you set a category for are marked."
        >
          {cleanCards.length === 0 || cleanBuckets.length === 0 ? (
            <p className="hint">Add at least one card and two categories first.</p>
          ) : (
            <div className="inline-key-rows">
              {cleanCards.map(c => (
                <label key={c.id} className="inline-key-row">
                  <span className="inline-key-label">{c.text}</span>
                  <select
                    className="form-input"
                    value={keyMap[c.id] || ''}
                    onChange={e => setKeyMap(prev => ({ ...prev, [c.id]: e.target.value }))}
                  >
                    <option value="">— correct category —</option>
                    {cleanBuckets.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
        </InlineKey>
      )}

      <div className="form-actions">
        <button onClick={save} disabled={busy || cleanCards.length === 0 || cleanBuckets.length < 2}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

export function MatchPairsForm({ block, onSave, onCancel, answerKey, canSetAnswer = false }) {
  const cfg = block.config || {};
  const [prompt, setPrompt] = useState(cfg.prompt || '');
  const [left, setLeft] = useState(Array.isArray(cfg.left) && cfg.left.length ? cfg.left : [{ id: newItemId('l'), text: '' }]);
  const [right, setRight] = useState(Array.isArray(cfg.right) && cfg.right.length ? cfg.right : [{ id: newItemId('r'), text: '' }]);
  const [keyMap, setKeyMap] = useState(() => asKeyMap(answerKey));
  const [busy, setBusy] = useState(false);

  const cleanLeft = left.filter(l => (l.text || '').trim());
  const cleanRight = right.filter(r => (r.text || '').trim());
  const unset = cleanLeft.filter(l => !keyMap[l.id]).length;

  function answerToSave() {
    if (!canSetAnswer) return undefined;
    return pruneKeyMap(keyMap, cleanLeft.map(l => l.id));
  }

  async function save() {
    setBusy(true);
    await onSave({
      config: { prompt: prompt.trim() || undefined, left: cleanLeft, right: cleanRight },
      answerKey: answerToSave(),
    });
    setBusy(false);
  }
  return (
    <div className="block-form">
      <label className="form-label">Instruction</label>
      <input className="form-input" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. Match each term to its definition" />
      <div className="matchpairs-form-cols">
        <div>
          <label className="form-label">Left (prompts)</label>
          <ItemRowsEditor items={left} setItems={setLeft} placeholder="Term" allowReorder={false} />
        </div>
        <div>
          <label className="form-label">Right (choices)</label>
          <ItemRowsEditor items={right} setItems={setRight} placeholder="Match" allowReorder={false} />
        </div>
      </div>
      <p className="hint">Add extra right-hand choices as distractors if you like — a choice nobody is matched to is what makes the question hard.</p>

      {canSetAnswer && (
        <InlineKey
          missing={unset}
          note="Only the left-hand items you set a match for are marked."
        >
          {cleanLeft.length === 0 || cleanRight.length === 0 ? (
            <p className="hint">Add at least one item on each side first.</p>
          ) : (
            <div className="inline-key-rows">
              {cleanLeft.map(l => (
                <label key={l.id} className="inline-key-row">
                  <span className="inline-key-label">{l.text}</span>
                  <select
                    className="form-input"
                    value={keyMap[l.id] || ''}
                    onChange={e => setKeyMap(prev => ({ ...prev, [l.id]: e.target.value }))}
                  >
                    <option value="">— correct match —</option>
                    {cleanRight.map(r => <option key={r.id} value={r.id}>{r.text}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
        </InlineKey>
      )}

      <div className="form-actions">
        <button onClick={save} disabled={busy || cleanLeft.length === 0 || cleanRight.length === 0}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
