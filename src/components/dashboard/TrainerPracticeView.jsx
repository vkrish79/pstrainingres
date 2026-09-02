import { useEffect, useMemo, useRef, useState } from 'react';
import { useTrainerPractice } from '../../hooks/useTrainerPractice.js';
import { useTrainerPrep } from '../../hooks/useTrainerPrep.js';
import { useTrainerNotes } from '../../hooks/useTrainerNotes.js';
import { useSessionFocus } from '../../hooks/useSessionFocus.js';
import { progressOf } from '../../lib/blockHelpers.js';
import Block from '../blocks/Block.jsx';
import { EditableBlock } from '../editor/ContentEditor.jsx';
import PrepDrawer from '../participant/PrepDrawer.jsx';
import NotesDrawer from '../participant/NotesDrawer.jsx';
import MonitorDrawer from './MonitorDrawer.jsx';
import '../../styles/workbook.css';

const TRAINER_PROMPTS = [
  "What tripped people up here?",
  "Timing — how long did this actually take?",
  "A better way to explain this next time…",
  "Question the room asked that you want an answer ready for.",
  "What worked well enough to repeat?",
  "Anything to fix in the exercise itself?",
  "Follow up with someone after the class?",
];

const ALL_KEY = '__all__';

const DRAW_MSG = {
  allocated: (n) => `Drew practice prep (${n} item${n === 1 ? '' : 's'}).`,
  partial: (n) => `Drew practice prep (${n} item${n === 1 ? '' : 's'}) — some source pools were empty.`,
  exists: () => 'You already have practice prep for this session.',
  exhausted: () => 'Prep pool is empty — ask for a top-up, then try again.',
  none: () => 'No prep is set up for this workbook.',
};

// Tab body: the session's trainer-facing fillable copy of the workbook.
// Answers persist server-side, scoped to the session — see useTrainerPractice.
// The trainer can draw one prep kit from the pool (useTrainerPrep) so prep-
// dependent exercises have real values to practise with, mirroring participants.
export default function TrainerPracticeView({
  sessionId, trainerId, prepEnabled = false,
  participants = [], participantAnswers = {}, liveBySection = {},
}) {
  const {
    loading, error, sections, blocks, answers, saveAnswer, updateBlockConfig,
  } = useTrainerPractice(sessionId, trainerId);
  const { prep, standalone, hasPrep, drawPrep } = useTrainerPrep(sessionId);
  const { notes: trainerNotes, saveNote } = useTrainerNotes(sessionId, trainerId);

  // Badge counts exercises that actually have something written, not words —
  // the trainer wants to know how much of the workbook they have annotated.
  const noteCount = useMemo(
    () => Object.values(trainerNotes).filter(n => (n?.note || '').replace(/<[^>]*>/g, '').trim()).length,
    [trainerNotes],
  );
  const { focus, spotlight, clear: clearSpotlight } = useSessionFocus(sessionId, trainerId);

  const [selectedSectionId, setSelectedSectionId] = useState(ALL_KEY);
  const [exFilter, setExFilter] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [drawMsg, setDrawMsg] = useState('');
  const [prepOpen, setPrepOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [monitorWide, setMonitorWide] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const barRef = useRef(null);
  const layoutRef = useRef(null);

  // Toggle content-edit mode. Entering it closes the right drawers so the
  // editable canvas isn't pushed under one.
  function toggleEdit() {
    setEditMode(m => {
      const next = !m;
      if (next) { setPrepOpen(false); setMonitorOpen(false); }
      return next;
    });
  }

  // Prep and Monitor are both right push-drawers; keep at most one open.
  function openNotes() { setPrepOpen(false); setMonitorOpen(false); setNotesOpen(true); }
  function openPrep() { setMonitorOpen(false); setNotesOpen(false); setPrepOpen(true); }
  function openMonitor() { setPrepOpen(false); setNotesOpen(false); setEditMode(false); setMonitorOpen(true); }

  // Push the page canvas left while a right drawer is open (no overlay); the
  // fixed drawer fills the gap. Mirrors the participant workbook view. One body
  // class each — mutual exclusivity (open*/) keeps them from stacking.
  useEffect(() => {
    document.body.classList.toggle('prep-drawer-pushed', prepOpen);
    document.body.classList.toggle('monitor-drawer-pushed', monitorOpen);
    document.body.classList.toggle('monitor-drawer-wide', monitorOpen && monitorWide);
    return () => {
      document.body.classList.remove('prep-drawer-pushed');
      document.body.classList.remove('monitor-drawer-pushed');
      document.body.classList.remove('monitor-drawer-wide');
    };
  }, [prepOpen, monitorOpen, monitorWide]);

  // Anchor the prep drawer's top to the sticky presenter bar so the two stay
  // aligned at any scroll position. The bar's rect.top already reflects its
  // sticky pin (clamps to ~60px under the TopBar), so we feed it straight to a
  // CSS var the drawer reads. rAF-coalesced so scroll stays smooth.
  useEffect(() => {
    if (!prepOpen && !monitorOpen) return undefined;
    let raf = 0;
    const sync = () => {
      raf = 0;
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      // Prep starts flush with the bar's top. The Monitor aligns with the
      // exercise row (nav + content tiles) — the layout's top — but never above
      // the bar's bottom, so it stays pinned under the sticky bar on scroll.
      const barBottom = Math.round(rect.bottom);
      const layoutTop = layoutRef.current
        ? Math.round(layoutRef.current.getBoundingClientRect().top)
        : barBottom;
      document.body.style.setProperty('--prep-drawer-top', `${Math.round(rect.top)}px`);
      document.body.style.setProperty('--monitor-bar-bottom', `${Math.max(layoutTop, barBottom)}px`);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(sync); };
    sync();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // The presenter bar un-wraps to full width as the push/exemption animates;
    // a ResizeObserver re-syncs once its height settles, so the monitor drawer
    // lands on the bar's true bottom instead of a mid-transition (too-low) value.
    const ro = new ResizeObserver(schedule);
    if (barRef.current) ro.observe(barRef.current);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      // Deliberately keep --prep-drawer-top: clearing it here would snap the
      // drawer's top to the 60px fallback mid-close, so it'd jump up to the
      // TopBar and grow before sliding out. The next open re-syncs it.
    };
  }, [prepOpen, monitorOpen]);

  // Esc closes whichever drawer is open.
  useEffect(() => {
    if (!prepOpen && !monitorOpen && !notesOpen) return undefined;
    function onKey(e) { if (e.key === 'Escape') { setPrepOpen(false); setMonitorOpen(false); setNotesOpen(false); } }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prepOpen, monitorOpen, notesOpen]);

  async function handleDrawPrep() {
    setDrawing(true);
    setDrawMsg('');
    const { data, error: err } = await drawPrep();
    setDrawing(false);
    if (err) { setDrawMsg(err.message); return; }
    const status = data?.status || 'none';
    setDrawMsg((DRAW_MSG[status] || DRAW_MSG.none)(data?.prepped || 0));
  }

  // Total participants online anywhere (each is on exactly one section), for
  // the Monitor button's live hint.
  const onlineTotal = useMemo(
    () => Object.values(liveBySection).reduce((n, arr) => n + (arr?.length || 0), 0),
    [liveBySection],
  );

  const sectionStats = useMemo(() => {
    return sections.map(sec => {
      const sBlocks = blocks.filter(b => b.section_id === sec.id);
      // Counts INPUTS, not blocks: a 10-cell table is ten things to fill, so
      // 100% means every radio, field and cell is done.
      const { total, filled, pct } = progressOf(sBlocks, id => answers[id]);
      return { id: sec.id, title: sec.title, kind: sec.kind || 'exercise', total, answered: filled, pct };
    });
  }, [sections, blocks, answers]);


  // Exercise-jump filter: narrows the sidebar to exercises whose title contains
  // the typed text. Titles already carry the exercise number ("Exercise 18"), so
  // a plain substring match handles both "18" and title words — and avoids the
  // false hits a position-based match caused (section order ≠ exercise number).
  // Enter jumps to the top match; Esc clears. Mirrors the participant copy.
  const filteredStats = useMemo(() => {
    const q = exFilter.trim().toLowerCase();
    if (!q) return sectionStats;
    return sectionStats.filter(s => s.title.toLowerCase().includes(q));
  }, [sectionStats, exFilter]);

  function onExFilterKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredStats.length) setSelectedSectionId(filteredStats[0].id);
    } else if (e.key === 'Escape') {
      setExFilter('');
    }
  }

  if (loading) return <div className="loading">Loading practice copy…</div>;
  if (error) return <p className="error">{error}</p>;

  const visibleSections = selectedSectionId === ALL_KEY
    ? sections
    : sections.filter(s => s.id === selectedSectionId);

  // Spotlight acts on the selected exercise (sidebar selection). Null in the
  // "All exercises" scroll view → the controls are disabled with a hint.
  const selectedSection = selectedSectionId === ALL_KEY
    ? null
    : sections.find(s => s.id === selectedSectionId) || null;

  // Which exercise is the live cohort focus, and was it set by a snap (hard)
  // vs a spotlight (soft)? snap_at === set_at means the latest action was a snap.
  const focusedSectionId = focus?.section_id || null;
  const focusIsSnap = !!focus?.snap_at && focus.snap_at === focus.set_at;

  // Monitor and edit-content are mutually exclusive with the cohort controls:
  // each disables the other's buttons (with a reason) so they can't conflict.
  const cohortLockMsg = monitorOpen
    ? 'Close Monitor to use cohort controls'
    : editMode
      ? 'Finish editing to use cohort controls'
      : null;

  return (
    <div className="practice-view">
      {/* Sticky My-copy toolbar: cohort controls (Spotlight / Snap / Monitor +
          focus chip) on the left; the trainer's own Prep set off on the right.
          Stays reachable while scrolling. Spotlight/Snap act on the selected
          exercise. */}
      <div className="presenter-bar" ref={barRef}>
        <span className="presenter-bar-label">Cohort</span>
        <button
          className={`ghost ${focus?.section_id && focus.section_id === selectedSection?.id ? 'active' : ''}`}
          onClick={() => selectedSection && spotlight(selectedSection)}
          disabled={!selectedSection || monitorOpen || editMode}
          title={cohortLockMsg || (selectedSection ? 'Show participants a banner pointing to this exercise (they choose to follow)' : 'Select an exercise first')}
        >
          🔦 Spotlight
        </button>
        <button
          className="ghost"
          onClick={() => selectedSection && spotlight(selectedSection, { hard: true })}
          disabled={!selectedSection || monitorOpen || editMode}
          title={cohortLockMsg || (selectedSection ? 'Jump every participant to this exercise now' : 'Select an exercise first')}
        >
          ⚡ Snap here
        </button>
        <button
          className={`ghost ${monitorOpen ? 'active' : ''}`}
          onClick={openMonitor}
          disabled={editMode}
          title={editMode ? 'Finish editing to monitor the cohort' : 'See who is on this exercise and their progress'}
        >
          👁 Monitor{onlineTotal > 0 ? ` (${onlineTotal})` : ''}
        </button>
        {focus?.section_id && (
          <span className="spotlight-chip" title="Currently broadcast to participants">
            {focusIsSnap ? '⚡ Snapped to' : '🔦 Spotlighting'} {focus.section_title}
            <button type="button" className="spotlight-chip-clear" onClick={clearSpotlight} aria-label="Clear spotlight">×</button>
          </span>
        )}
        <div className="presenter-bar-right">
          <button
            className={`ghost ${editMode ? 'active' : ''}`}
            onClick={toggleEdit}
            disabled={monitorOpen}
            title={monitorOpen ? 'Close Monitor to edit content' : (editMode ? 'Finish editing and return to your practice copy' : 'Edit the wording of any exercise in place — changes show to participants live')}
          >
            {editMode ? '✓ Done editing' : '✎ Edit content'}
          </button>
          {prepEnabled && !hasPrep && (
            <button className="ghost" onClick={handleDrawPrep} disabled={drawing || editMode}>
              {drawing ? 'Drawing…' : '🎯 Draw practice prep'}
            </button>
          )}
          {hasPrep && (
            <button className="ghost" onClick={openPrep} disabled={editMode}>🎯 Prep</button>
          )}
          <button className={`ghost ${notesOpen ? 'active' : ''}`} onClick={openNotes} disabled={editMode}>
            📝 My notes{noteCount > 0 ? ` (${noteCount})` : ''}
          </button>
        </div>
      </div>
      {drawMsg && <p className="prep-notice">{drawMsg}</p>}

      <div className="exresp-layout" ref={layoutRef}>
        <div className="exresp-mobile-nav">
          <select
            className="form-input"
            value={selectedSectionId}
            onChange={e => setSelectedSectionId(e.target.value)}
          >
            <option value={ALL_KEY}>All exercises</option>
            {sectionStats.map(s => (
              <option key={s.id} value={s.id} disabled={s.kind === 'group'}>
                {s.kind === 'group' ? `— ${s.title} —` : `${s.title} — ${s.pct}%`}
              </option>
            ))}
          </select>
        </div>

        <aside className="exresp-sidebar">
          <div className="exresp-sidebar-head">Exercises</div>
          <input
            type="text"
            className="exresp-sidebar-filter"
            placeholder="Jump to exercise…"
            value={exFilter}
            onChange={e => setExFilter(e.target.value)}
            onKeyDown={onExFilterKeyDown}
            aria-label="Filter exercises"
          />
          <ul className="exresp-sidebar-list">
            {!exFilter.trim() && (
              <li>
                <button
                  className={`exresp-sidebar-item ${selectedSectionId === ALL_KEY ? 'active' : ''}`}
                  onClick={() => setSelectedSectionId(ALL_KEY)}
                >
                  <div className="exresp-sidebar-row">
                    <span className="exresp-sidebar-title">All exercises</span>
                  </div>
                </button>
              </li>
            )}
            {filteredStats.length === 0 && (
              <li className="exresp-sidebar-empty">No exercises match “{exFilter.trim()}”</li>
            )}
            {filteredStats.map(s => {
              if (s.kind === 'group') {
                return (
                  <li key={s.id} className="exresp-sidebar-group-li">
                    <button
                      className="exresp-sidebar-group"
                      onClick={() => setSelectedSectionId(ALL_KEY)}
                      title="Group banner"
                    >
                      {s.title}
                    </button>
                  </li>
                );
              }
              const barClass = s.pct === 0 ? 'none' : s.pct === 100 ? 'full' : 'partial';
              const isActive = selectedSectionId === s.id;
              return (
                <li key={s.id}>
                  <button
                    className={`exresp-sidebar-item ${isActive ? 'active' : ''}`}
                    onClick={() => setSelectedSectionId(s.id)}
                  >
                    <div className="exresp-sidebar-row">
                      <span className="exresp-sidebar-title">
                        {s.title}
                        {focusedSectionId === s.id && (
                          <span className="spotlight-marker" title={focusIsSnap ? 'Snapped the cohort here' : 'Spotlighted for the cohort'}>
                            {focusIsSnap ? '⚡' : '🔦'}
                          </span>
                        )}
                      </span>
                      <span className="exresp-sidebar-pct">{s.pct}%</span>
                    </div>
                    <div className={`exresp-sidebar-bar ${barClass}`}>
                      <div className="exresp-sidebar-bar-fill" style={{ width: `${s.pct}%` }} />
                    </div>
                    <div className="exresp-sidebar-meta">{s.answered}/{s.total} answered</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="exresp-main">
          {editMode && (
            <p className="ce-hint">✎ Editing content — click any text to change its wording. Answer boxes and the layout are locked, and edits show to enrolled participants live. Press <strong>Done editing</strong> when finished.</p>
          )}
          {visibleSections.map(sec => (
            <section key={sec.id} className={`wb-section${sec.kind === 'group' ? ' wb-section-group' : ''}`}>
              {sec.kind === 'group' ? <h1 className="wb-section-group-title">{sec.title}</h1> : <h2>{sec.title}</h2>}
              {prep[sec.id]?.content && (
                <div className="participant-prep-callout">
                  <span className="participant-prep-callout-label">Prep</span>
                  {prep[sec.id].content}
                </div>
              )}
              {blocks
                .filter(b => b.section_id === sec.id)
                .map(b => (editMode ? (
                  <div key={b.id} className="wb-block">
                    <EditableBlock block={b} onSave={config => updateBlockConfig(b.id, config)} />
                  </div>
                ) : (
                  <Block
                    key={b.id}
                    block={b}
                    value={answers[b.id]}
                    onChange={v => saveAnswer(b.id, v)}
                  />
                )))}
            </section>
          ))}
        </div>
      </div>

      <PrepDrawer
        className="prep-drawer--track"
        open={prepOpen}
        onClose={() => setPrepOpen(false)}
        sections={sections}
        prep={prep}
        standalone={standalone}
      />
      <NotesDrawer
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        sections={sections}
        notes={trainerNotes}
        saveNote={saveNote}
        currentSectionId={selectedSectionId === ALL_KEY ? sections[0]?.id : selectedSectionId}
        prompts={TRAINER_PROMPTS}
      />
      <MonitorDrawer
        className="monitor-drawer--track"
        open={monitorOpen}
        onClose={() => setMonitorOpen(false)}
        onWideChange={setMonitorWide}
        section={selectedSectionId === ALL_KEY ? null : sections.find(s => s.id === selectedSectionId) || null}
        blocks={blocks}
        participants={participants}
        participantAnswers={participantAnswers}
        liveHere={liveBySection[selectedSectionId] || []}
      />
    </div>
  );
}
