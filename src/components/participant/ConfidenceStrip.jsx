import { useEffect, useState } from 'react';
import { LEVELS, LEVEL_BY_ID } from '../../hooks/useExerciseConfidence.js';

// "How did Exercise 4 go?" at the end of an exercise, once its last box is
// filled (engagement rec 1). One tap, private to the trainer, never blocks
// moving on. Once answered it folds to one line with a way to change it;
// there is no "exercise closed" in the app, so it can always be changed.
//
//   mine  — { level, note } or undefined
//   onSet(level, note?) → Promise<{ error }>
export default function ConfidenceStrip({ title, mine, onSet }) {
  const [open, setOpen] = useState(!mine);
  const [note, setNote] = useState(mine?.note || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // A tap made elsewhere (another tab) arrives through the hook.
  useEffect(() => { setNote(mine?.note || ''); }, [mine?.note]);

  async function pick(level) {
    setBusy(true);
    setErr('');
    const { error } = await onSet(level, note);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOpen(false);
  }

  async function saveNote() {
    if (!mine || (mine.note || '') === note.trim()) return;
    const { error } = await onSet(mine.level, note);
    if (error) setErr(error.message);
  }

  if (mine && !open) {
    const l = LEVEL_BY_ID[mine.level];
    return (
      <div className="conf-strip is-done no-print">
        <span>You said <strong><span aria-hidden="true">{l?.glyph} </span>{l?.label}</strong>{mine.note ? <> · “{mine.note}”</> : null}</span>
        <button type="button" className="conf-change" onClick={() => setOpen(true)}>Change</button>
      </div>
    );
  }

  return (
    <div className="conf-strip no-print" role="group" aria-label={`How did ${title} go?`}>
      <div className="conf-head">
        <strong>How did {title} go?</strong>
        <span className="conf-private">Only your trainer sees this</span>
      </div>
      <div className="conf-choices">
        {LEVELS.map(l => (
          <button
            key={l.id}
            type="button"
            className={`conf-choice${mine?.level === l.id ? ' is-on' : ''}`}
            aria-pressed={mine?.level === l.id}
            disabled={busy}
            onClick={() => pick(l.id)}
          >
            <span className="conf-glyph" aria-hidden="true">{l.glyph}</span>
            {l.label}
          </button>
        ))}
      </div>
      <input
        type="text"
        className="form-input conf-note"
        maxLength={200}
        placeholder="What tripped you up? (optional)"
        aria-label="What tripped you up? (optional)"
        value={note}
        onChange={e => setNote(e.target.value)}
        onBlur={saveNote}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
      {err && <p className="error conf-error">{err}</p>}
      {!mine && <p className="conf-hint">Tap once, then carry on. You can change it later.</p>}
    </div>
  );
}
