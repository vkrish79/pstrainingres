import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useWorkbook } from '../hooks/useWorkbook.js';
import { useParticipantNotes } from '../hooks/useParticipantNotes.js';
import { useParticipantPrep } from '../hooks/useParticipantPrep.js';
import { useProgramMaterials } from '../hooks/useProgramMaterials.js';
import { useSessionCursor } from '../hooks/useSessionCursor.js';
import { useSessionFocus } from '../hooks/useSessionFocus.js';
import { isFillableBlock, isAnswered } from '../lib/blockHelpers.js';
import { sanitizeNotesHtml, wordCountHtml } from '../lib/notesRichText.js';
import Block from '../components/blocks/Block.jsx';
import MaterialsList from '../components/MaterialsList.jsx';
import NotesDrawer from '../components/participant/NotesDrawer.jsx';
import PrepDrawer from '../components/participant/PrepDrawer.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/workbook.css';
import '../styles/print.css';
import '../styles/drawer.css';

const ALL_KEY = '__all__';

export default function ParticipantWorkbookPage() {
  const navigate = useNavigate();
  const { session: authSession } = useAuth();
  const { loading, error, session, workbook, sections, blocks, answers, savingMap, saveAnswer, recentlyUpdated } =
    useWorkbook(authSession?.user.id);
  const { notes: sectionNotes, saveNote } = useParticipantNotes(session?.id, authSession?.user.id);
  const { prep: sectionPrep, standalone: standalonePrep, expected: expectedPrep } = useParticipantPrep(session?.id, authSession?.user.id);
  const { materials, signedUrlFor: materialUrlFor, loading: materialsLoading } = useProgramMaterials(session?.id);

  const [selectedSectionId, setSelectedSectionId] = useState(ALL_KEY);
  const [exFilter, setExFilter] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);

  // Live presence: tell the trainer which exercise this participant is looking
  // at. The fill view defaults to one scrolling page (`__all__`), so the
  // current section comes from a scroll-spy (below) rather than the selector.
  const [currentSectionId, setCurrentSectionId] = useState(null);
  const sectionRefs = useRef({}); // sectionId -> DOM node
  const sidebarRef = useRef(null);
  const actionsBarRef = useRef(null);
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

  // Publish the sticky actions-bar height as --page-actions-h so the exercise
  // sidebar's sticky top can stack below it without overlapping.
  useEffect(() => {
    const el = actionsBarRef.current;
    if (!el) return undefined;
    const apply = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      document.body.style.setProperty('--page-actions-h', `${h}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.body.style.removeProperty('--page-actions-h');
    };
  }, []);

  // Push the page canvas left while the prep drawer is open (desktop). The
  // fixed drawer fills the gap. Cleaned up on close / unmount.
  useEffect(() => {
    document.body.classList.toggle('prep-drawer-pushed', prepOpen);
    return () => document.body.classList.remove('prep-drawer-pushed');
  }, [prepOpen]);

  // Keep the prep drawer pixel-locked to the exercise sidebar's top so it tucks
  // under the sticky bar exactly like the nav panel does. A per-frame rAF loop
  // (only while the drawer is open) re-reads the sidebar's live top every frame,
  // so no layout shift — scroll, sticky pin/unpin, or async reflow (materials
  // thumbnails loading) — can ever knock the two out of alignment. We only write
  // the CSS var when the value actually changes, so it's cheap.
  useEffect(() => {
    if (!prepOpen) return undefined;
    let raf = 0;
    let last = null;
    const loop = () => {
      const el = sidebarRef.current;
      if (el) {
        const top = Math.max(60, Math.round(el.getBoundingClientRect().top));
        if (top !== last) {
          last = top;
          document.body.style.setProperty('--page-prep-top', `${top}px`);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
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
        </section>

        <MaterialsList
          materials={materials}
          signedUrlFor={materialUrlFor}
          loading={materialsLoading}
        />

        <div className="participant-actions-bar no-print" ref={actionsBarRef}>
          {overallStatus && (
            <span className={`wb-save-indicator ${overallStatus}`}>
              {overallStatus === 'saving' ? 'Saving…' : overallStatus === 'error' ? 'Save failed' : 'All changes saved'}
            </span>
          )}
          <button
            type="button"
            className="ghost"
            onClick={() => setNotesOpen(true)}
            title="Open your notes (press N)"
          >
            📝 Notes{totalNoteWords > 0 ? ` (${totalNoteWords})` : ''}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setPrepOpen(true)}
            title="View your pre-work from the trainer"
          >
            🎯 Prep{prepCount > 0 ? ` (${prepCount})` : ''}
          </button>
          {session?.assessment_id && (
            <button
              type="button"
              className="ghost"
              onClick={() => navigate(`/assessment?session=${session.id}`)}
              title={session.assessment_unlocked_at ? 'Take the assessment for this program' : 'Locked — your trainer will unlock when ready'}
            >
              {session.assessment_unlocked_at ? '📝 Assessment' : '🔒 Assessment'}
            </button>
          )}
          <button
            type="button"
            className="ghost"
            onClick={() => window.print()}
            title="Open the print dialog. Choose 'Save as PDF' to download."
          >
            ↓ Print / Download PDF
          </button>
        </div>

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

          <aside className="exresp-sidebar" ref={sidebarRef}>
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
        expected={expectedPrep}
        className="prep-drawer--track-page"
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

