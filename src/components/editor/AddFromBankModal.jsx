import { useEffect, useMemo, useState } from 'react';
import { SkeletonLines } from '../Skeleton.jsx';
import { useBusyOverlay } from '../../contexts/BusyOverlayContext.jsx';
import { supabase } from '../../lib/supabase.js';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';
import Block from '../blocks/Block.jsx';
import { QUESTION_TYPES, questionTypeKeys, typeGlyph, typeLabel } from '../../lib/questionTypeLabels.js';
import '../../styles/workbook.css';

// Pick questions out of a question bank and add them to the assessment being
// edited.
//
// A sibling of AddExercisesModal rather than a mode of it, by decision: that one
// copies exercises between assessments and stays exactly as it is. The two look
// alike on purpose (same modal shell, same .picker-* list, same read-only Block
// preview) but they differ in the two ways that matter — this one filters by
// question type and topic, because a bank is browsed rather than remembered, and
// it calls add_bank_questions_to_assessment, which also carries each question's
// answer key, marks, marking mode and rubric, and records where the copy came
// from so it can be re-pulled when the bank changes.
// usedBankSectionIds — the source_bank_section_id of every question the assessment
// currently holds, taken from the editor’s LIVE list.
//
// It is a prop, not a query this modal runs for itself, and that is the whole
// point. Deleting a question is a STAGED edit: the row survives in the database
// until Save is pressed. A modal that asked the database would therefore keep
// calling a removed question "already added" — showing the trainer something
// their own screen contradicts. Reading the editor’s list instead means staged
// additions and deletions are both reflected the moment they happen.
export default function AddFromBankModal({ currentParentId, usedBankSectionIds = [], onClose, onAdded }) {
  const { run: runBusy } = useBusyOverlay();
  useBodyScrollLock();

  const [banks, setBanks] = useState([]);
  const [bankId, setBankId] = useState('');
  const [sections, setSections] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [keys, setKeys] = useState({});   // { [blockId]: correct answer }
  const [selected, setSelected] = useState(new Set());
  const [expanded, setExpanded] = useState(new Set());
  const [typeFilter, setTypeFilter] = useState('');   // '' = any type
  const [tagFilter, setTagFilter] = useState('');     // '' = any topic
  const [search, setSearch] = useState('');
  // Random draw. The draw happens HERE, when the paper is built — not per session
  // and not per candidate. So the trainer sees exactly which questions they got,
  // can untick one, and can draw again; and every candidate still sits the same
  // paper, which is what the marking, the cohort report and going over answers
  // with the class all depend on.
  const [drawCount, setDrawCount] = useState(5);
  const [drawn, setDrawn] = useState(null);       // Set of ids from the last draw
  const [drawnOnly, setDrawnOnly] = useState(false);
  const [drawNote, setDrawNote] = useState('');
  const [loadingSrc, setLoadingSrc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The banks. RLS scopes these; the client does not filter by role.
  useEffect(() => {
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
      // One bank is the common case, so open it rather than making the trainer
      // pick from a list of one.
      if ((data || []).length === 1) setBankId(data[0].id);
    })();
    return () => { cancelled = true; };
  }, []);


  // The chosen bank's questions and their blocks.
  useEffect(() => {
    if (!bankId) { setSections([]); setBlocks([]); setKeys({}); return undefined; }
    let cancelled = false;
    (async () => {
      setLoadingSrc(true); setError(''); setSelected(new Set()); setExpanded(new Set());
      try {
        const { data: secsAll, error: e1 } = await supabase
          .from('assessment_sections')
          .select('id, title, order_index, kind, tags')
          .eq('assessment_id', bankId)
          .order('order_index');
        if (e1) throw e1;
        // Group sections are Word-H1 banners holding no copyable content.
        const secs = (secsAll || []).filter(s => s.kind !== 'group');
        const ids = secs.map(s => s.id);
        const { data: blks, error: e2 } = ids.length
          ? await supabase
            .from('assessment_blocks')
            .select('id, section_id, block_type, config, order_index')
            .in('section_id', ids)
            .order('order_index')
          : { data: [], error: null };
        if (e2) throw e2;
        // The correct answers, so the preview can show which option is right —
        // the thing a trainer is actually judging when they decide whether to
        // take a question. Safe to read here and nowhere near a candidate: this
        // modal is behind the super-trainer gate, and assessment_answer_keys has
        // no participant policy at all.
        const blockIds = (blks || []).map(b => b.id);
        const { data: keyRows } = blockIds.length
          ? await supabase
            .from('assessment_answer_keys')
            .select('assessment_block_id, key')
            .in('assessment_block_id', blockIds)
          : { data: [] };
        if (cancelled) return;
        setSections(secs);
        setBlocks(blks || []);
        setKeys(Object.fromEntries((keyRows || []).map(k => [k.assessment_block_id, k.key])));
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoadingSrc(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bankId]);

  // Derived, so it tracks the editor rather than a snapshot taken when the modal
  // opened. Identified by back-link, never by title — a rename must not make a
  // question look new.
  const alreadyUsed = useMemo(
    () => new Set((usedBankSectionIds || []).filter(Boolean)),
    [usedBankSectionIds],
  );

  const blocksBySection = useMemo(() => {
    const m = new Map();
    for (const b of blocks) {
      if (!m.has(b.section_id)) m.set(b.section_id, []);
      m.get(b.section_id).push(b);
    }
    return m;
  }, [blocks]);

  // Only the types and topics actually present get an entry. A filter offering
  // ten types when the bank holds three is a row of dead controls.
  const presentTypes = useMemo(() => {
    const keys = new Set();
    for (const s of sections) {
      questionTypeKeys(blocksBySection.get(s.id) || []).forEach(k => keys.add(k));
    }
    return QUESTION_TYPES.filter(t => keys.has(t.key));
  }, [sections, blocksBySection]);

  const presentTags = useMemo(() => {
    const t = new Set();
    for (const s of sections) (s.tags || []).forEach(x => { if (x) t.add(x); });
    return [...t].sort((a, b) => a.localeCompare(b));
  }, [sections]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sections.filter(s => {
      if (typeFilter && !questionTypeKeys(blocksBySection.get(s.id) || []).includes(typeFilter)) return false;
      if (tagFilter && !(s.tags || []).includes(tagFilter)) return false;
      if (q && !(s.title || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sections, blocksBySection, typeFilter, tagFilter, search]);

  // The questions a draw is allowed to pick from: whatever the filters show, minus
  // anything this assessment already has.
  const pool = useMemo(() => shown.filter(s => !alreadyUsed.has(s.id)), [shown, alreadyUsed]);

  function toggle(setFn, id) {
    setFn(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  // Fisher-Yates, not sort(() => Math.random() - 0.5). The sort-comparator trick
  // is not a uniform shuffle — it biases towards the original order, which on a
  // bank whose questions were authored easiest-first would quietly hand out the
  // same easy questions more often than the hard ones.
  function drawRandom() {
    const n = Math.max(1, Math.floor(Number(drawCount) || 1));
    const ids = pool.map(s => s.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const take = ids.slice(0, n);
    setSelected(new Set(take));
    setDrawn(new Set(take));
    setDrawnOnly(true);
    setNotice('');
    setDrawNote(
      take.length < n
        ? `Only ${take.length} question${take.length === 1 ? '' : 's'} available to draw from`
          + `${alreadyUsed.size ? ' (questions already in this assessment are left out)' : ''}`
          + ` — drew all ${take.length}.`
        : `Drew ${take.length} of ${pool.length} matching. Untick any you do not want, or draw again.`,
    );
  }

  // Selection survives filtering — tick two matching questions, change the
  // filter, tick a third, and all three are added. So the count and the button
  // read from `selected`, never from what happens to be on screen.
  async function handleAdd() {
    if (selected.size === 0) return;
    setBusy(true); setError(''); setNotice('');
    // Source order = the bank's own order, for the ones that were ticked.
    const ids = sections.filter(s => selected.has(s.id)).map(s => s.id);
    const bankTitle = banks.find(b => b.id === bankId)?.title || '';
    const { data, error: e } = await runBusy(
      `Adding ${ids.length} question${ids.length === 1 ? '' : 's'}…`,
      () => supabase.rpc('add_bank_questions_to_assessment', {
        p_target_assessment_id: currentParentId,
        p_source_section_ids: ids,
      }),
    );
    setBusy(false);
    if (e) { setError(e.message); return; }
    setNotice(
      `Added ${data} question${data === 1 ? '' : 's'} from "${bankTitle}", with their marking. `
      + 'Pick more or close.',
    );
    setSelected(new Set());
    // A spent draw must not linger: leaving "Show only the draw" on would hide
    // the rest of the bank, and the rows just added are about to become
    // "already added" anyway.
    setDrawn(null);
    setDrawnOnly(false);
    setDrawNote('');
    await onAdded?.();
  }

  return (
    <div className="modal-backdrop visible" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '820px', width: '94vw' }}>
        <header className="modal-head">
          <h2>✈ Add questions from the question bank</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <label className="form-label">Question bank</label>
          <select className="form-input" value={bankId} onChange={e => setBankId(e.target.value)}>
            <option value="">Select a question bank…</option>
            {banks.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>

          {banks.length === 0 && !error && (
            <p className="muted" style={{ marginTop: '0.75rem' }}>
              There are no question banks yet. Create one under <strong>Question bank</strong> in the rail.
            </p>
          )}

          {notice && <p className="prep-notice" style={{ marginTop: '0.75rem' }}>{notice}</p>}
          {error && <p className="error">{error}</p>}

          {bankId && !loadingSrc && sections.length > 0 && (
            <div className="bank-filters">
              <input
                className="form-input bank-filter-search"
                value={search}
                placeholder="Search questions…"
                onChange={e => setSearch(e.target.value)}
              />
              {presentTypes.length > 1 && (
                <select className="form-input" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                  <option value="">Any type</option>
                  {presentTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              )}
              {presentTags.length > 0 && (
                <select className="form-input" value={tagFilter} onChange={e => setTagFilter(e.target.value)}>
                  <option value="">Any topic</option>
                  {presentTags.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
            </div>
          )}

          {/* Two ways to choose, side by side rather than behind a mode switch:
              drawing at random and then unticking one is a single continuous
              action, and a switch would make the trainer commit to a mode before
              they know what the draw gave them. */}
          {bankId && !loadingSrc && sections.length > 0 && (
            <div className="bank-draw">
              <span className="bank-draw-or">or draw at random —</span>
              <input
                type="number"
                className="form-input bank-draw-n"
                min="1"
                max={Math.max(1, pool.length)}
                value={drawCount}
                onChange={e => setDrawCount(e.target.value)}
                aria-label="How many questions to draw"
              />
              <button
                type="button"
                className="ghost"
                disabled={pool.length === 0}
                data-tip={
                  'Picks at random from the questions matching the filters above, skipping any '
                  + 'already in this assessment. Draws now, so you can see and change what you got.'
                }
                onClick={drawRandom}
              >
                {drawn ? '↻ Draw again' : '⚄ Draw'}
              </button>
              <span className="muted bank-draw-pool">
                {pool.length} to choose from
                {alreadyUsed.size > 0 && `, ${alreadyUsed.size} already in this paper`}
              </span>
              {drawn && (
                <label className="bank-draw-only">
                  <input
                    type="checkbox"
                    checked={drawnOnly}
                    onChange={e => setDrawnOnly(e.target.checked)}
                  />
                  <span>Show only the draw</span>
                </label>
              )}
            </div>
          )}

          {drawNote && <p className="prep-notice">{drawNote}</p>}

          {loadingSrc && <SkeletonLines rows={4} label="Loading questions…" />}

          {!loadingSrc && bankId && sections.length === 0 && (
            <p className="muted">This question bank has no questions yet.</p>
          )}

          {!loadingSrc && sections.length > 0 && shown.length === 0 && (
            <p className="muted">No question matches those filters.</p>
          )}

          {!loadingSrc && shown.length > 0 && (
            <div className="picker-list">
              {(drawnOnly && drawn ? shown.filter(s => drawn.has(s.id)) : shown).map(s => {
                const secBlocks = blocksBySection.get(s.id) || [];
                const isOpen = expanded.has(s.id);
                const types = questionTypeKeys(secBlocks);
                const used = alreadyUsed.has(s.id);
                return (
                  <div
                    key={s.id}
                    className={`picker-row ${selected.has(s.id) ? 'picked' : ''} ${used ? 'is-used' : ''}`}
                  >
                    <label className="picker-head">
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        disabled={used}
                        onChange={() => toggle(setSelected, s.id)}
                      />
                      <span className="picker-title">{s.title}</span>
                      {/* Adding a second copy of the same question to one paper is
                          a mistake every time, so it is blocked rather than
                          warned about — the copies would be identical. */}
                      {used && (
                        <span className="bank-tag" data-tip="This question is already in this assessment">
                          already added
                        </span>
                      )}
                      {types.map(k => (
                        <span key={k} className="type-tag">
                          <span aria-hidden>{typeGlyph(k)}</span> {typeLabel(k)}
                        </span>
                      ))}
                      {(s.tags || []).map(t => <span key={t} className="bank-tag">{t}</span>)}
                      <span className="muted picker-count">
                        {secBlocks.length} block{secBlocks.length === 1 ? '' : 's'}
                      </span>
                      <button
                        type="button"
                        className="ghost picker-toggle"
                        onClick={(e) => { e.preventDefault(); toggle(setExpanded, s.id); }}
                      >
                        {isOpen ? 'Hide' : 'Preview'}
                      </button>
                    </label>
                    {isOpen && (
                      <div className="picker-preview">
                        {secBlocks.length === 0 && <p className="muted">(empty)</p>}
                        {/* preview, not just readOnly: this is a question being
                            chosen, so it has to show its options. readOnly alone
                            renders the answer, and there isn't one. */}
                        {secBlocks.map(b => (
                          <Block
                            key={b.id}
                            block={b}
                            value={undefined}
                            onChange={() => {}}
                            readOnly
                            preview
                            correct={keys[b.id]}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <footer className="modal-foot">
          <button type="button" className="ghost" onClick={onClose}>Close</button>
          <button type="button" onClick={handleAdd} disabled={busy || selected.size === 0}>
            {busy ? 'Adding…' : `Add ${selected.size || ''} question${selected.size === 1 ? '' : 's'}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
