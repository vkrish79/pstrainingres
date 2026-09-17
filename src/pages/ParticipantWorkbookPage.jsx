import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SkeletonPage } from '../components/Skeleton.jsx';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useWorkbook } from '../hooks/useWorkbook.js';
import { useParticipantNotes } from '../hooks/useParticipantNotes.js';
import { useParticipantPrep } from '../hooks/useParticipantPrep.js';
import { useProgramMaterials } from '../hooks/useProgramMaterials.js';
import { useSessionCursor } from '../hooks/useSessionCursor.js';
import { useHelpRequests } from '../hooks/useHelpRequests.js';
import { useSessionFocus } from '../hooks/useSessionFocus.js';
import { useActiveQuizRun } from '../hooks/useActiveQuizRun.js';
import { useActivePoll } from '../hooks/useActivePoll.js';
import { progressOf } from '../lib/blockHelpers.js';
import { resumePoint } from '../lib/workbookResume.js';
import WorkbookHeader from '../components/participant/WorkbookHeader.jsx';
import AssessmentChip from '../components/participant/AssessmentChip.jsx';
import KebabMenu from '../components/KebabMenu.jsx';
import { useJustCompleted } from '../hooks/useJustCompleted.js';
import { sanitizeNotesHtml, wordCountHtml } from '../lib/notesRichText.js';
import Block from '../components/blocks/Block.jsx';
import MaterialsDrawer from '../components/participant/MaterialsDrawer.jsx';
import NotesDrawer from '../components/participant/NotesDrawer.jsx';
import QuizParticipant from '../components/quiz/QuizParticipant.jsx';
import PollParticipant from '../components/poll/PollParticipant.jsx';
import PrepDrawer from '../components/participant/PrepDrawer.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/workbook.css';
import '../styles/print.css';
import '../styles/drawer.css';
import '../styles/workbook-rail.css';

const ALL_KEY = '__all__';

export default function ParticipantWorkbookPage() {
  const navigate = useNavigate();
  const { session: authSession } = useAuth();
  const { loading, error, session, workbook, sections, blocks, answers, savedAt, savingMap, saveAnswer, recentlyUpdated } =
    useWorkbook(authSession?.user.id);
  const { notes: sectionNotes, saveNote } = useParticipantNotes(session?.id, authSession?.user.id);

  // A quiz is not something a participant navigates to — the trainer says
  // "we're doing a quiz" and it appears. Watching for one beats reading a URL
  // out to sixteen people.
  //
  // STICKY once entered. useActiveQuizRun only reports runs that have not
  // ended, so the moment the trainer ends the quiz it returns null — which
  // yanked the participant back to their workbook before they ever saw the
  // final screen or their score. Holding the id until they dismiss it means
  // the quiz ends the way it should: they close it.
  const { runId: activeQuizRunId } = useActiveQuizRun(session?.id);
  // Polls ask every couple of seconds rather than subscribing: `tally` is a
  // column on poll_runs, so letting a handset SELECT that row to hang a
  // subscription on would hand it the live counts. See useActivePoll.
  const { run: activePoll, refresh: refreshPoll, secondsLeft: pollSecondsLeft } = useActivePoll(session?.id);
  const [stickyQuizRunId, setStickyQuizRunId] = useState(null);
  const [quizDismissed, setQuizDismissed] = useState(null);
  useEffect(() => {
    if (activeQuizRunId) setStickyQuizRunId(activeQuizRunId);
  }, [activeQuizRunId]);
  // A later quiz has a new id, so dismissing one never suppresses the next.
  const quizRunId = stickyQuizRunId && stickyQuizRunId !== quizDismissed ? stickyQuizRunId : null;
  const { prep: sectionPrep, standalone: standalonePrep, expected: expectedPrep } = useParticipantPrep(session?.id, authSession?.user.id);
  const { materials, signedUrlFor: materialUrlFor, loading: materialsLoading } = useProgramMaterials(session?.id);

  const [selectedSectionId, setSelectedSectionId] = useState(ALL_KEY);
  const [exFilter, setExFilter] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);

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

  // Raise hand. Private: only this person and the trainer running the session
  // can see the ask.
  const help = useHelpRequests(session?.id, { mine: true, selfId: authSession?.user.id });
  const handUp = help.mineOpen;
  const [helpBusy, setHelpBusy] = useState(false);
  const [helpError, setHelpError] = useState('');
  async function toggleHelp() {
    setHelpBusy(true); setHelpError('');
    const { error: e } = handUp
      ? await help.lower('cancelled')
      : await help.raise(currentSectionId, sections.find(s => s.id === currentSectionId)?.title || '');
    setHelpBusy(false);
    if (e) setHelpError(e.message);
  }
  // A hand comes down by itself when they move on to a LATER exercise — the
  // question has most likely answered itself. Scrolling back to an earlier one
  // to look something up does not count: that is often why they asked.
  useEffect(() => {
    if (!handUp?.section_id || !currentSectionId || currentSectionId === handUp.section_id) return;
    const at = sections.findIndex(x => x.id === currentSectionId);
    const asked = sections.findIndex(x => x.id === handUp.section_id);
    if (at > asked && asked >= 0) help.lower('moved_on');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSectionId, handUp?.section_id]);

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

  const notedSections = useMemo(
    () => Object.values(notesByCount).filter(n => n > 0).length,
    [notesByCount]
  );

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
      // Counts INPUTS, not blocks: a 10-cell table is ten things to fill, so
      // 100% means every radio, field and cell is done.
      const { total, filled, pct } = progressOf(sBlocks, id => answers[id]);
      return { id: sec.id, title: sec.title, kind: sec.kind || 'exercise', total, answered: filled, pct };
    });
  }, [sections, blocks, answers]);

  // The whole book, for the header ring — same input counting as the sidebar.
  const overallProgress = useMemo(() => progressOf(blocks, id => answers[id]), [blocks, answers]);
  const resume = useMemo(
    () => resumePoint(sections, blocks, answers, savedAt),
    [sections, blocks, answers, savedAt],
  );

  // Continue: show the exercise, bring the question into view, and put the
  // cursor in its first empty box. In the one-exercise view it switches to the
  // target exercise; in the all-exercises view it just scrolls.
  const [pendingResume, setPendingResume] = useState(null);
  function continueWorkbook() {
    if (!resume) return;
    if (selectedSectionId !== ALL_KEY && selectedSectionId !== resume.sectionId) setSelectedSectionId(resume.sectionId);
    setPendingResume({ blockId: resume.blockId, at: Date.now() });
  }
  useEffect(() => {
    if (!pendingResume) return;
    const el = document.querySelector(`[data-block-id="${pendingResume.blockId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const empty = [...el.querySelectorAll('input[type=text], input:not([type]), textarea, select')]
      .find(i => !i.disabled && !i.readOnly && !i.value);
    if (empty) empty.focus({ preventScroll: true });
    el.classList.remove('wb-block--resume');
    void el.offsetWidth; // restart the highlight if Continue is pressed twice
    el.classList.add('wb-block--resume');
    setPendingResume(null);
  }, [pendingResume, selectedSectionId]);

  // Completion is marked two ways: a lasting tick on any finished exercise,
  // and a one-off wash on the one that just crossed the line.
  const statById = useMemo(
    () => Object.fromEntries(sectionStats.map(st => [st.id, st])),
    [sectionStats],
  );
  const justCompleted = useJustCompleted(sectionStats);

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

  // ── The exercise rail ─────────────────────────────────────────────────────
  // Exercises sit under the group (Word H1) before them. A group with no
  // exercises of its own — Cover, Document information — is a page, not a
  // chapter, and moves to the foot of the rail.
  const railModel = useMemo(() => {
    const groups = [];
    let cur = null;
    for (const st of sectionStats) {
      if (st.kind === 'group') { cur = { id: st.id, title: st.title, items: [] }; groups.push(cur); continue; }
      if (!cur) { cur = { id: '__lead', title: null, items: [] }; groups.push(cur); }
      cur.items.push(st);
    }
    const out = [], pages = [];
    for (const g of groups) {
      if (!g.items.length) { if (g.title) pages.push(g); continue; }
      const counted = g.items.filter(i => i.total > 0);
      const total = counted.reduce((n, i) => n + i.total, 0);
      const answered = counted.reduce((n, i) => n + i.answered, 0);
      const done = counted.filter(i => i.pct === 100).length;
      out.push({
        ...g, total, answered, done, of: counted.length,
        pct: total ? Math.round((answered / total) * 100) : 0,
        complete: counted.length > 0 && done === counted.length,
      });
    }
    return { groups: out, pages };
  }, [sectionStats]);

  const groupOfSection = useMemo(() => {
    const m = {};
    for (const g of railModel.groups) for (const i of g.items) m[i.id] = g.id;
    return m;
  }, [railModel]);

  // Folding. A finished group folds by itself; any other group is open. The
  // participant can fold or open either, and the group holding where they are
  // — scrolled to, picked, or spotlighted by the trainer — reopens whenever
  // that place moves into it, so a folded group never hides their place.
  const [foldedGroups, setFoldedGroups] = useState(() => new Set());
  const [openedGroups, setOpenedGroups] = useState(() => new Set());
  const isGroupOpen = g => !g.title || (g.complete ? openedGroups.has(g.id) : !foldedGroups.has(g.id));
  function toggleGroup(g) {
    const open = isGroupOpen(g);
    const edit = add => prev => {
      const next = new Set(prev);
      if (add) next.add(g.id); else next.delete(g.id);
      return next;
    };
    if (g.complete) setOpenedGroups(edit(!open));
    else setFoldedGroups(edit(open));
  }
  const hereSectionId = selectedSectionId === ALL_KEY ? currentSectionId : selectedSectionId;
  useEffect(() => {
    const ids = [hereSectionId, focus?.section_id].map(id => groupOfSection[id]).filter(Boolean);
    if (!ids.length) return;
    setFoldedGroups(prev => (ids.some(id => prev.has(id)) ? new Set([...prev].filter(id => !ids.includes(id))) : prev));
    setOpenedGroups(prev => (ids.every(id => prev.has(id)) ? prev : new Set([...prev, ...ids])));
  }, [hereSectionId, focus?.section_id, groupOfSection]);

  // Searching shows matching exercises as one flat list, groups set aside.
  const railFiltered = useMemo(
    () => (exFilter.trim() ? filteredStats.filter(st => st.kind !== 'group') : []),
    [filteredStats, exFilter],
  );

  function renderRailRow(st) {
    const isActive = selectedSectionId === st.id;
    // WHERE THEY ARE, as opposed to what they picked: in All exercises the
    // scroll-spy's section is marked, so the rail follows the page.
    const isHere = selectedSectionId === ALL_KEY && currentSectionId === st.id;
    const noteWords = notesByCount[st.id] || 0;
    const state = st.total === 0 ? 'read' : st.pct === 100 ? 'done' : st.answered > 0 ? 'part' : 'none';
    return (
      <li key={st.id}>
        <button
          className={`exresp-sidebar-item wb-rail-row ${isActive ? 'active' : ''} ${isHere ? 'is-here' : ''}`}
          data-nav-id={st.id}
          aria-current={isHere || isActive ? 'true' : undefined}
          onClick={() => setSelectedSectionId(st.id)}
        >
          <span
            className={`wb-rail-tick is-${state}`}
            style={state === 'part' ? { '--p': `${st.pct}%` } : undefined}
            role={state === 'read' ? undefined : 'img'}
            aria-label={state === 'done' ? 'Every box answered' : state === 'part' ? `${st.pct}% answered` : state === 'none' ? 'Not started' : undefined}
          >
            {state === 'done' ? '✓' : ''}
          </span>
          <span className="exresp-sidebar-title wb-rail-name">
            {st.title}
            {focus?.section_id === st.id && <span className="wb-rail-spot">Trainer here</span>}
            {noteWords > 0 && (
              <span className="exresp-sidebar-note-badge" data-tip={`${noteWords} word${noteWords === 1 ? '' : 's'} in your note`}>
                💬 {noteWords}
              </span>
            )}
          </span>
          {st.total > 0 && <span className={`wb-rail-count is-${state}`}>{st.answered}/{st.total}</span>}
          {st.total > 0 && (
            <span className={`wb-rail-bar is-thin${state === 'done' ? ' is-done' : ''}`}>
              <i style={{ width: `${st.pct}%` }} />
            </span>
          )}
        </button>
      </li>
    );
  }

  function onExFilterKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (railFiltered.length) setSelectedSectionId(railFiltered[0].id);
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

  // Keep the "you are here" row visible IN THE RAIL as the page scrolls.
  //
  // The rail is 85 entries with its own scrollbar, so marking the current
  // exercise is only half of it — the mark lands on a row nobody can see, and
  // the rail reads as though it has stopped following.
  //
  // Nudges the rail's own scrollTop rather than calling scrollIntoView, which
  // would scroll the PAGE and fight the scroll that moved the marker.
  useEffect(() => {
    if (selectedSectionId !== ALL_KEY || !currentSectionId) return;
    const rail = sidebarRef.current;
    const item = rail?.querySelector(`[data-nav-id="${currentSectionId}"]`);
    if (!rail || !item) return;
    const r = rail.getBoundingClientRect();
    const i = item.getBoundingClientRect();
    if (i.top < r.top + 8) rail.scrollTop -= (r.top + 8 - i.top);
    else if (i.bottom > r.bottom - 8) rail.scrollTop += (i.bottom - (r.bottom - 8));
  }, [currentSectionId, selectedSectionId, foldedGroups, openedGroups]);

  // Above the loading gate: once a quiz is running it IS the screen, and a
  // participant who reloads mid-quiz must land back in it rather than in a
  // workbook the room has moved on from. The dismiss check lives in quizRunId
  // itself, above.
  if (quizRunId) {
    return <QuizParticipant runId={quizRunId} onDismiss={() => setQuizDismissed(quizRunId)} />;
  }

  // A poll takes the screen the same way, and for the same reason — the trainer
  // says "have a look at your phones" and it is already there.
  //
  // BELOW the quiz, not above it: if both were somehow live the quiz is the one
  // with a clock running, so it wins. The database keeps that from happening in
  // the first place (poll_fire refuses over a running quiz), and the twelve-hour
  // guard added to useActiveQuizRun is what makes the two agree on "running".
  //
  // NOT sticky, unlike the quiz. A quiz is held until the participant closes it
  // so they see their score; a poll has no final screen of their own, so when
  // the trainer takes it down they should be back in their workbook at once.
  if (activePoll) {
    return <PollParticipant run={activePoll} secondsLeft={pollSecondsLeft} onRefresh={refreshPoll} />;
  }

  if (loading) return <><TopBar /><SkeletonPage body="lines" rows={6} label="Loading workbook…" /></>;
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
        <WorkbookHeader
          workbook={workbook}
          session={session}
          progress={overallProgress}
          resume={resume}
          onContinue={continueWorkbook}
        />

        <div className="participant-actions-bar no-print" ref={actionsBarRef}>
          {overallStatus && (
            <span className={`wb-save-indicator ${overallStatus}`}>
              {overallStatus === 'saving' ? 'Saving…' : overallStatus === 'error' ? 'Save failed' : '✓ All changes saved'}
            </span>
          )}
          {/* The things you read sit together as one group; the assessment says
              its state; asking for help is the one strong button; printing is
              occasional, so it lives behind ⋯. */}
          <div className="pab-group" role="group" aria-label="Your reading">
            <button
              type="button"
              className="pab-seg"
              onClick={() => setNotesOpen(true)}
              data-tip={notedSections > 0
                ? `Your notes — ${notedSections} exercise${notedSections === 1 ? '' : 's'}, ${totalNoteWords} word${totalNoteWords === 1 ? '' : 's'} (press N)`
                : 'Your notes (press N)'}
            >
              📝 Notes{notedSections > 0 && <span className="pab-count">{notedSections}</span>}
            </button>
            <button
              type="button"
              className="pab-seg"
              onClick={() => setPrepOpen(true)}
              data-tip="Pre-work from your trainer"
            >
              🎯 Prep{prepCount > 0 && <span className="pab-count">{prepCount}</span>}
            </button>
            {/* Only when this program HAS handouts. A button that opens an empty
                drawer is a promise of something to read that does not exist, and
                most programs carry none.
                `!materialsLoading` matters as much as the count: without it the
                button pops into a row the participant may already be reaching
                for, moving the buttons after it out from under the cursor. */}
            {!materialsLoading && materials.length > 0 && (
              <button
                type="button"
                className="pab-seg"
                onClick={() => setMaterialsOpen(true)}
                data-tip="Handouts and quick references for this program"
              >
                📎 Handouts<span className="pab-count">{materials.length}</span>
              </button>
            )}
          </div>
          {session?.assessment_id && (
            <AssessmentChip
              unlockedAt={session.assessment_unlocked_at}
              deadlineAt={session.assessment_deadline_at}
              onOpen={() => navigate(`/assessment?session=${session.id}`)}
            />
          )}
          <button
            type="button"
            className={`help-hand${handUp ? ' is-up' : ''}`}
            onClick={toggleHelp}
            disabled={helpBusy || !session?.id}
            aria-pressed={!!handUp}
            data-tip={handUp ? 'Put your hand down' : 'Ask your trainer for help — only they will see it'}
          >
            {handUp ? '✋ Help asked · Cancel' : '✋ Ask for help'}
          </button>
          <KebabMenu
            label="More"
            className="pab-more"
            items={[
              { label: 'Print / Download PDF', glyph: '↓', onClick: () => window.print() },
            ]}
          />
        </div>

        {helpError && <p className="error no-print">{helpError}</p>}
        {handUp && (
          <div className={`help-banner no-print${handUp.acknowledged_at ? ' is-coming' : ''}`} role="status">
            {handUp.acknowledged_at
              ? <>👋 <strong>{handUp.acknowledged_by_name || 'Your trainer'} is coming over.</strong> Carry on — your answers are saved.</>
              : <>✋ <strong>Your trainer can see you've asked for help.</strong> Only they can see it. Carry on while you wait.</>}
          </div>
        )}

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

          <aside className="exresp-sidebar wb-rail" ref={sidebarRef}>
            <div className="exresp-sidebar-head wb-rail-head">
              <div className="wb-rail-cap">
                <span>Exercises</span>
                <span className="wb-rail-total">{overallProgress.filled} / {overallProgress.total} answered</span>
              </div>
              <div className={`wb-rail-bar${overallProgress.total && overallProgress.filled === overallProgress.total ? ' is-done' : ''}`}>
                <i style={{ width: `${overallProgress.total ? Math.round(overallProgress.filled / overallProgress.total * 100) : 0}%` }} />
              </div>
            </div>
            {resume && (
              <button type="button" className="wb-rail-next" onClick={continueWorkbook}>
                <span>Next unanswered → {resume.sectionTitle}{resume.questionCount > 1 ? `, question ${resume.questionNo}` : ''}</span>
                <span aria-hidden="true">›</span>
              </button>
            )}
            <input
              type="text"
              className="exresp-sidebar-filter"
              placeholder="Jump to exercise…"
              value={exFilter}
              onChange={e => setExFilter(e.target.value)}
              onKeyDown={onExFilterKeyDown}
              aria-label="Filter exercises"
            />
            <ul className="exresp-sidebar-list wb-rail-list">
              {!exFilter.trim() && (
                <li>
                  <button
                    className={`exresp-sidebar-item wb-rail-all ${selectedSectionId === ALL_KEY ? 'active' : ''}`}
                    onClick={() => setSelectedSectionId(ALL_KEY)}
                  >
                    <div className="exresp-sidebar-row">
                      <span className="exresp-sidebar-title">All exercises</span>
                    </div>
                  </button>
                </li>
              )}
              {exFilter.trim() ? (
                railFiltered.length === 0
                  ? <li className="exresp-sidebar-empty">No exercises match “{exFilter.trim()}”</li>
                  : railFiltered.map(renderRailRow)
              ) : (
                <>
                  {railModel.groups.map(g => {
                    const open = isGroupOpen(g);
                    const groupHere = selectedSectionId === ALL_KEY && currentSectionId === g.id;
                    return (
                      <li key={g.id} className={`wb-rail-group${open ? ' is-open' : ''}`}>
                        {g.title && (
                          <>
                            <button
                              type="button"
                              className={`wb-rail-group-head${groupHere ? ' is-here' : ''}`}
                              data-nav-id={g.id}
                              aria-expanded={open}
                              onClick={() => toggleGroup(g)}
                              data-tip={open ? 'Fold this group' : 'Show the exercises in this group'}
                            >
                              <span className="wb-rail-chev" aria-hidden="true">▼</span>
                              {/* Break long chapter names after a slash, not mid-word. */}
                              <span className="wb-rail-group-title">{g.title.replace(/\//g, '/​')}</span>
                              {g.of > 0 && <span className="wb-rail-group-n">{g.done} of {g.of}</span>}
                            </button>
                            {g.total > 0 && (
                              <div className={`wb-rail-bar is-thin wb-rail-group-bar${g.complete ? ' is-done' : ''}`}>
                                <i style={{ width: `${g.pct}%` }} />
                              </div>
                            )}
                          </>
                        )}
                        {open && <ul className="wb-rail-rows">{g.items.map(renderRailRow)}</ul>}
                      </li>
                    );
                  })}
                  {railModel.pages.length > 0 && (
                    <li className="wb-rail-pages">
                      {railModel.pages.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          data-nav-id={p.id}
                          className={selectedSectionId === ALL_KEY && currentSectionId === p.id ? 'is-here' : ''}
                          onClick={() => {
                            setSelectedSectionId(ALL_KEY);
                            requestAnimationFrame(() => {
                              const el = sectionRefs.current[p.id];
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            });
                          }}
                        >
                          {p.title}
                        </button>
                      ))}
                    </li>
                  )}
                </>
              )}
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
                  className={`wb-section${isGroup ? ' wb-section-group' : ''}${justCompleted.has(sec.id) ? ' wb-section--just-complete' : ''}`}
                  data-section-id={sec.id}
                  ref={el => { sectionRefs.current[sec.id] = el; }}
                >
                  {isGroup ? <h1 className="wb-section-group-title">{sec.title}</h1> : (
                    <h2>
                      {sec.title}
                      {statById[sec.id]?.total > 0 && statById[sec.id]?.pct === 100 && (
                        <span className="wb-section-done" aria-label="Exercise complete">✓</span>
                      )}
                    </h2>
                  )}
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
      <MaterialsDrawer
        open={materialsOpen}
        onClose={() => setMaterialsOpen(false)}
        materials={materials}
        signedUrlFor={materialUrlFor}
        loading={materialsLoading}
      />

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

