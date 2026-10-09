import { useEffect, useMemo, useState } from 'react';
import { SkeletonPage } from '../components/Skeleton.jsx';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { supabase } from '../lib/supabase.js';
import { useWorkbookEditor } from '../hooks/useWorkbookEditor.js';
import { renumberExercises } from '../lib/exerciseNumbering.js';
import { linkedBySection, PREP_REVEAL_EVENT } from '../lib/prepTemplateEdit.js';
import { ALL } from '../components/editor/WorkbookOutline.jsx';
import KebabMenu from '../components/KebabMenu.jsx';
import WorkbookPrepPanel from '../components/editor/WorkbookPrepPanel.jsx';
import AddExercisesModal from '../components/editor/AddExercisesModal.jsx';
import ContentEditor from '../components/editor/ContentEditor.jsx';
import PlaceholderRepair from '../components/editor/PlaceholderRepair.jsx';
import ContentEditorScaffold from '../components/editor/ContentEditorScaffold.jsx';
import EditHeatModal from '../components/editor/EditHeatModal.jsx';
import WorkbookChangesModal from '../components/editor/WorkbookChangesModal.jsx';
import { useWorkbookEditHeat } from '../hooks/useWorkbookEditHeat.js';
import Block from '../components/blocks/Block.jsx';
import TopBar from '../components/TopBar.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { isSuperTrainerOrAbove } from '../lib/roles.js';
import '../styles/editor.css';
import '../styles/workbook.css';
import '../styles/dashboard.css';
import '../styles/edit-heat.css';
import '../styles/workbook-editor-head.css';

export default function WorkbookEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const {
    loading, error, workbook, sections, blocks,
    updateWorkbookTitle, updateVendorVisible, createBlock, updateBlock, deleteBlock, moveBlock, moveBlockTo,
    duplicateBlock, createSection, updateSectionTitle, deleteSection,
    deleteWorkbook, reload,
  } = useWorkbookEditor(id);

  const [titleDraft, setTitleDraft] = useState('');
  const [readOnlySectionId, setReadOnlySectionId] = useState('__all__');
  const [confirmDelWorkbook, setConfirmDelWorkbook] = useState(false);
  const [refByOnDelete, setRefByOnDelete] = useState([]); // composed workbooks drawing this pool
  const [delErr, setDelErr] = useState('');
  const [showPreview, setShowPreview] = useState(true);
  const [showAddExercises, setShowAddExercises] = useState(false);
  const [heatFocus, setHeatFocus] = useState(null); // { sectionId, sectionTitle, blockId, blockLabel }
  const [showAllChanges, setShowAllChanges] = useState(false);
  // The prep template as the Prep template card last loaded or saved it, so each
  // ticked exercise can carry a marker on its own heading.
  const [prepTemplate, setPrepTemplate] = useState(null);
  const prepBySection = useMemo(() => linkedBySection(prepTemplate), [prepTemplate]);
  // The Prep template card is out of the way until asked for: the header's
  // Prep chip shows it, and so does a "Needs prep" marker on any exercise
  // (they announce PREP_REVEAL_EVENT, which the card itself also answers).
  const [prepShown, setPrepShown] = useState(false);
  useEffect(() => {
    const show = () => setPrepShown(true);
    window.addEventListener(PREP_REVEAL_EVENT, show);
    return () => window.removeEventListener(PREP_REVEAL_EVENT, show);
  }, []);

  // Which exercise the editor shows, kept in the URL (?s=<section id>, or
  // ?s=all for the long scroll) so a reload or a shared link lands on the same
  // exercise. Unset or stale, it falls back to the first exercise.
  const [params, setParams] = useSearchParams();
  const sParam = params.get('s');
  function setFocus(sectionId) {
    setParams(prev => { const n = new URLSearchParams(prev); n.set('s', sectionId); return n; }, { replace: true });
  }

  // Adopting a line writes straight to the blocks table, so the editor's own
  // copy is stale the moment it lands. Reload the content as well as the heat,
  // or the page goes on showing the wording that was just replaced.
  function refreshAfterReview() {
    refreshHeat();
    reload();
  }

  // Jump from the all-changes modal to the exercise itself. The scaffold
  // already stamps data-section-id on every section for the preview
  // scroll-sync, so there is nothing new to thread through.
  function scrollToSection(sectionId) {
    // In the one-exercise view the target may not be on the page at all, so
    // show it first. Then wait for the modal to unmount and the layout to
    // settle before measuring where to scroll to.
    if (sParam !== ALL) setFocus(sectionId);
    setTimeout(() => {
      const el = document.querySelector(`[data-section-id="${sectionId}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('section-flash');
      setTimeout(() => el.classList.remove('section-flash'), 1600);
    }, 60);
  }

  // Only a master workbook has session clones to compare against, and only
  // super-tier can read the log. Vendor trainers reach this page through the
  // read-only branch below; firing a query for them would come back empty and
  // look broken. Sits above the early returns to keep hook order stable.
  const heatEnabled = workbook?.is_template === true && isSuperTrainerOrAbove(profile?.role);
  const {
    bySection, byBlock, openSections, totalSections, refresh: refreshHeat,
  } = useWorkbookEditHeat(id, heatEnabled);

  // Where "Back" goes. A workbook in the library belongs to the library; a
  // SESSION's copy belongs to its session, and sending a trainer to the
  // library from there drops them next to the master they did not just edit —
  // the same trap the quiz editor avoids.
  const [ownerSessionId, setOwnerSessionId] = useState(null);
  useEffect(() => {
    if (!workbook || workbook.is_template !== false) { setOwnerSessionId(null); return undefined; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('sessions').select('id').eq('workbook_id', workbook.id).limit(1).maybeSingle();
      if (!cancelled) setOwnerSessionId(data?.id || null);
    })();
    return () => { cancelled = true; };
  }, [workbook?.id, workbook?.is_template]);

  const backTo = ownerSessionId ? `/trainer/sessions/${ownerSessionId}` : '/trainer/workbooks';
  const backLabel = ownerSessionId ? '← Back to session' : '← Back to Workbooks';

  if (loading) return <><TopBar /><SkeletonPage body="lines" rows={6} label="Loading workbook…" /></>;
  if (error) return <><TopBar /><main className="page"><p className="error">{error}</p></main></>;

  const title = titleDraft !== '' ? titleDraft : (workbook?.title || '');

  async function commitTitle() {
    if (titleDraft && titleDraft !== workbook.title) {
      await updateWorkbookTitle(titleDraft);
    }
    setTitleDraft('');
  }

  async function handleDeleteWorkbook() {
    setDelErr('');
    const { error: e } = await runBusy('Deleting workbook…', () => deleteWorkbook());
    if (e) { setDelErr(e.message); return; }
    navigate('/trainer/workbooks');
  }

  const isTemplate = workbook?.is_template === true;
  // Templates are shared across sessions, so only super-tier may restructure
  // them. Session clones (is_template=false) stay editable for any trainer
  // who can reach the session.
  const canEdit = !isTemplate || isSuperTrainerOrAbove(profile?.role);

  if (!canEdit) {
    const ALL = '__all__';
    const visibleSections = readOnlySectionId === ALL
      ? sections
      : sections.filter(s => s.id === readOnlySectionId);
    return (
      <>
        <TopBar />
        <main className="page workbook">
          <section className="page-hero compact">
            <div className="page-hero-text">
              <Link to={backTo} className="back-link">{backLabel}</Link>
              <h1>{title || 'Untitled workbook'}</h1>
            </div>
          </section>

          <div className="exresp-layout">
            <div className="exresp-mobile-nav">
              <select
                className="form-input"
                value={readOnlySectionId}
                onChange={e => setReadOnlySectionId(e.target.value)}
              >
                <option value={ALL}>All exercises</option>
                {sections.map(s => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </div>

            <aside className="exresp-sidebar">
              <div className="exresp-sidebar-head">Exercises</div>
              <ul className="exresp-sidebar-list">
                <li>
                  <button
                    className={`exresp-sidebar-item ${readOnlySectionId === ALL ? 'active' : ''}`}
                    onClick={() => setReadOnlySectionId(ALL)}
                  >
                    <div className="exresp-sidebar-row">
                      <span className="exresp-sidebar-title">All exercises</span>
                    </div>
                  </button>
                </li>
                {sections.map(s => (
                  <li key={s.id}>
                    <button
                      className={`exresp-sidebar-item ${readOnlySectionId === s.id ? 'active' : ''}`}
                      onClick={() => setReadOnlySectionId(s.id)}
                    >
                      <div className="exresp-sidebar-row">
                        <span className="exresp-sidebar-title">{s.title}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>

            <div className="exresp-main">
              {visibleSections.length === 0 && <p className="muted">No sections yet.</p>}
              {visibleSections.map(sec => {
                const secBlocks = blocks
                  .filter(b => b.section_id === sec.id)
                  .sort((a, b) => a.order_index - b.order_index);
                const isGroup = sec.kind === 'group';
                return (
                  <section key={sec.id} className={`wb-section${isGroup ? ' wb-section-group' : ''}`}>
                    {isGroup ? <h1 className="wb-section-group-title">{sec.title}</h1> : <h2>{sec.title}</h2>}
                    {secBlocks.map(b => (
                      <Block key={b.id} block={b} value={undefined} onChange={() => {}} />
                    ))}
                  </section>
                );
              })}
            </div>
          </div>
        </main>
      </>
    );
  }

  // Session clones (is_template=false) get the content-only inline editor for
  // every role: tweak the wording of existing exercises, but no structural
  // changes (rows, columns, blocks, sections) — that's done on the template.
  if (!isTemplate) {
    return (
      <>
        <TopBar />
        <main className="page workbook">
          <section className="page-hero compact">
            <div className="page-hero-text">
              <Link to={backTo} className="back-link">{backLabel}</Link>
              <h1>{title || 'Untitled workbook'}</h1>
              <p>Session workbook — edit the wording of any exercise. Layout and answer fields are fixed; changes show to enrolled participants live.</p>
            </div>
          </section>
          <PlaceholderRepair sections={sections} blocks={blocks} onSaveBlock={updateBlock} isSessionCopy={!!ownerSessionId} />
          <ContentEditor sections={sections} blocks={blocks} onSaveBlock={updateBlock} />
        </main>
      </>
    );
  }

  const exercises = sections.filter(s => s.kind !== 'group');
  const focusId = sParam === ALL
    ? ALL
    : (sections.some(s => s.id === sParam) ? sParam : (exercises[0] || sections[0])?.id || ALL);
  const prepCount = prepTemplate ? exercises.filter(s => prepBySection.get(s.id)).length : null;

  async function askDeleteWorkbook() {
    setConfirmDelWorkbook(true);
    const { data: allWbs } = await supabase
      .from('workbooks').select('id, title, prep_template').eq('is_template', true);
    setRefByOnDelete((allWbs || [])
      .filter(w => w.id !== id && Array.isArray(w.prep_template)
        && w.prep_template.some(e => e?.source_workbook_id === id))
      .map(w => w.title));
  }

  function togglePrep() {
    if (prepShown) { setPrepShown(false); return; }
    // Opens the card if it was left shut, then brings it on screen.
    window.dispatchEvent(new CustomEvent(PREP_REVEAL_EVENT, { detail: {} }));
    setTimeout(() => document.querySelector('.wbe-prep-slot')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  // A new section opens straight away in the one-exercise view; a deleted one
  // hands over to its neighbour rather than jumping back to Exercise 1.
  async function createSectionAndShow(sectionTitle) {
    const res = await createSection(sectionTitle);
    if (res?.data?.id && focusId !== ALL) setFocus(res.data.id);
    return res;
  }
  async function deleteSectionAndMove(sectionId) {
    const i = sections.findIndex(s => s.id === sectionId);
    const neighbour = sections[i + 1] || sections[i - 1];
    const res = await deleteSection(sectionId);
    if (!res?.error && focusId === sectionId && neighbour) setFocus(neighbour.id);
    return res;
  }

  return (
    <>
      <TopBar />
      <main className={`page editor wbe-page ${showPreview ? 'with-preview' : ''}`}>
        {/* ONE header row. It replaces a hero card, a separate title card and
            the Prep card, which together put the first exercise 527px down a
            900px screen. The title is edited where it is shown; the rarely
            used actions are behind ⋯. */}
        <section className="wbe-head">
          <Link to={backTo} className="wbe-back">{backLabel}</Link>
          <input
            className="wbe-title"
            value={title}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
            aria-label="Workbook title"
            data-tip="Click to rename the workbook"
          />
          <span className="wbe-sub" data-tip="Changes here reach classes created from now on. Each class already running has its own copy.">Master copy</span>
          <div className="wbe-actions">
            {/* Shown whenever this workbook has ANY recorded change, not just
                open ones — otherwise the way in vanishes the moment you finish
                reviewing, the trap the grey tick on each marker avoids. */}
            {heatEnabled && totalSections > 0 && (
              <button
                type="button"
                className="wbe-chip wbe-heat"
                onClick={() => setShowAllChanges(true)}
                data-tip={openSections > 0
                  ? `${openSections} exercise${openSections === 1 ? '' : 's'} reworded in sessions and not yet reviewed`
                  : `Reworded in ${totalSections} exercise${totalSections === 1 ? '' : 's'}, all reviewed — see the history`}
              >
                <span className={`heat-dot heat-l${openSections > 0 ? 3 : 0}`} aria-hidden />
                {openSections > 0 ? `${openSections} to review` : 'Change history'}
              </button>
            )}
            <label className="wbe-switch" data-tip="Vendor trainers can find this workbook and run sessions from it">
              <input
                type="checkbox"
                checked={workbook?.vendor_visible ?? false}
                onChange={e => updateVendorVisible(e.target.checked)}
              />
              <span className="wbe-switch-track" aria-hidden />
              Vendors can use it
            </label>
            <button
              type="button"
              className={`wbe-chip wbe-prep${prepShown ? ' is-open' : ''}`}
              onClick={togglePrep}
              aria-expanded={prepShown}
            >
              <span className="wbe-prep-dot" aria-hidden />
              {prepCount == null ? 'Prep' : `Prep · ${prepCount} of ${exercises.length}`}
            </button>
            <button type="button" className="wbe-chip wbe-preview-toggle" onClick={() => setShowPreview(p => !p)} aria-pressed={showPreview}>
              {showPreview ? '◧ Hide preview' : '◨ Show preview'}
            </button>
            <KebabMenu
              label="More workbook actions"
              items={[
                { label: 'Add exercises from another workbook', glyph: '⊕', onClick: () => setShowAddExercises(true) },
                { label: 'Renumber exercises', glyph: '№', onClick: async () => { await renumberExercises(id); await reload(); } },
                { separator: true },
                { label: 'Delete workbook', glyph: '✕', danger: true, onClick: askDeleteWorkbook },
              ]}
            />
          </div>
        </section>
        {confirmDelWorkbook && (
          <div className="wbe-confirm">
            <span className="confirm-text">
              Delete workbook &amp; all sections/blocks?
              {refByOnDelete.length > 0 && (
                <> ⚠ Prep for <strong>{refByOnDelete.join(', ')}</strong> draws from this workbook — they’ll lose it.</>
              )}
            </span>
            <button className="danger" onClick={handleDeleteWorkbook}>Yes, delete</button>
            <button className="ghost" onClick={() => { setConfirmDelWorkbook(false); setDelErr(''); }}>No</button>
          </div>
        )}
        {delErr && <p className="error">{delErr}</p>}

        <PlaceholderRepair sections={sections} blocks={blocks} onSaveBlock={updateBlock} />

        {/* Always mounted, so the header chip has its count from the start;
            shown only when asked for. A wrapper with display:none rather than
            the hidden attribute, which the card's own display rule would win. */}
        {isTemplate && (
          <div className="wbe-prep-slot" style={prepShown ? undefined : { display: 'none' }}>
            <WorkbookPrepPanel workbook={workbook} sections={sections} profile={profile} onTemplate={setPrepTemplate} />
          </div>
        )}

        <ContentEditorScaffold
          sections={sections}
          blocks={blocks}
          onCreateBlock={createBlock}
          onMoveBlockTo={moveBlockTo}
          onUpdateBlock={updateBlock}
          onDeleteBlock={deleteBlock}
          onMoveBlock={moveBlock}
          onDuplicateBlock={duplicateBlock}
          onCreateSection={createSectionAndShow}
          onUpdateSectionTitle={updateSectionTitle}
          onDeleteSection={deleteSectionAndMove}
          showPreview={showPreview}
          previewTitle={title || 'Untitled workbook'}
          heat={heatEnabled ? { bySection, byBlock } : null}
          onOpenHeat={heatEnabled ? setHeatFocus : null}
          prepBySection={prepBySection}
          outline
          focusSectionId={focusId}
          onFocusSection={setFocus}
        />
      </main>
      {showAllChanges && (
        <WorkbookChangesModal
          workbookId={id}
          workbookTitle={title || 'Untitled workbook'}
          onClose={() => setShowAllChanges(false)}
          onResolved={refreshAfterReview}
          onJumpToSection={scrollToSection}
        />
      )}
      {heatFocus && (
        <EditHeatModal
          workbookId={id}
          sectionId={heatFocus.sectionId}
          sectionTitle={heatFocus.sectionTitle}
          blockId={heatFocus.blockId}
          blockLabel={heatFocus.blockLabel}
          onClose={() => setHeatFocus(null)}
          onResolved={refreshAfterReview}
        />
      )}
      {showAddExercises && (
        <AddExercisesModal
          currentWorkbookId={id}
          onClose={() => setShowAddExercises(false)}
          onAdded={reload}
        />
      )}
    </>
  );
}
