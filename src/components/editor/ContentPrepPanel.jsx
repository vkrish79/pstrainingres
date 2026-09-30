import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { isSuperTrainerOrAbove } from '../../lib/roles.js';
import { WORKBOOK_PREP_KIND, ASSESSMENT_PREP_KIND } from '../../hooks/useContentPrep.js';
import {
  addLinked, countKitsByHeader, generalHeaderProblem, isLocked, liveKitCount,
  removeEntry, uniqueHeader,
} from '../../lib/prepTemplateEdit.js';
import '../../styles/prep.css';

// Shared prep TEMPLATE SETUP panel — super-tier only, on a master (template)
// parent (workbook or assessment). A checklist: every exercise is a row, and
// ticking one says "this exercise needs prep". That is the whole setup.
//
// It replaces a header-only sheet upload that linked each column to an exercise
// by the NUMBER in its header. That guess depended on column order ("Demo 1"
// took Exercise 1 if it happened to sit before "Ex 1") and could not be seen
// from the exercise. Here the author picks the exercise, so there is nothing to
// match. What is stored has not changed — the same prep_template the upload
// wrote — so the Prep page, the fill sheet, the paste grid and claim_prep_kit
// read it exactly as before.
//
// Every change saves on its own, like the rest of this card always did — and
// each one is applied to the template AS STORED AT THAT MOMENT, not to the copy
// this card loaded. Other things write prep_template behind its back: adding
// exercises from another workbook appends borrowed columns, and extracting prep
// rewrites them. The old upload wrote once per file; this writes once per click,
// so a stale copy would be written back routinely and take those columns with it.
//
// Props:
//   parentTable     — table holding prep_template ('workbooks' | 'assessments')
//   parentId        — id of the parent row
//   sections        — sections of the parent
//   profile         — caller profile (super-tier gate)
//   kindLabel       — 'workbook' | 'assessment'
//   displayTitles   — optional { [sectionId]: title as shown on screen }. An
//                     assessment's question number is derived from its position,
//                     so the stored title can be out of date; a workbook's is not.
//   lockedTag       — optional fn(entry) -> ReactNode, shown on a column that is
//                     managed elsewhere (a composed workbook's borrowed prep)
//   extraHeader     — optional ReactNode above the checklist
//   children        — rendered below the checklist (workbook's extract/return)
//   refreshKey      — bump to make the card re-read the stored template (the
//                     workbook wrapper does, after an extract or return)
//   onTemplateChanged — called after a change has been saved
//   onTemplate      — called with the template whenever it is loaded or changes
export default function ContentPrepPanel({
  parentTable,
  parentId,
  sections,
  profile,
  kindLabel = 'workbook',
  displayTitles = null,
  lockedTag = null,
  extraHeader = null,
  children = null,
  refreshKey = 0,
  onTemplateChanged,
  onTemplate,
}) {
  const kitKind = parentTable === 'assessments' ? ASSESSMENT_PREP_KIND : WORKBOOK_PREP_KIND;
  const noun = kindLabel === 'assessment' ? 'question' : 'exercise';

  const [template, setTemplate] = useState(null); // null while loading
  const [counts, setCounts] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [onlyPrep, setOnlyPrep] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null); // header awaiting a yes
  const [generalDraft, setGeneralDraft] = useState('');
  const [generalError, setGeneralError] = useState('');
  // Columns unticked in this sitting, by exercise. Ticking the exercise again
  // puts the SAME column back — same name, same caption — instead of minting a
  // new one and stranding whatever kits still carry the old name.
  const removedRef = useRef(new Map());

  // The stored template, or null if it could not be read.
  const readStored = useCallback(async () => {
    const { data, error: readErr } = await supabase
      .from(parentTable).select('prep_template').eq('id', parentId).single();
    if (readErr || !data) return null;
    return Array.isArray(data.prep_template) ? data.prep_template : [];
  }, [parentTable, parentId]);

  useEffect(() => {
    if (!parentId) return undefined;
    let cancelled = false;
    (async () => {
      const tpl = (await readStored()) || [];
      if (cancelled) return;
      setTemplate(tpl);
      // A set-up template opens showing what is set; an empty one opens on the
      // full list, since the only thing to do there is tick.
      setOnlyPrep(tpl.some(e => e?.section_id));
    })();
    return () => { cancelled = true; };
  }, [parentId, readStored]);

  // Re-read when the exercises themselves change (exercises added from another
  // workbook arrive with their prep columns) or when the wrapper says the
  // template moved. The filter is left where the author put it.
  const sectionKey = (sections || []).map(s => s.id).join(',');
  const firstRead = useRef(true);
  useEffect(() => {
    if (firstRead.current) { firstRead.current = false; return undefined; }
    if (!parentId) return undefined;
    let cancelled = false;
    (async () => {
      const tpl = await readStored();
      if (!cancelled && tpl) setTemplate(tpl);
    })();
    return () => { cancelled = true; };
  }, [sectionKey, refreshKey, parentId, readStored]);

  // How many kits carry each column — for the counts beside a row and the
  // question asked before a column is removed. Every partition: a column that a
  // vendor's pool is still holding is just as much in use as one in the shared
  // pool. Paged, because PostgREST caps a single read.
  useEffect(() => {
    if (!parentId) return undefined;
    let cancelled = false;
    (async () => {
      const kits = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error: kitErr } = await supabase
          .from(kitKind.kitsTable).select('status, payload')
          .eq(kitKind.parentFK, parentId).order('id').range(from, from + PAGE - 1);
        if (kitErr || !data) break;
        kits.push(...data);
        if (data.length < PAGE) break;
      }
      if (!cancelled) setCounts(countKitsByHeader(kits));
    })();
    return () => { cancelled = true; };
  }, [parentId, kitKind]);

  useEffect(() => {
    if (template) onTemplate?.(template);
    // onTemplate is a parent callback; re-running on its identity would fire on
    // every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  const ordered = useMemo(
    () => [...(sections || [])].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
    [sections],
  );
  const exercises = useMemo(() => ordered.filter(s => s.kind !== 'group'), [ordered]);
  const exerciseIds = useMemo(() => exercises.map(s => s.id), [exercises]);
  const titleOf = s => displayTitles?.[s.id] || s.title || 'Untitled';

  const tpl = template || [];
  const bySection = new Map();
  for (const e of tpl) if (e.section_id && !bySection.has(e.section_id)) bySection.set(e.section_id, e);
  const knownIds = new Set(exerciseIds);
  const general = tpl.filter(e => !e.section_id);
  // Linked to an exercise this parent no longer has. Still a column trainers are
  // asked to fill, so it has to stay visible and removable.
  const stranded = tpl.filter(e => e.section_id && !knownIds.has(e.section_id));
  const linkedCount = exercises.filter(s => bySection.has(s.id)).length;

  // Apply one edit to the template as it is stored NOW. `edit` gets the fresh
  // list and returns the new one; it may throw to refuse (the message is shown).
  //
  // update() without reading the row back reports success when RLS refused it,
  // so ask for the row and treat "nothing came back" as the failure it is.
  async function persist(edit) {
    setSaving(true); setError('');
    try {
      const fresh = await readStored();
      if (!fresh) throw new Error('That change was not saved — the template could not be read.');
      const next = edit(fresh);
      const { data, error: upErr } = await supabase
        .from(parentTable).update({ prep_template: next }).eq('id', parentId)
        .select('prep_template').maybeSingle();
      if (upErr || !data) {
        // Show what is really there, so the screen does not keep a tick the
        // database never took.
        setTemplate(fresh);
        throw new Error(upErr?.message || 'That change was not saved — this template could not be updated.');
      }
      setTemplate(Array.isArray(data.prep_template) ? data.prep_template : []);
      onTemplateChanged?.(next);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message || 'That change was not saved.' };
    } finally {
      setSaving(false);
    }
  }

  // For the edits that have nowhere of their own to report a failure.
  async function save(edit) {
    const res = await persist(edit);
    if (!res.ok) setError(res.message);
    return res.ok;
  }

  function tick(section) {
    save(fresh => {
      if (fresh.some(e => e.section_id === section.id)) return fresh;
      const entry = removedRef.current.get(section.id)
        || { header: uniqueHeader(titleOf(section), fresh), section_id: section.id };
      // The remembered column may have had its name taken while it was away.
      const safe = fresh.some(e => e.header === entry.header)
        ? { ...entry, header: uniqueHeader(entry.header, fresh) }
        : entry;
      return addLinked(fresh, safe, exerciseIds);
    });
  }

  async function remove(entry) {
    setConfirmRemove(null);
    let removed = entry;
    const ok = await save(fresh => {
      // Remember the stored entry, not the one on screen: it may have been
      // changed from another tab.
      removed = fresh.find(e => e.header === entry.header) || entry;
      return removeEntry(fresh, entry.header);
    });
    if (ok && removed.section_id) removedRef.current.set(removed.section_id, removed);
  }

  // Removing a column kits still carry is the one change here with a
  // consequence, so it is asked about; anything else just happens.
  function askRemove(entry) {
    if (liveKitCount(counts, entry.header) > 0) setConfirmRemove(entry.header);
    else remove(entry);
  }

  async function addGeneral(e) {
    e.preventDefault();
    const res = await persist(fresh => {
      const problem = generalHeaderProblem(generalDraft, fresh);
      if (problem) throw new Error(problem);
      return [...fresh, { header: generalDraft.trim(), section_id: null }];
    });
    if (res.ok) { setGeneralDraft(''); setGeneralError(''); }
    else setGeneralError(res.message);
  }

  if (!isSuperTrainerOrAbove(profile?.role)) return null;

  const kitsCell = header => {
    const c = counts[header];
    if (!c) return null;
    const parts = [];
    if (c.available) parts.push(`${c.available} in the pool`);
    if (c.allocated) parts.push(`${c.allocated} in classes`);
    if (c.used) parts.push(`${c.used} spent`);
    return <span className={`prep-check-kits${c.available + c.allocated ? ' is-live' : ''}`}>{parts.join(' · ')}</span>;
  };

  const confirmRow = entry => {
    const c = counts[entry.header] || { available: 0, allocated: 0 };
    const where = [
      c.available ? `${c.available} in the pool` : null,
      c.allocated ? `${c.allocated} in classes` : null,
    ].filter(Boolean).join(', ');
    const n = c.available + c.allocated;
    return (
      <div className="prep-check-confirm" role="alert">
        <span>
          {n} kit{n === 1 ? '' : 's'} already carr{n === 1 ? 'ies' : 'y'} a value for <code>{entry.header}</code> ({where}).
          {' '}Those values stay on the kits, but trainers will no longer be asked to stock it.
        </span>
        <span className="prep-check-confirm-actions">
          <button type="button" className="danger compact" onClick={() => remove(entry)} disabled={saving}>Remove it</button>
          <button type="button" className="ghost compact" onClick={() => setConfirmRemove(null)}>Keep it</button>
        </span>
      </div>
    );
  };

  // Rows, with each section heading kept only when an exercise follows it.
  const rows = [];
  let pendingGroup = null;
  for (const s of ordered) {
    if (s.kind === 'group') { pendingGroup = s; continue; }
    const entry = bySection.get(s.id) || null;
    if (onlyPrep && !entry) continue;
    if (pendingGroup) { rows.push({ group: pendingGroup }); pendingGroup = null; }
    rows.push({ section: s, entry });
  }

  return (
    <section className="editor-card prep-panel" id="prep-template">
      <div className="prep-panel-head">
        <h2>Prep template</h2>
        {saving && <span className="muted prep-check-saving">Saving…</span>}
      </div>
      <p className="muted prep-intro">
        Tick each {noun} that needs prep — a PNR, a ticket number. Trainers then
        stock those from the <strong>Prep</strong> tab. Setup only — no prep data is
        stored here.
      </p>

      {extraHeader}

      {template === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="prep-check-bar">
            <span className="prep-check-count">
              {linkedCount} of {exercises.length} {noun}{exercises.length === 1 ? '' : 's'} need{linkedCount === 1 ? 's' : ''} prep
            </span>
            <div className="prep-check-seg" role="group" aria-label="Rows shown">
              <button type="button" aria-pressed={!onlyPrep} onClick={() => setOnlyPrep(false)}>
                All {exercises.length}
              </button>
              <button type="button" aria-pressed={onlyPrep} onClick={() => setOnlyPrep(true)}>
                Only with prep
              </button>
            </div>
          </div>

          {exercises.length === 0 ? (
            <p className="muted">This {kindLabel} has no {noun}s yet.</p>
          ) : rows.length === 0 ? (
            <p className="muted prep-check-none">
              No {noun} needs prep yet. <button type="button" className="ghost compact" onClick={() => setOnlyPrep(false)}>Show all {exercises.length}</button>
            </p>
          ) : (
            <div className="prep-check-scroll">
              <table className="prep-check">
                <thead>
                  <tr>
                    <th className="prep-check-tick">Prep</th>
                    <th>{noun === 'question' ? 'Question' : 'Exercise'}</th>
                    <th>Column</th>
                    <th>Kits</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    if (row.group) {
                      return (
                        <tr key={`g-${row.group.id}`} className="prep-check-group">
                          <td colSpan={4}>{row.group.title}</td>
                        </tr>
                      );
                    }
                    const { section: s, entry } = row;
                    const locked = entry && isLocked(entry);
                    const boxId = `prep-tick-${s.id}`;
                    return (
                      <Fragment key={s.id}>
                        <tr id={`prep-row-${s.id}`} className={entry ? 'is-on' : ''}>
                          <td className="prep-check-tick">
                            <input
                              id={boxId}
                              type="checkbox"
                              checked={!!entry}
                              disabled={saving || locked}
                              onChange={() => (entry ? askRemove(entry) : tick(s))}
                            />
                          </td>
                          <td><label htmlFor={boxId}>{titleOf(s)}</label></td>
                          <td>
                            {entry && <code>{entry.header}</code>}
                            {locked && <> {lockedTag?.(entry)}</>}
                          </td>
                          <td>{entry && kitsCell(entry.header)}</td>
                        </tr>
                        {entry && confirmRemove === entry.header && (
                          <tr className="prep-check-confirm-row"><td colSpan={4}>{confirmRow(entry)}</td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="prep-check-general">
            <h3>General items</h3>
            <p className="muted">
              Prep every participant needs that belongs to no single {noun} — a demo PNR, a login.
            </p>
            {[...general, ...stranded].length > 0 && (
              <ul className="prep-check-general-list">
                {[...general, ...stranded].map(entry => (
                  <li key={entry.header}>
                    <div className="prep-check-general-row">
                      <code>{entry.header}</code>
                      {entry.section_id && <span className="prep-warn prep-check-gone">its {noun} was removed</span>}
                      {isLocked(entry) && lockedTag?.(entry)}
                      {kitsCell(entry.header)}
                      {!isLocked(entry) && (
                        <button type="button" className="ghost compact" disabled={saving} onClick={() => askRemove(entry)}>
                          Remove
                        </button>
                      )}
                    </div>
                    {confirmRemove === entry.header && confirmRow(entry)}
                  </li>
                ))}
              </ul>
            )}
            <form className="prep-check-add" onSubmit={addGeneral}>
              <input
                className="form-input compact"
                value={generalDraft}
                onChange={e => { setGeneralDraft(e.target.value); setGeneralError(''); }}
                placeholder="e.g. Demo PNR"
                aria-label="Name of a new general item"
              />
              <button type="submit" className="ghost compact" disabled={saving || !generalDraft.trim()}>
                + Add general item
              </button>
            </form>
            {generalError && <p className="error">{generalError}</p>}
          </div>

          {tpl.length > 0 && (
            <div className="prep-check-cols">
              <span className="muted">Columns trainers fill, in order:</span>
              {tpl.map(e => <code key={e.header}>{e.header}</code>)}
            </div>
          )}

          {error && <p className="error">{error}</p>}

          {children}
        </>
      )}
    </section>
  );
}
