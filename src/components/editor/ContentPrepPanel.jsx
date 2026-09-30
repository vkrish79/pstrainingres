import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { isSuperTrainerOrAbove } from '../../lib/roles.js';
import { WORKBOOK_PREP_KIND, ASSESSMENT_PREP_KIND } from '../../hooks/useContentPrep.js';
import {
  PREP_REVEAL_EVENT, addLinked, countKitsByHeader, generalHeaderProblem, isLocked, liveKitCount,
  removeEntry, setShowWith, shownWithBySection, tileLabel, topicRows, uniqueHeader,
} from '../../lib/prepTemplateEdit.js';
import { LIVE_KITS_FILTER } from '../../lib/prepPools.js';
import '../../styles/prep.css';

// Shared prep TEMPLATE SETUP panel — super-tier only, on a master (template)
// parent (workbook or assessment). Every exercise is a tile, laid out one row
// per topic; clicking a tile says "this exercise needs prep". General prep (not
// tied to an exercise) sits underneath as chips. That is the whole setup.
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
// The card collapses to its heading and a one-line summary. Open or closed is
// remembered per browser, for every workbook and assessment alike. A marker on
// an exercise heading (ContentEditorScaffold) opens it by firing
// PREP_REVEAL_EVENT with the section id.
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
//   lockedNote      — optional fn(entry) -> string, for a column that is managed
//                     elsewhere (a composed workbook's borrowed prep)
//   extraHeader     — optional ReactNode above the tiles
//   children        — rendered below general prep (workbook's extract/return)
//   refreshKey      — bump to make the card re-read the stored template (the
//                     workbook wrapper does, after an extract or return)
//   onTemplateChanged — called after a change has been saved
//   onTemplate      — called with the template whenever it is loaded or changes
const OPEN_KEY = 'prep-template-open';

function readOpen() {
  try { return window.localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}
function writeOpen(open) {
  try { window.localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* private window */ }
}

export default function ContentPrepPanel({
  parentTable,
  parentId,
  sections,
  profile,
  kindLabel = 'workbook',
  displayTitles = null,
  lockedNote = null,
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
  const [open, setOpen] = useState(readOpen);
  const [confirmRemove, setConfirmRemove] = useState(null); // header awaiting a yes
  const [adding, setAdding] = useState(false);
  const [generalDraft, setGeneralDraft] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [flashId, setFlashId] = useState(null);
  // Columns removed in this sitting, by exercise. Picking the exercise again
  // puts the SAME column back — same name — instead of minting a new one and
  // stranding whatever kits still carry the old name.
  const removedRef = useRef(new Map());

  function toggleOpen() {
    setOpen(o => { writeOpen(!o); return !o; });
  }

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
      if (!cancelled) setTemplate(tpl);
    })();
    return () => { cancelled = true; };
  }, [parentId, readStored]);

  // Re-read when the exercises themselves change (exercises added from another
  // workbook arrive with their prep columns) or when the wrapper says the
  // template moved.
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

  // How many kits carry each column — for the dot on a tile and the question
  // asked before a column is removed. Every partition: a column that a vendor's
  // pool is still holding is just as much in use as one in the shared pool.
  // Paged, because PostgREST caps a single read.
  useEffect(() => {
    if (!parentId) return undefined;
    let cancelled = false;
    (async () => {
      const kits = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error: kitErr } = await supabase
          .from(kitKind.kitsTable).select('status, payload')
          .eq(kitKind.parentFK, parentId).or(LIVE_KITS_FILTER)
          .order('id').range(from, from + PAGE - 1);
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

  // A heading's marker asks for its tile: open the card if it is shut, then —
  // once the tiles exist — bring that one on screen and light it briefly.
  useEffect(() => {
    const onReveal = e => {
      setOpen(true); writeOpen(true);
      setFlashId(e.detail?.sectionId || null);
    };
    window.addEventListener(PREP_REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(PREP_REVEAL_EVENT, onReveal);
  }, []);
  useEffect(() => {
    if (!flashId || !open) return undefined;
    const el = document.getElementById(`prep-tile-${flashId}`);
    if (!el) return undefined;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('prep-tile-flash');
    const t = setTimeout(() => { el.classList.remove('prep-tile-flash'); setFlashId(null); }, 1600);
    return () => clearTimeout(t);
  }, [flashId, open, template]);

  const ordered = useMemo(
    () => [...(sections || [])].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
    [sections],
  );
  const rows = useMemo(() => topicRows(ordered), [ordered]);
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
  const shownWith = shownWithBySection(tpl, knownIds); // { [sectionId]: [general entry] }
  const linkedCount = exercises.filter(s => bySection.has(s.id)).length;
  const generalCount = general.length + stranded.length;

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
        // Show what is really there, so the screen does not keep a pick the
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

  function pick(section) {
    setConfirmRemove(null);
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
    if (res.ok) { setGeneralDraft(''); setGeneralError(''); setAdding(false); }
    else setGeneralError(res.message);
  }

  if (!isSuperTrainerOrAbove(profile?.role)) return null;

  // "6 in the pool · 44 in classes" — for tooltips. Spent kits are not loaded.
  const kitsText = header => {
    const c = counts[header];
    if (!c) return '';
    return [
      c.available ? `${c.available} in the pool` : null,
      c.allocated ? `${c.allocated} in classes` : null,
    ].filter(Boolean).join(' · ');
  };

  const confirmEntry = confirmRemove ? tpl.find(e => e.header === confirmRemove) : null;
  const confirmBar = confirmEntry && (() => {
    const c = counts[confirmEntry.header] || { available: 0, allocated: 0 };
    const where = [
      c.available ? `${c.available} in the pool` : null,
      c.allocated ? `${c.allocated} in classes` : null,
    ].filter(Boolean).join(', ');
    const n = c.available + c.allocated;
    const sec = confirmEntry.section_id ? exercises.find(s => s.id === confirmEntry.section_id) : null;
    const name = sec ? titleOf(sec) : confirmEntry.header;
    return (
      <div className="prep-tiles-confirm" role="alert">
        <span>
          {n} kit{n === 1 ? '' : 's'} already carr{n === 1 ? 'ies' : 'y'} prep for <strong>{name}</strong> ({where}).
          {' '}Those values stay on the kits, but trainers will no longer be asked to stock it.
        </span>
        <span className="prep-tiles-confirm-actions">
          <button type="button" className="danger compact" onClick={() => remove(confirmEntry)} disabled={saving}>Remove it</button>
          <button type="button" className="ghost compact" onClick={() => setConfirmRemove(null)}>Keep it</button>
        </span>
      </div>
    );
  })();

  const summary = template === null
    ? 'Loading…'
    : linkedCount === 0 && generalCount === 0
      ? `No ${noun} needs prep yet`
      : `${linkedCount} of ${exercises.length} ${noun}${exercises.length === 1 ? '' : 's'} need${linkedCount === 1 ? 's' : ''} prep`
        + (generalCount ? ` · ${generalCount} general` : '');

  return (
    <section className={`editor-card prep-panel prep-tiles-card${open ? ' is-open' : ''}`} id="prep-template">
      <button
        type="button"
        className="prep-tiles-head"
        aria-expanded={open}
        aria-controls="prep-template-body"
        onClick={toggleOpen}
      >
        <span className="prep-tiles-chevron" aria-hidden>▸</span>
        <h2>Prep template</h2>
        <span className="prep-tiles-summary">{summary}</span>
        {saving && <span className="muted prep-tiles-saving">Saving…</span>}
      </button>

      <div id="prep-template-body" hidden={!open}>
        <p className="muted prep-intro">
          Click each {noun} that needs prep. Trainers then stock those from
          the <strong>Prep</strong> tab.
        </p>

        {extraHeader}

        {template === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {exercises.length === 0 ? (
              <p className="muted">This {kindLabel} has no {noun}s yet.</p>
            ) : (
              <>
                <div className="prep-tiles-legend" aria-hidden>
                  <span><i />No prep</span>
                  <span><i className="is-on" />Needs prep</span>
                  <span><i className="has-kits" />Kits already stocked</span>
                </div>
                <div className={`prep-tiles-rows${rows.some(r => r.topic) ? '' : ' no-topics'}`}>
                  {rows.map(row => (
                    <div className="prep-tiles-row" key={row.topic?.id || 'untitled'}>
                      {row.topic && (
                        <span className="prep-tiles-topic" data-tip={row.topic.title}>{row.topic.title}</span>
                      )}
                      <span className="prep-tiles-set">
                        {row.items.map(s => {
                          const entry = bySection.get(s.id) || null;
                          const locked = entry && isLocked(entry);
                          const live = entry ? liveKitCount(counts, entry.header) > 0 : false;
                          const kits = entry ? kitsText(entry.header) : '';
                          // General prep shown with this exercise (show_with).
                          const extra = shownWith[s.id] || [];
                          const total = (entry ? 1 : 0) + extra.length;
                          const tip = [
                            titleOf(s),
                            row.topic?.title,
                            locked ? lockedNote?.(entry) || 'managed in another workbook' : null,
                            kits || null,
                            extra.length ? `also shown: ${extra.map(e => e.header).join(', ')}` : null,
                          ].filter(Boolean).join(' · ');
                          return (
                            <button
                              key={s.id}
                              id={`prep-tile-${s.id}`}
                              type="button"
                              className={`prep-tile${confirmRemove && entry?.header === confirmRemove ? ' is-asking' : ''}`}
                              aria-pressed={!!entry}
                              aria-label={`${titleOf(s)}${entry ? ' — needs prep' : ''}`}
                              data-tip={tip}
                              disabled={saving || locked}
                              onClick={() => (entry ? askRemove(entry) : pick(s))}
                            >
                              {tileLabel(titleOf(s))}
                              {live && <span className="prep-tile-kits" aria-hidden />}
                              {extra.length > 0 && (
                                <span className="prep-tile-count" aria-label={`${total} prep items`}>{total}</span>
                              )}
                            </button>
                          );
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* The question sits under whichever list the item is in. */}
            {confirmEntry && knownIds.has(confirmEntry.section_id) && confirmBar}

            <div className="prep-tiles-general">
              <h3>General prep</h3>
              <p className="muted">
                Prep every participant gets that belongs to no single {noun}, such as a demo PNR or a login.
              </p>
              <div className="prep-gen-chips">
                {[...general, ...stranded].map(entry => {
                  const gone = !!entry.section_id;
                  const locked = isLocked(entry);
                  const tip = [
                    gone ? `its ${noun} was removed` : null,
                    locked ? lockedNote?.(entry) || 'managed in another workbook' : null,
                    kitsText(entry.header) || null,
                  ].filter(Boolean).join(' · ');
                  return (
                    <span
                      key={entry.header}
                      className={`prep-gen-chip${gone ? ' is-gone' : ''}${confirmRemove === entry.header ? ' is-asking' : ''}`}
                      data-tip={tip || undefined}
                    >
                      {liveKitCount(counts, entry.header) > 0 && <span className="prep-tile-kits" aria-hidden />}
                      {entry.header}
                      {/* Which exercise it is shown with, in the drawer and on
                          the exercise itself. A select styled as a pill: one
                          click, and every exercise is a choice. */}
                      {!gone && !locked && exercises.length > 0 && (
                        <select
                          className="prep-gen-with"
                          value={entry.show_with && knownIds.has(entry.show_with) ? entry.show_with : ''}
                          disabled={saving}
                          aria-label={`Show ${entry.header} with an ${noun}`}
                          onChange={e => {
                            const to = e.target.value || null;
                            save(fresh => setShowWith(fresh, entry.header, to));
                          }}
                        >
                          <option value="">no {noun}</option>
                          {exercises.map(s => (
                            <option key={s.id} value={s.id}>with {tileLabel(titleOf(s))}</option>
                          ))}
                        </select>
                      )}
                      {!locked && (
                        <button
                          type="button"
                          className="prep-gen-x"
                          aria-label={`Remove ${entry.header}`}
                          disabled={saving}
                          onClick={() => askRemove(entry)}
                        >×</button>
                      )}
                    </span>
                  );
                })}
                {adding ? (
                  <form className="prep-gen-form" onSubmit={addGeneral}>
                    <input
                      className="form-input compact"
                      autoFocus
                      value={generalDraft}
                      onChange={e => { setGeneralDraft(e.target.value); setGeneralError(''); }}
                      onKeyDown={e => { if (e.key === 'Escape') { setAdding(false); setGeneralDraft(''); setGeneralError(''); } }}
                      placeholder="e.g. Demo PNR"
                      aria-label="Name of the general prep"
                    />
                    <button type="submit" className="ghost compact" disabled={saving || !generalDraft.trim()}>Add</button>
                    <button type="button" className="ghost compact" onClick={() => { setAdding(false); setGeneralDraft(''); setGeneralError(''); }}>Cancel</button>
                  </form>
                ) : (
                  <button type="button" className="prep-gen-add" onClick={() => setAdding(true)}>
                    + Add general prep
                  </button>
                )}
              </div>
              {generalError && <p className="error">{generalError}</p>}
              {confirmEntry && !knownIds.has(confirmEntry.section_id) && confirmBar}
            </div>

            {error && <p className="error">{error}</p>}

            {children}
          </>
        )}
      </div>
    </section>
  );
}
