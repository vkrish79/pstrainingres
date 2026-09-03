import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { supabase } from '../lib/supabase.js';
import { useWorkbookEditor } from '../hooks/useWorkbookEditor.js';
import { renumberExercises } from '../lib/exerciseNumbering.js';
import WorkbookPrepPanel from '../components/editor/WorkbookPrepPanel.jsx';
import AddExercisesModal from '../components/editor/AddExercisesModal.jsx';
import ContentEditor from '../components/editor/ContentEditor.jsx';
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

export default function WorkbookEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const {
    loading, error, workbook, sections, blocks,
    updateWorkbookTitle, updateVendorVisible, createBlock, updateBlock, deleteBlock, moveBlock,
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
    // One frame, so the modal has unmounted and the layout has settled before
    // we measure where to scroll to.
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-section-id="${sectionId}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('section-flash');
      setTimeout(() => el.classList.remove('section-flash'), 1600);
    });
  }

  // Only a master workbook has session clones to compare against, and only
  // super-tier can read the log. Vendor trainers reach this page through the
  // read-only branch below; firing a query for them would come back empty and
  // look broken. Sits above the early returns to keep hook order stable.
  const heatEnabled = workbook?.is_template === true && isSuperTrainerOrAbove(profile?.role);
  const {
    bySection, byBlock, openSections, totalSections, refresh: refreshHeat,
  } = useWorkbookEditHeat(id, heatEnabled);

  if (loading) return <><TopBar /><div className="loading">Loading workbook…</div></>;
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
    navigate('/trainer');
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
              <Link to="/trainer" className="back-link">&larr; Back</Link>
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
              <Link to="/trainer" className="back-link">&larr; Back</Link>
              <h1>{title || 'Untitled workbook'}</h1>
              <p>Session workbook — edit the wording of any exercise. Layout and answer fields are fixed; changes show to enrolled participants live.</p>
            </div>
          </section>
          <ContentEditor sections={sections} blocks={blocks} onSaveBlock={updateBlock} />
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <main className={`page editor ${showPreview ? 'with-preview' : ''}`}>
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>Workbook editor</h1>
            <p>Edits broadcast live to enrolled participants. Their answers stay attached to stable block IDs, so renames and reorders don't lose data.</p>
            {/* The way in that needs no scrolling. Shown whenever this workbook
                has ANY recorded change, not just open ones — otherwise the
                entry point vanishes the moment you finish reviewing, which is
                the trap the grey tick on each marker exists to avoid. */}
            {heatEnabled && totalSections > 0 && (
              <button
                type="button"
                className="wb-heat-note wb-heat-btn"
                onClick={() => setShowAllChanges(true)}
              >
                <span className={`heat-dot heat-l${openSections > 0 ? 3 : 0}`} aria-hidden />
                {openSections > 0
                  ? `${openSections} exercise${openSections === 1 ? '' : 's'} reworded in sessions and not yet reviewed — review them all`
                  : `Reworded in ${totalSections} exercise${totalSections === 1 ? '' : 's'}, all reviewed — see the history`}
              </button>
            )}
          </div>
          <div className="page-hero-actions">
            <button className="ghost" onClick={() => setShowPreview(p => !p)}>
              {showPreview ? '◧ Hide preview' : '◨ Show preview'}
            </button>
            {isTemplate && (
              confirmDelWorkbook ? (
                <>
                  <span className="confirm-text">
                    Delete workbook &amp; all sections/blocks?
                    {refByOnDelete.length > 0 && (
                      <> ⚠ Prep for <strong>{refByOnDelete.join(', ')}</strong> draws from this workbook — they’ll lose it.</>
                    )}
                  </span>
                  <button className="danger" onClick={handleDeleteWorkbook}>Yes</button>
                  <button className="ghost" onClick={() => { setConfirmDelWorkbook(false); setDelErr(''); }}>No</button>
                </>
              ) : (
                <button
                  className="ghost danger"
                  onClick={async () => {
                    setConfirmDelWorkbook(true);
                    const { data: allWbs } = await supabase
                      .from('workbooks').select('id, title, prep_template').eq('is_template', true);
                    setRefByOnDelete((allWbs || [])
                      .filter(w => w.id !== id && Array.isArray(w.prep_template)
                        && w.prep_template.some(e => e?.source_workbook_id === id))
                      .map(w => w.title));
                  }}
                >Delete workbook</button>
              )
            )}
          </div>
        </section>
        {delErr && <p className="error">{delErr}</p>}

        <section className="editor-card">
          <label className="form-label">Workbook title</label>
          <input
            className="form-input large"
            value={title}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
          />
          <label className="checkbox-row" style={{ marginTop: '0.75rem' }}>
            <input
              type="checkbox"
              checked={workbook?.vendor_visible ?? false}
              onChange={e => updateVendorVisible(e.target.checked)}
            />
            <span>Visible to vendors <span className="muted">— vendor trainers can find this workbook and run sessions from it</span></span>
          </label>
        </section>

        {isTemplate && <WorkbookPrepPanel workbook={workbook} sections={sections} profile={profile} />}

        <ContentEditorScaffold
          sections={sections}
          blocks={blocks}
          onCreateBlock={createBlock}
          onUpdateBlock={updateBlock}
          onDeleteBlock={deleteBlock}
          onMoveBlock={moveBlock}
          onDuplicateBlock={duplicateBlock}
          onCreateSection={createSection}
          onUpdateSectionTitle={updateSectionTitle}
          onDeleteSection={deleteSection}
          showPreview={showPreview}
          previewTitle={title || 'Untitled workbook'}
          heat={heatEnabled ? { bySection, byBlock } : null}
          onOpenHeat={heatEnabled ? setHeatFocus : null}
          extraAddSectionActions={
            <>
              <button className="ghost" onClick={() => setShowAddExercises(true)}>➕ Add exercises from another workbook</button>
              <button className="ghost" onClick={async () => { await renumberExercises(id); await reload(); }}>🔢 Renumber exercises</button>
            </>
          }
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
