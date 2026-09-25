import { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { buildQuestions } from '../../lib/assessmentStructure.js';
import { questionTypeKeys, typeGlyph, typeLabel } from '../../lib/questionTypeLabels.js';

// Topic tags on a bank's questions — fares, ticketing, PNR, refunds.
//
// The question TYPE is not edited here and never could be: it is already decided
// by the blocks inside the question, so it is shown as a read-only chip beside
// each row. These tags are the other axis, the one nothing else records, and the
// reason a bank of two hundred questions stays usable.
//
// Tags write immediately rather than staging with the structural draft. A tag is a
// filing decision, not a draft of the paper — the same line the existing editor
// draws for question wording and answer keys.
export default function QuestionTagsPanel({ sections, blocks, unsavedCount = 0, onSaved }) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [errors, setErrors] = useState({});
  const [adding, setAdding] = useState({});

  const { questions } = useMemo(
    () => buildQuestions(sections, blocks),
    [sections, blocks],
  );

  // Every tag already in use in this bank, offered as a datalist so the fifth
  // question gets "ticketing" from a dropdown instead of a typo.
  const known = useMemo(() => {
    const t = new Set();
    for (const s of sections) (s.tags || []).forEach(x => { if (x) t.add(x); });
    return [...t].sort((a, b) => a.localeCompare(b));
  }, [sections]);

  const taggedCount = sections.filter(s => (s.tags || []).length > 0).length;

  async function writeTags(sectionId, tags) {
    setBusyId(sectionId);
    setErrors(prev => ({ ...prev, [sectionId]: null }));
    // .select() is not optional. A Supabase update that RLS refuses comes back
    // 200 with no error and zero rows, so without reading the row back a refused
    // write looks exactly like a successful one.
    const { data, error } = await supabase
      .from('assessment_sections')
      .update({ tags })
      .eq('id', sectionId)
      .select('id, tags');
    setBusyId(null);
    if (error) {
      setErrors(prev => ({ ...prev, [sectionId]: error.message }));
      return;
    }
    if (!data || data.length === 0) {
      setErrors(prev => ({ ...prev, [sectionId]: 'Not saved — you may not have permission to edit this bank.' }));
      return;
    }
    await onSaved?.();
  }

  function addTag(section, raw) {
    const tag = (raw || '').trim().toLowerCase();
    if (!tag) return;
    const current = section.tags || [];
    if (current.includes(tag)) { setAdding(prev => ({ ...prev, [section.id]: '' })); return; }
    setAdding(prev => ({ ...prev, [section.id]: '' }));
    writeTags(section.id, [...current, tag]);
  }

  function removeTag(section, tag) {
    writeTags(section.id, (section.tags || []).filter(t => t !== tag));
  }

  if (sections.length === 0 && unsavedCount === 0) return null;

  return (
    <section className="editor-card">
      <button type="button" className="ghost panel-toggle" onClick={() => setOpen(o => !o)}>
        {open ? '▾' : '▸'} Topics
        <span className="muted" style={{ marginLeft: '0.5rem', fontWeight: 400 }}>
          {taggedCount} of {sections.length} question{sections.length === 1 ? '' : 's'} tagged
        </span>
      </button>

      {open && (
        <>
          <p className="hint">
            Topics are how an assessment author finds a question later. Type a topic and press Enter.
          </p>
          {unsavedCount > 0 && (
            <p className="hint">
              {unsavedCount} new question{unsavedCount === 1 ? '' : 's'} can be tagged once you save.
            </p>
          )}
          <datalist id="qb-known-tags">
            {known.map(t => <option key={t} value={t} />)}
          </datalist>
          <div className="qb-tag-list">
            {questions.map(q => {
              const s = q.section;
              const types = questionTypeKeys(q.blocks);
              return (
                <div key={s.id} className="qb-tag-row">
                  <div className="qb-tag-head">
                    <span className="qb-tag-label">{q.label ? `${q.label}. ` : ''}{s.title}</span>
                    {types.map(k => (
                      <span key={k} className="type-tag">
                        <span aria-hidden>{typeGlyph(k)}</span> {typeLabel(k)}
                      </span>
                    ))}
                  </div>
                  <div className="qb-tag-chips">
                    {(s.tags || []).map(t => (
                      <span key={t} className="bank-tag is-editable">
                        {t}
                        <button
                          type="button"
                          className="bank-tag-x"
                          data-tip={`Remove ${t}`}
                          disabled={busyId === s.id}
                          onClick={() => removeTag(s, t)}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    <input
                      className="form-input qb-tag-input"
                      list="qb-known-tags"
                      value={adding[s.id] || ''}
                      placeholder="+ topic"
                      disabled={busyId === s.id}
                      onChange={e => setAdding(prev => ({ ...prev, [s.id]: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); addTag(s, adding[s.id]); }
                      }}
                      onBlur={() => addTag(s, adding[s.id])}
                    />
                  </div>
                  {errors[s.id] && <p className="error">{errors[s.id]}</p>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
