import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useBusyOverlay } from '../../contexts/BusyOverlayContext.jsx';
import { buildQuestions } from '../../lib/assessmentStructure.js';
import { questionTypeKeys, typeGlyph, typeLabel } from '../../lib/questionTypeLabels.js';

// Promote questions from this assessment into a question bank, so a good one
// written inline is reusable instead of stranded in the paper it was written for.
//
// The inverse of AddFromBankModal, and it goes through the same copy engine in the
// database, so what lands in the bank carries the answer key, the marks, the
// marking mode and the rubric — a bank question missing its scheme would be worse
// than no bank question at all, because it looks complete.
//
// A promoted question is NOT linked back to the assessment it came from. The bank
// copy becomes a master in its own right; linking it upstream would make the bank
// downstream of a programme, which is backwards.
export default function SaveToBankPanel({ sections, blocks, unsavedCount = 0, onSaved }) {
  const { run: runBusy } = useBusyOverlay();
  const [open, setOpen] = useState(false);
  const [banks, setBanks] = useState([]);
  const [bankId, setBankId] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    (async () => {
      const { data, error: e } = await supabase
        .from('assessments')
        .select('id, title')
        .eq('kind', 'bank')
        .eq('is_template', true)
        .order('title');
      if (cancelled) return;
      if (e) { setError(e.message); return; }
      setBanks(data || []);
      if ((data || []).length === 1) setBankId(data[0].id);
    })();
    return () => { cancelled = true; };
  }, [open]);

  const { questions } = useMemo(() => buildQuestions(sections, blocks), [sections, blocks]);

  // A question with nothing in it has nothing to promote.
  const promotable = questions.filter(q => q.blocks.length > 0);

  function toggle(id) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function handleSave() {
    if (!bankId || selected.size === 0) return;
    setBusy(true); setError(''); setNotice('');
    const ids = promotable.filter(q => selected.has(q.section.id)).map(q => q.section.id);
    const bankTitle = banks.find(b => b.id === bankId)?.title || '';
    const { data, error: e } = await runBusy(
      `Saving ${ids.length} question${ids.length === 1 ? '' : 's'} to the bank…`,
      () => supabase.rpc('add_assessment_questions_to_bank', {
        p_target_bank_id: bankId,
        p_source_section_ids: ids,
      }),
    );
    setBusy(false);
    if (e) { setError(e.message); return; }
    setNotice(
      `Saved ${data} question${data === 1 ? '' : 's'} to "${bankTitle}", with their marking. `
      + 'They are copies — editing them in the bank will not change this assessment.',
    );
    setSelected(new Set());
    await onSaved?.();
  }

  if (promotable.length === 0 && unsavedCount === 0) return null;

  return (
    <section className="editor-card">
      <button type="button" className="ghost panel-toggle" onClick={() => setOpen(o => !o)}>
        {open ? '▾' : '▸'} Save questions to a bank
        <span className="muted" style={{ marginLeft: '0.5rem', fontWeight: 400 }}>
          reuse them in other assessments
        </span>
      </button>

      {open && (
        <>
          {unsavedCount > 0 && (
            <p className="hint">
              {unsavedCount} question{unsavedCount === 1 ? '' : 's'} with unsaved changes
              {unsavedCount === 1 ? ' is' : ' are'} not listed. Save the assessment first — a
              question that only exists in the draft has no answer key yet to travel with it.
            </p>
          )}

          <label className="form-label">Question bank</label>
          <select className="form-input" value={bankId} onChange={e => setBankId(e.target.value)}>
            <option value="">Select a question bank…</option>
            {banks.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>

          {banks.length === 0 && !error && (
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              There are no question banks yet. Create one under <strong>Question bank</strong> in
              the rail.
            </p>
          )}

          {promotable.length > 0 && (
            <div className="picker-list" style={{ marginTop: '0.75rem' }}>
              {promotable.map(q => {
                const types = questionTypeKeys(q.blocks);
                return (
                  <div
                    key={q.section.id}
                    className={`picker-row ${selected.has(q.section.id) ? 'picked' : ''}`}
                  >
                    <label className="picker-head">
                      <input
                        type="checkbox"
                        checked={selected.has(q.section.id)}
                        onChange={() => toggle(q.section.id)}
                      />
                      <span className="picker-title">
                        {q.label ? `${q.label}. ` : ''}{q.section.title}
                      </span>
                      {types.map(k => (
                        <span key={k} className="type-tag">
                          <span aria-hidden>{typeGlyph(k)}</span> {typeLabel(k)}
                        </span>
                      ))}
                      {q.section.source_bank_section_id && (
                        <span className="bank-tag" data-tip="This question already came from a bank">
                          from the bank
                        </span>
                      )}
                    </label>
                  </div>
                );
              })}
            </div>
          )}

          <div className="form-actions">
            <button type="button" disabled={busy || !bankId || selected.size === 0} onClick={handleSave}>
              {busy ? 'Saving…' : `Save ${selected.size || ''} to the bank`}
            </button>
          </div>

          {notice && <p className="prep-notice">{notice}</p>}
          {error && <p className="error">{error}</p>}
        </>
      )}
    </section>
  );
}
