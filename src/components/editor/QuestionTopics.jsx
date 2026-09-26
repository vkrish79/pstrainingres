import { useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';

// Topics for ONE question, sitting under that question's heading in the editor.
//
// WHY `tags` IS A PROP AND NOT READ FROM THE DRAFT.
// This replaced a separate Topics panel that read its tags from the structural
// draft, and that is precisely what broke it. The draft deliberately re-seeds
// only when the SHAPE changes — ids, titles, order (see useAssessmentDraft's
// `shape`) — so that a content edit cannot throw away staged structural work.
// Tags are content, so the draft never picked them up: a tag you added went to
// the database and then stayed invisible until a full page reload.
//
// That was the visible half. The dangerous half was that the next add composed
// its new array from those stale tags — `[...current, tag]` — and wrote the whole
// column back, so adding a second topic SILENTLY DELETED the first. The owner of
// this state is now the page, seeded from the saved rows and updated from the row
// each write returns, so what is on screen is what the database just confirmed.
export default function QuestionTopics({ sectionId, tags, known, onWrote }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Enter and the blur that Enter causes both arrive here with the same word,
  // within the same tick — before any state has come back to say it is taken.
  // Without this the bank got two identical writes for every topic added.
  const inFlight = useRef(new Set());

  async function write(next, label) {
    setBusy(true);
    setError('');
    // .select() is not optional. A Supabase update that RLS refuses comes back
    // 200 with no error and zero rows, so without reading the row back a refused
    // write looks exactly like a successful one.
    const { data, error: err } = await supabase
      .from('assessment_sections')
      .update({ tags: next })
      .eq('id', sectionId)
      .select('id, tags');
    setBusy(false);
    inFlight.current.delete(label);
    if (err) { setError(err.message); return; }
    if (!data || data.length === 0) {
      setError('Not saved — you may not have permission to edit this bank.');
      return;
    }
    // The row the database returned, not the array we hoped it stored.
    onWrote(sectionId, data[0].tags || []);
  }

  function add(raw) {
    const tag = (raw || '').trim().toLowerCase();
    if (!tag) return;
    setText('');
    if (tags.includes(tag) || inFlight.current.has(tag)) return;
    inFlight.current.add(tag);
    write([...tags, tag], tag);
  }

  // Both add and remove send the WHOLE column, so each is a read-modify-write and
  // only as good as the `tags` it reads. That prop is trustworthy for one reason:
  // the page owns it and advances it from the row each write returns. Anything
  // that ever seeds it from a source that can lag — draft state, a cached fetch —
  // brings the clobber straight back, and on remove it would be silent.
  function remove(tag) {
    if (inFlight.current.has(tag)) return;
    inFlight.current.add(tag);
    write(tags.filter(t => t !== tag), tag);
  }

  return (
    <div className="q-topics">
      <span className="q-topics-label">Topics</span>
      {tags.map(t => (
        <span key={t} className="bank-tag is-editable">
          {t}
          <button
            type="button"
            className="bank-tag-x"
            data-tip={`Remove ${t}`}
            disabled={busy}
            onClick={() => remove(t)}
          >
            ✕
          </button>
        </span>
      ))}
      <input
        className="form-input q-topics-input"
        list="qb-known-topics"
        value={text}
        placeholder={tags.length ? '+ topic' : 'Add a topic…'}
        disabled={busy}
        data-tip="How an assessment author finds this question later. Press Enter."
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(e.target.value); } }}
        onBlur={e => add(e.target.value)}
      />
      {/* Every topic already used in this bank, so the fifth question gets
          "ticketing" from a dropdown instead of a near-miss spelling of it. */}
      <datalist id="qb-known-topics">
        {known.map(t => <option key={t} value={t} />)}
      </datalist>
      {error && <span className="q-topics-error">{error}</span>}
    </div>
  );
}
