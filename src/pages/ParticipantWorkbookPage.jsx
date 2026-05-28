import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useWorkbook } from '../hooks/useWorkbook.js';
import { useParticipantNotes } from '../hooks/useParticipantNotes.js';
import { useParticipantPrep } from '../hooks/useParticipantPrep.js';
import { useSessionCursor } from '../hooks/useSessionCursor.js';
import { useSessionFocus } from '../hooks/useSessionFocus.js';
import { isFillableBlock, isAnswered } from '../lib/blockHelpers.js';
import { sanitizeNotesHtml, wordCountHtml } from '../lib/notesRichText.js';
import Block from '../components/blocks/Block.jsx';
import NotesDrawer from '../components/participant/NotesDrawer.jsx';
import PrepDrawer from '../components/participant/PrepDrawer.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/workbook.css';
import '../styles/print.css';
import '../styles/drawer.css';

const ALL_KEY = '__all__';
const VIEW_MODE_KEY = 'pstrainingres.wb.viewMode';

export default function ParticipantWorkbookPage() {
  const { session: authSession } = useAuth();
  const { loading, error, session, workbook, sections, blocks, answers, savingMap, saveAnswer, recentlyUpdated } =
    useWorkbook(authSession?.user.id);
  const { notes: sectionNotes, saveNote } = useParticipantNotes(session?.id, authSession?.user.id);
  const { prep: sectionPrep, standalone: standalonePrep } = useParticipantPrep(session?.id, authSession?.user.id);

  const [selectedSectionId, setSelectedSectionId] = useState(ALL_KEY);
  const [exFilter, setExFilter] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);

  // Slide-deck vs scroll mode. Persists per-browser so the participant's last
  // preference sticks across reloads. Default = scroll (current behavior).
  const [viewMode, setViewModeRaw] = useState(() => {
    try { return localStorage.getItem(VIEW_MODE_KEY) === 'slides' ? 'slides' : 'scroll'; }
    catch { return 'scroll'; }
  });
  const setViewMode = (m) => {
    setViewModeRaw(m);
    try { localStorage.setItem(VIEW_MODE_KEY, m); } catch { /* private mode */ }
  };
  // Slide index into sections[] when in slides mode. Direction drives the
  // enter animation (slide-in from right when going forward, from left when
  // going back). Bumping animKey forces React to remount the slide content
  // so the CSS animation fires every time, even when stepping to the same
  // direction repeatedly.
  const [slideIdx, setSlideIdx] = useState(0);
  const [slideDir, setSlideDir] = useState('forward');
  const [animKey, setAnimKey] = useState(0);

  // Live presence: tell the trainer which exercise this participant is looking
  // at. The fill view defaults to one scrolling page (`__all__`), so the
  // current section comes from a scroll-spy (below) rather than the selector.
  const [currentSectionId, setCurrentSectionId] = useState(null);
  const sectionRefs = useRef({}); // sectionId -> DOM node
  useSessionCursor(session?.id, {
    selfId: authSession?.user.id,
    track: true,
    sectionId: currentSectionId,
    sectionTitle: sections.find(s => s.id === currentSectionId)?.title || '',
  });

  // Trainer spotlight: a soft banner the participant can follow, plus a
  // one-time force-jump on a hard snap (a change in focus.snap_at).
  const { focus } = useSessionFocus(session?.id, authSession?.user.id);
  const [spotlightDismissedAt, setSpotlightDismissedAt] = useState(null);
  const lastSnapRef = useRef(undefined);
  const snapInitRef = useRef(false);
  // useLayoutEffect (pre-paint) so a hard snap jumps + suppresses the banner
  // without it ever flashing — the banner is the SOFT spotlight's affordance;
  // on a snap the participant is already being moved, so it's not shown.
  useLayoutEffect(() => {
    if (!focus) return;
    // Seed from the first value we see so joining mid-session doesn't yank.
    if (!snapInitRef.current) {
      snapInitRef.current = true;
      lastSnapRef.current = focus.snap_at ?? null;
      return;
    }
    // Force-jump once per hard snap: snap_at changed AND points at a section.
    if (focus.section_id && focus.snap_at && focus.snap_at !== lastSnapRef.current) {
      lastSnapRef.current = focus.snap_at;
      setSelectedSectionId(focus.section_id);
      setSpotlightDismissedAt(focus.set_at); // already moved → no soft banner
    }
  }, [focus]);

  const showSpotlight = !!focus?.section_id && focus.set_at !== spotlightDismissedAt;

  const prepCount = useMemo(
    () => Object.values(sectionPrep).filter(p => (p?.content || '').trim()).length + standalonePrep.length,
    [sectionPrep, standalonePrep]
  );

  // Push the page canvas left while the prep drawer is open (desktop). The
  // fixed drawer fills the gap. Cleaned up on close / unmount.
  useEffect(() => {
    document.body.classList.toggle('prep-drawer-pushed', prepOpen);
    return () => document.body.classList.remove('prep-drawer-pushed');
  }, [prepOpen]);

  // Keyboard shortcut: "N" toggles the drawer. Skip when typing in an input,
  // textarea, contenteditable, or when meta/ctrl/alt is held (let real
  // shortcuts through).
  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Escape always closes the drawer if it's open, even while typing in
      // the note textarea — that's the expected dismiss gesture.
      if (e.key === 'Escape' && notesOpen) {
        setNotesOpen(false);
        return;
      }
      if (e.key === 'Escape' && prepOpen) {
        setPrepOpen(false);
        return;
      }
      const t = e.target;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setNotesOpen(o => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notesOpen, prepOpen]);

  const notesByCount = useMemo(() => {
    const out = {};
    for (const s of Object.values(sectionNotes)) {
      out[s.section_id] = wordCountHtml(s.note || '');
    }
    return out;
  }, [sectionNotes]);

  const totalNoteWords = useMemo(
    () => Object.values(notesByCount).reduce((a, b) => a + b, 0),
    [notesByCount]
  );

  const overallStatus = useMemo(() => {
    const statuses = Object.values(savingMap);
    if (statuses.includes('saving')) return 'saving';
    if (statuses.includes('error')) return 'error';
    if (statuses.length) return 'saved';
    return null;
  }, [savingMap]);

  // Per-section progress for the sidebar
  const sectionStats = useMemo(() => {
    return sections.map(sec => {
      const sBlocks = blocks.filter(b => b.section_id === sec.id);
      const fillable = sBlocks.filter(isFillableBlock);
      const answered = fillable.reduce((n, b) => n + (isAnswered(b, answers[b.id]) ? 1 : 0), 0);
      const pct = fillable.length ? Math.round((answered / fillable.length) * 100) : 0;
      return { id: sec.id, title: sec.title, kind: sec.kind || 'exercise', total: fillable.length, answered, pct };
    });
  }, [sections, blocks, answers]);

  // Exercise-jump filter: narrows the sidebar to exercises whose title contains
  // the typed text. Titles already carry the exercise number ("Exercise 18"), so
  // a plain substring match handles both "18" and title words — and avoids the
  // false hits a position-based match caused (section order ≠ exercise number).
  // Enter jumps to the top match; Esc clears. See docs/enhancements-roadmap.md #4.
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

  // If a section is deleted while we're viewing it, fall back to "All".
  useEffect(() => {
    if (selectedSectionId !== ALL_KEY && !sections.find(s => s.id === selectedSectionId)) {
      setSelectedSectionId(ALL_KEY);
    }
  }, [sections, selectedSectionId]);

  // Scroll-spy: which section sits in the viewport's active band. Feeds the
  // trainer's live "On now" column. In single-section mode there's nothing to
  // spy — the selected section is, by definition, the current one.
  useEffect(() => {
    if (loading) return undefined;
    if (selectedSectionId !== ALL_KEY) {
      setCurrentSectionId(selectedSectionId);
      return undefined;
    }
    const visible = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = e.target.dataset.sectionId;
          if (e.isIntersecting) visible.add(id); else visible.delete(id);
        }
        // First section (document order) inside the band is the current one.
        const cur = sections.find(s => visible.has(s.id));
        if (cur) setCurrentSectionId(cur.id);
      },
      // Active band: from 80px below the top to ~35% down the viewport.
      { rootMargin: '-80px 0px -65% 0px', threshold: 0 }
    );
    for (const sec of sections) {
      const el = sectionRefs.current[sec.id];
      if (el) observer.observe(el);
    }
    // Seed a value before the first scroll event fires.
    setCurrentSectionId(prev => prev || sections[0]?.id || null);
    return () => observer.disconnect();
  }, [loading, selectedSectionId, sections]);

  if (loading) return <><TopBar /><div className="loading">Loading workbook…</div></>;
  if (error) {
    return (
      <>
        <TopBar />
        <main className="page">
          <section className="page-hero compact">
            <div className="page-hero-text">
              <h1>Welcome</h1>
              <p>{error}</p>
            </div>
          </section>
        </main>
      </>
    );
  }

  const visibleSections = selectedSectionId === ALL_KEY
    ? sections
    : sections.filter(s => s.id === selectedSectionId);

  // ===== Slide-deck mode wiring =====
  // Clamp slide index to a valid range whenever sections change (workbook
  // edits live-broadcast new sections in / removed sections out).
  useEffect(() => {
    if (viewMode !== 'slides') return;
    if (slideIdx >= sections.length) setSlideIdx(Math.max(0, sections.length - 1));
  }, [viewMode, sections.length, slideIdx]);

  const currentSlideSection = viewMode === 'slides' ? sections[slideIdx] : null;
  // Broadcast the slide section as the participant's "on now" cursor so the
  // trainer sees an accurate position. The scroll-spy below handles scroll mode.
  useEffect(() => {
    if (viewMode === 'slides' && currentSlideSection) {
      setCurrentSectionId(currentSlideSection.id);
    }
  }, [viewMode, currentSlideSection?.id]);

  const goSlide = (delta) => {
    setSlideIdx(prev => {
      const next = Math.min(sections.length - 1, Math.max(0, prev + delta));
      if (next !== prev) {
        setSlideDir(delta > 0 ? 'forward' : 'backward');
        setAnimKey(k => k + 1);
      }
      return next;
    });
  };
  const jumpSlide = (targetIdx) => {
    if (targetIdx < 0 || targetIdx >= sections.length) return;
    setSlideIdx(prev => {
      if (targetIdx === prev) return prev;
      setSlideDir(targetIdx > prev ? 'forward' : 'backward');
      setAnimKey(k => k + 1);
      return targetIdx;
    });
  };

  // Keyboard: ←/→ pages the deck. Skip while typing in a field, while a
  // drawer is open, or while a modifier is held (real browser shortcuts).
  useEffect(() => {
    if (viewMode !== 'slides') return undefined;
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (notesOpen || prepOpen) return;
      const t = e.target;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goSlide(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goSlide(1); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, notesOpen, prepOpen, sections.length]);

  // Touch swipe (mobile). Track horizontal delta; trigger paging at
  // ≥ 50px with the swipe gesture's dominant axis being horizontal.
  const touchRef = useRef(null);
  function onTouchStart(e) {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }
  function onTouchEnd(e) {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 50) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.2) return; // mostly vertical → scroll
    if (Date.now() - start.t > 800) return; // too slow to be a swipe
    goSlide(dx < 0 ? 1 : -1);
  }

  return (
    <>
      <TopBar />
      <main className="page workbook">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <h1>
              {workbook.title}
              {session?.city_code && <span className="city-tag inline">{session.city_code}</span>}
            </h1>
            <p>
              {session?.name}
              {(session?.starts_at || session?.ends_at) && (
                <span className="session-dates"> · {formatDateRange(session.starts_at, session.ends_at)}</span>
              )}
            </p>
            {workbook.description && <p className="muted">{workbook.description}</p>}
          </div>
          <div className="page-hero-actions">
            {overallStatus && (
              <span className={`wb-save-indicator ${overallStatus}`}>
                {overallStatus === 'saving' ? 'Saving…' : overallStatus === 'error' ? 'Save failed' : 'All changes saved'}
              </span>
            )}
            <button
              type="button"
              className="ghost no-print"
              onClick={() => setNotesOpen(true)}
              title="Open your notes (press N)"
            >
              📝 Notes{totalNoteWords > 0 ? ` (${totalNoteWords})` : ''}
            </button>
            <button
              type="button"
              className="ghost no-print"
              onClick={() => setPrepOpen(true)}
              title="View your pre-work from the trainer"
            >
              🎯 Prep{prepCount > 0 ? ` (${prepCount})` : ''}
            </button>
            <button
              type="button"
              className="ghost no-print"
              onClick={() => {
                const next = viewMode === 'slides' ? 'scroll' : 'slides';
                setViewMode(next);
                if (next === 'slides') {
                  // Seed slide position from the currently-selected section
                  // (or the scroll-spy's current section) so toggling doesn't
                  // jump to the cover.
                  const seedId = selectedSectionId !== ALL_KEY ? selectedSectionId : currentSectionId;
                  const seedIdx = sections.findIndex(s => s.id === seedId);
                  setSlideIdx(seedIdx >= 0 ? seedIdx : 0);
                  setAnimKey(k => k + 1);
                }
              }}
              title={viewMode === 'slides' ? 'Switch back to one long scrolling page' : 'Page through one exercise at a time, like flipping pages'}
            >
              {viewMode === 'slides' ? '📜 Scroll mode' : '📖 Slides mode'}
            </button>
            <button
              type="button"
              className="ghost no-print"
              onClick={() => window.print()}
              title="Open the print dialog. Choose 'Save as PDF' to download."
            >
              ↓ Print / Download PDF
            </button>
          </div>
        </section>

        {showSpotlight && (
          <div className="spotlight-banner" role="status">
            <span className="spotlight-banner-text">🔦 Your trainer is on <strong>{focus.section_title}</strong></span>
            <div className="spotlight-banner-actions">
              <button
                type="button"
                className="spotlight-jump"
                onClick={() => { setSelectedSectionId(focus.section_id); setSpotlightDismissedAt(focus.set_at); }}
              >
                Jump to it
              </button>
              <button
                type="button"
                className="spotlight-dismiss"
                onClick={() => setSpotlightDismissedAt(focus.set_at)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {viewMode === 'slides' && currentSlideSection && (
          <SlidesDeck
            sections={sections}
            sectionStats={sectionStats}
            slideIdx={slideIdx}
            slideDir={slideDir}
            animKey={animKey}
            jumpSlide={jumpSlide}
            goSlide={goSlide}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            currentSection={currentSlideSection}
            blocks={blocks}
            answers={answers}
            saveAnswer={saveAnswer}
            recentlyUpdated={recentlyUpdated}
            sectionPrep={sectionPrep}
          />
        )}

        {viewMode === 'scroll' && (
        <div className="exresp-layout">
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
                // Group sections (Word H1) are non-clickable divider banners
                // that visually group the exercises that follow them.
                if (s.kind === 'group') {
                  // Click jumps to the banner in the "All" view rather than
                  // filtering to just the group (which would show an empty
                  // page — groups carry no exercise blocks of their own).
                  return (
                    <li key={s.id} className="exresp-sidebar-group-li">
                      <button
                        className="exresp-sidebar-group"
                        onClick={() => {
                          setSelectedSectionId(ALL_KEY);
                          requestAnimationFrame(() => {
                            const el = sectionRefs.current[s.id];
                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          });
                        }}
                        title="Jump to this section"
                      >
                        {s.title}
                      </button>
                    </li>
                  );
                }
                const barClass = s.pct === 0 ? 'none' : s.pct === 100 ? 'full' : 'partial';
                const isActive = selectedSectionId === s.id;
                const noteWords = notesByCount[s.id] || 0;
                return (
                  <li key={s.id}>
                    <button
                      className={`exresp-sidebar-item ${isActive ? 'active' : ''}`}
                      onClick={() => setSelectedSectionId(s.id)}
                    >
                      <div className="exresp-sidebar-row">
                        <span className="exresp-sidebar-title">
                          {s.title}
                          {noteWords > 0 && (
                            <span className="exresp-sidebar-note-badge" title={`${noteWords} word${noteWords === 1 ? '' : 's'} in note`}>
                              💬 {noteWords}
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
            {/* Print-only header shown at the top of the PDF so trainers / the
                participant know whose answers they're looking at. */}
            <div className="print-only print-header">
              <h1>{workbook.title}</h1>
              <p>
                {session?.name}
                {session?.city_code && ` · ${session.city_code}`}
                {(session?.starts_at || session?.ends_at) && ` · ${formatDateRange(session.starts_at, session.ends_at)}`}
              </p>
            </div>
            {visibleSections.map(sec => {
              const noteText = sectionNotes[sec.id]?.note || '';
              const prepText = sectionPrep[sec.id]?.content || '';
              const isGroup = sec.kind === 'group';
              return (
                <section
                  key={sec.id}
                  className={`wb-section${isGroup ? ' wb-section-group' : ''}`}
                  data-section-id={sec.id}
                  ref={el => { sectionRefs.current[sec.id] = el; }}
                >
                  {isGroup ? <h1 className="wb-section-group-title">{sec.title}</h1> : <h2>{sec.title}</h2>}
                  {prepText && (
                    <div className="participant-prep-callout">
                      <span className="participant-prep-callout-label">Pre-work from your trainer</span>
                      {prepText}
                    </div>
                  )}
                  {blocks.filter(b => b.section_id === sec.id).map(b => (
                    <Block
                      key={b.id}
                      block={b}
                      value={answers[b.id]}
                      onChange={v => saveAnswer(b.id, v)}
                      recentlyUpdated={!!recentlyUpdated[b.id]}
                    />
                  ))}
                  {/* Print-only: render participant note inline as formatted
                      HTML (the drawer textarea is screen-only). */}
                  {noteText && (
                    <div className="print-only participant-note-row">
                      <div className="participant-note-label">My notes</div>
                      <div
                        className="participant-note-print"
                        dangerouslySetInnerHTML={{ __html: sanitizeNotesHtml(noteText) }}
                      />
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
        )}
      </main>
      <NotesDrawer
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        sections={sections}
        notes={sectionNotes}
        saveNote={saveNote}
        currentSectionId={selectedSectionId === ALL_KEY ? sections[0]?.id : selectedSectionId}
      />
      <PrepDrawer
        open={prepOpen}
        onClose={() => setPrepOpen(false)}
        sections={sections}
        prep={sectionPrep}
        standalone={standalonePrep}
      />
    </>
  );
}

function formatDateRange(start, end) {
  const fmt = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (start && end) return `${fmt(start)} → ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  if (end) return `Until ${fmt(end)}`;
  return '';
}

// Slide-deck view of the workbook: one section at a time, with a top progress
// strip + edge arrows + keyboard / swipe navigation. The animation lives in
// CSS — keying the inner card with animKey forces React to remount it, so
// the slide-in keyframe fires on every advance even when stepping the same
// direction repeatedly.
function SlidesDeck({
  sections, sectionStats, slideIdx, slideDir, animKey,
  jumpSlide, goSlide, onTouchStart, onTouchEnd,
  currentSection, blocks, answers, saveAnswer, recentlyUpdated, sectionPrep,
}) {
  const isFirst = slideIdx === 0;
  const isLast = slideIdx >= sections.length - 1;
  const isGroup = currentSection.kind === 'group';
  const prepText = sectionPrep[currentSection.id]?.content || '';
  const stats = sectionStats[slideIdx];

  return (
    <div
      className="slides-deck"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="slides-progress">
        <div className="slides-progress-bar">
          <div
            className="slides-progress-fill"
            style={{ width: `${((slideIdx + 1) / sections.length) * 100}%` }}
          />
        </div>
        <div className="slides-progress-meta">
          <span className="slides-progress-count">
            {slideIdx + 1} <span className="muted">/ {sections.length}</span>
          </span>
          {stats && stats.kind !== 'group' && stats.total > 0 && (
            <span className="slides-progress-pct">{stats.pct}% answered</span>
          )}
        </div>
        <div className="slides-progress-dots" role="tablist" aria-label="Section navigator">
          {sections.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === slideIdx}
              aria-label={s.title}
              title={s.title}
              className={`slides-dot ${s.kind === 'group' ? 'group' : ''} ${i === slideIdx ? 'active' : ''} ${i < slideIdx ? 'past' : ''}`}
              onClick={() => jumpSlide(i)}
            />
          ))}
        </div>
      </div>

      <div className="slides-stage">
        <button
          type="button"
          className="slides-edge slides-edge-prev"
          onClick={() => goSlide(-1)}
          disabled={isFirst}
          aria-label="Previous exercise"
        >
          ‹
        </button>

        <div className={`slides-card-wrap dir-${slideDir}`} key={animKey}>
          <section className={`wb-section${isGroup ? ' wb-section-group' : ''} slides-card`}>
            {isGroup
              ? <h1 className="wb-section-group-title">{currentSection.title}</h1>
              : <h2>{currentSection.title}</h2>}
            {prepText && (
              <div className="participant-prep-callout">
                <span className="participant-prep-callout-label">Pre-work from your trainer</span>
                {prepText}
              </div>
            )}
            {blocks.filter(b => b.section_id === currentSection.id).map(b => (
              <Block
                key={b.id}
                block={b}
                value={answers[b.id]}
                onChange={v => saveAnswer(b.id, v)}
                recentlyUpdated={!!recentlyUpdated[b.id]}
              />
            ))}
          </section>
        </div>

        <button
          type="button"
          className="slides-edge slides-edge-next"
          onClick={() => goSlide(1)}
          disabled={isLast}
          aria-label="Next exercise"
        >
          ›
        </button>
      </div>

      <div className="slides-foot">
        <button
          type="button"
          className="slides-foot-btn"
          onClick={() => goSlide(-1)}
          disabled={isFirst}
        >
          ‹ Previous
        </button>
        <div className="slides-foot-title">{currentSection.title}</div>
        <button
          type="button"
          className="slides-foot-btn primary"
          onClick={() => goSlide(1)}
          disabled={isLast}
        >
          Next ›
        </button>
      </div>
    </div>
  );
}
