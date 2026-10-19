import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SkeletonPage } from '../components/Skeleton.jsx';
import { flushSync } from 'react-dom';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useWorkbook, NOT_ENROLLED } from '../hooks/useWorkbook.js';
import { useParticipantNotes } from '../hooks/useParticipantNotes.js';
import { useParticipantPrep } from '../hooks/useParticipantPrep.js';
import { useProgramMaterials } from '../hooks/useProgramMaterials.js';
import { useSessionCursor } from '../hooks/useSessionCursor.js';
import { useHelpRequests } from '../hooks/useHelpRequests.js';
import { useExerciseConfidence } from '../hooks/useExerciseConfidence.js';
import { useSessionFocus } from '../hooks/useSessionFocus.js';
import { useLiveTakeover } from '../hooks/useLiveTakeover.js';
import { usePrepDrawerAnchor } from '../hooks/usePrepDrawerAnchor.js';
import { useAmadeusShareSession, useAmadeusShare } from '../contexts/AmadeusShareContext.jsx';
import { useSessionFeatures } from '../hooks/useSessionFeatures.js';
import { AmadeusShareNotices } from '../components/participant/AmadeusShare.jsx';
import { useSessionReviews, useMyReviewMarks } from '../hooks/useAnswerReview.js';
import { marksForBlock } from '../components/blocks/ReviewMark.jsx';
import { progressOf } from '../lib/blockHelpers.js';
import { resumePoint } from '../lib/workbookResume.js';
import WorkbookHeader from '../components/participant/WorkbookHeader.jsx';
import WorkbookPrintCover, { WorkbookPrintFooter } from '../components/participant/WorkbookPrintCover.jsx';
import WorkbookRail, { ALL_KEY } from '../components/participant/WorkbookRail.jsx';
import WorkbookActionsBar from '../components/participant/WorkbookActionsBar.jsx';
import { useJustCompleted } from '../hooks/useJustCompleted.js';
import { sanitizeNotesHtml, wordCountHtml } from '../lib/notesRichText.js';
import Block from '../components/blocks/Block.jsx';
import MaterialsDrawer from '../components/participant/MaterialsDrawer.jsx';
import NotesDrawer from '../components/participant/NotesDrawer.jsx';
import WorkbookDoneCard from '../components/participant/WorkbookDoneCard.jsx';
import QuizParticipant from '../components/quiz/QuizParticipant.jsx';
import PollParticipant, { PollThanks } from '../components/poll/PollParticipant.jsx';
import PrepDrawer from '../components/participant/PrepDrawer.jsx';
import TopBar from '../components/TopBar.jsx';
import PrepCallout from '../components/PrepCallout.jsx';
import ConfidenceStrip from '../components/participant/ConfidenceStrip.jsx';
import DayPulseCard from '../components/participant/DayPulseCard.jsx';
import { useDayPulse } from '../hooks/useDayPulse.js';
import { calloutItems, splitGeneralPrep } from '../lib/prepAttach.js';
import '../styles/dashboard.css';
import '../styles/workbook.css';
import '../styles/print.css';
import '../styles/drawer.css';
import '../styles/workbook-rail.css';
import '../styles/answer-review-marks.css';

export default function ParticipantWorkbookPage() {
  const navigate = useNavigate();
  const { session: authSession, profile } = useAuth();
  const { loading, error, session, workbook, sections, blocks, answers, savedAt, savingMap, failures, retryFailed, sentNotice, saveAnswer, recentlyUpdated } =
    useWorkbook(authSession?.user.id);
  const { notes: sectionNotes, saveNote } = useParticipantNotes(session?.id, authSession?.user.id);
  // What this class uses (lib/sessionFeatures.js), live: the trainer can
  // switch a feature off mid-class and it leaves this screen without a reload.
  const { on, ready: featuresReady } = useSessionFeatures(session?.id);
  // Screen share switched off while this person is sharing: stop it, rather
  // than keep sending pictures to a cockpit that no longer shows them.
  const amxShare = useAmadeusShare();
  const amxSharing = amxShare?.status === 'sharing' || amxShare?.status === 'paused';
  useEffect(() => {
    if (!on.amadeus && amxSharing) amxShare.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on.amadeus, amxSharing]);

  // A running quiz, a live poll, or a poll's thanks screen takes the whole
  // screen; see useLiveTakeover.
  const { quizRunId, dismissQuiz, activePoll, refreshPoll, pollSecondsLeft, pollThanks, dismissPollThanks } =
    useLiveTakeover(session?.id);
  // Sharing the ARD Web tab with the trainer. The share itself lives above the
  // routes, so a poll or the assessment taking the screen doesn't end it.
  useAmadeusShareSession(session?.id);
  const { prep: sectionPrep, standalone: standalonePrep, expected: expectedPrep } = useParticipantPrep(session?.id, authSession?.user.id);
  const { materials, signedUrlFor: materialUrlFor, loading: materialsLoading } = useProgramMaterials(session?.id);

  const [selectedSectionId, setSelectedSectionId] = useState(ALL_KEY);
  const [notesOpen, setNotesOpen] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);

  // Live presence: tell the trainer which exercise this participant is looking
  // at. The fill view defaults to one scrolling page (`__all__`), so the
  // current section comes from a scroll-spy (below) rather than the selector.
  const [currentSectionId, setCurrentSectionId] = useState(null);
  const sectionRefs = useRef({}); // sectionId -> DOM node
  const sidebarRef = useRef(null);
  const prepBtnRef = useRef(null);
  // No workbook on screen, no exercise to report being on.
  useSessionCursor(featuresReady && on.workbook ? session?.id : null, {
    selfId: authSession?.user.id,
    track: true,
    sectionId: currentSectionId,
    sectionTitle: sections.find(s => s.id === currentSectionId)?.title || '',
  });

  // Raise hand. Private: only this person and the trainer running the session
  // can see the ask.
  const help = useHelpRequests(session?.id, { mine: true, selfId: authSession?.user.id });
  // "How did that exercise go?" — shown at the end of each finished exercise.
  const confidence = useExerciseConfidence(session?.id, { mine: true, selfId: authSession?.user.id });
  // The end-of-day pulse, once the trainer asks (A4). Workbook only, never the assessment.
  const pulse = useDayPulse(session?.id, { mine: true });
  const handUp = help.mineOpen;
  const [helpBusy, setHelpBusy] = useState(false);
  const [helpError, setHelpError] = useState('');
  // Always the whole workbook: from a single exercise (the rail, a spotlight
  // jump) it printed that one exercise behind a cover listing all of them.
  // flushSync so the page is re-rendered on "All exercises" before the print
  // snapshot is taken.
  function printWorkbook() {
    flushSync(() => setSelectedSectionId(ALL_KEY));
    window.print();
  }
  // Back from one exercise to the whole book, landing on the exercise they
  // were looking at rather than the top.
  function backToAll() {
    const id = selectedSectionId;
    setSelectedSectionId(ALL_KEY);
    requestAnimationFrame(() => {
      const el = sectionRefs.current[id];
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  // Set when the hand came down by itself (below), so they hear about it
  // instead of finding the button quietly back to "Ask for help".
  const [handMovedOn, setHandMovedOn] = useState(false);
  async function toggleHelp() {
    setHelpBusy(true); setHelpError(''); setHandMovedOn(false);
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
    if (at > asked && asked >= 0) {
      help.lower('moved_on').then(({ error: e } = {}) => { if (!e) setHandMovedOn(true); });
    }
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
    if (on.spotlight && focus.section_id && focus.snap_at && focus.snap_at !== lastSnapRef.current) {
      lastSnapRef.current = focus.snap_at;
      setSelectedSectionId(focus.section_id);
      setSpotlightDismissedAt(focus.set_at); // already moved → no soft banner
    }
  }, [focus, on.spotlight]);

  // Going over answers with the class: which exercises have been, and this
  // participant's own marks on them (never anyone else's answers).
  const reviews = useSessionReviews(session?.id);
  const reviewMarks = useMyReviewMarks(session?.id, reviews, answers);
  const liveReviewSectionId = useMemo(
    () => (on.review ? Object.keys(reviews).find(id => reviews[id].status === 'open') || null : null),
    [reviews, on.review],
  );

  // The review banner already says where the trainer is; a spotlight on the
  // same exercise would be a second banner saying the same thing.
  const showSpotlight = on.spotlight && !!focus?.section_id && focus.set_at !== spotlightDismissedAt
    && focus.section_id !== liveReviewSectionId;

  // Counted the same way the drawer's "4 of 5 ready" counts, so the button and
  // the header can't disagree on a session whose prep is only half stocked.
  const prepCount = useMemo(
    () => Object.values(sectionPrep).filter(p => (p?.content || '').trim()).length
      + standalonePrep.filter(p => (p?.content || '').trim()).length,
    [sectionPrep, standalonePrep]
  );

  // General prep the template shows WITH an exercise, by clone section, for the
  // purple box on that exercise (the drawer does the same split itself).
  const prepWithExercise = useMemo(
    () => splitGeneralPrep(standalonePrep, expectedPrep?.attached).bySection,
    [standalonePrep, expectedPrep]
  );


  // The drawer slides in beside the rail and tracks it; see the hook.
  usePrepDrawerAnchor(prepOpen, sidebarRef, prepBtnRef);

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
  // The newest answer save, loaded or made this visit — for "Last saved …".
  const lastSavedAt = useMemo(() => {
    let latest = null;
    for (const ts of Object.values(savedAt)) if (ts && (!latest || ts > latest)) latest = ts;
    return latest;
  }, [savedAt]);

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
  // Exercises finished during THIS visit. "How did that exercise go?" opens
  // only for these: it is asked at the moment of finishing, never as a stack
  // of cards over everything finished on earlier days. justCompleted lets go
  // after its animation, so this keeps hold until the page is left.
  const [finishedNow, setFinishedNow] = useState(() => new Set());
  useEffect(() => {
    if (!justCompleted.size) return;
    setFinishedNow(prev => {
      if ([...justCompleted].every(id => prev.has(id))) return prev;
      return new Set([...prev, ...justCompleted]);
    });
  }, [justCompleted]);


  // If a section is deleted while we're viewing it, fall back to "All".
  useEffect(() => {
    if (selectedSectionId !== ALL_KEY && !sections.find(s => s.id === selectedSectionId)) {
      setSelectedSectionId(ALL_KEY);
    }
  }, [sections, selectedSectionId]);

  // Scroll-spy: which section sits in the viewport's active band. Feeds the
  // trainer's live "On now" column. In single-section mode there's nothing to
  // spy — the selected section is, by definition, the current one.
  //
  // Keyed on the exercises being ON SCREEN, not on loading alone. A quiz, a
  // poll, or the features wait (the early returns below) unmounts them; when
  // they come back they are new nodes, and an observer attached to the old ones
  // never fires again. The cursor then froze on its seed, sections[0], for the
  // rest of the day — five people in one class read as "on" an empty chapter
  // heading for 5 hours while they answered Exercises 1–3 under it.
  const exercisesShown = !loading && !error && featuresReady && on.workbook
    && !(quizRunId && on.quiz) && !(activePoll && on.polls) && !(pollThanks && on.polls);
  useEffect(() => {
    if (!exercisesShown) return undefined;
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
  }, [exercisesShown, selectedSectionId, sections]);


  // Above the loading gate: once a quiz is running it IS the screen, and a
  // participant who reloads mid-quiz must land back in it rather than in a
  // workbook the room has moved on from. The dismiss check lives in quizRunId
  // itself, above.
  if (quizRunId && on.quiz) {
    return <QuizParticipant runId={quizRunId} onDismiss={dismissQuiz} />;
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
  if (activePoll && on.polls) {
    return <PollParticipant run={activePoll} secondsLeft={pollSecondsLeft} onRefresh={refreshPoll} />;
  }
  if (pollThanks && on.polls) {
    return <PollThanks voted={pollThanks.voted} onDone={dismissPollThanks} />;
  }

  // Also wait for what the class uses, so a class without a workbook never
  // flashes one first. A resit or a load error has no session features to wait on.
  if (loading || (session && session.kind !== 'resit' && !error && !featuresReady)) {
    return <><TopBar /><SkeletonPage body="lines" rows={6} label="Loading workbook…" /></>;
  }

  // A paper-only re-sit has no workbook, so this page has nothing to be. Send
  // them to the paper instead — which is still locked until the trainer opens
  // it, so they land on the same "not started yet" notice everyone else sees.
  //
  // replace, not push: the workbook is not a place they came from and should
  // not be somewhere Back returns them to.
  if (session?.kind === 'resit') return <Navigate to="/assessment" replace />;
  if (error) {
    return (
      <>
        <TopBar />
        <main className="page">
          <section className="page-hero compact">
            <div className="page-hero-text">
              {/* The one error with a known cause gets a plain explanation
                  and a next step; anything else is a load failure. */}
              {error === NOT_ENROLLED ? (
                <>
                  <h1>You're not in a class yet</h1>
                  <p>This account isn't enrolled in a session. Ask your trainer for the join link.</p>
                </>
              ) : (
                <>
                  <h1>Your workbook didn't load</h1>
                  <p>{error}</p>
                  <button type="button" onClick={() => window.location.reload()}>Try again</button>
                </>
              )}
            </div>
          </section>
        </main>
      </>
    );
  }

  const visibleSections = selectedSectionId === ALL_KEY
    ? sections
    : sections.filter(s => s.id === selectedSectionId);

  const actionsBar = (
    <WorkbookActionsBar
      session={session}
      on={on}
      overallStatus={overallStatus}
      lastSavedAt={lastSavedAt}
      notedSections={notedSections}
      totalNoteWords={totalNoteWords}
      setNotesOpen={setNotesOpen}
      prepOpen={prepOpen}
      setPrepOpen={setPrepOpen}
      prepBtnRef={prepBtnRef}
      prepCount={prepCount}
      materials={materials}
      materialsLoading={materialsLoading}
      setMaterialsOpen={setMaterialsOpen}
      onOpenAssessment={() => navigate(`/assessment?session=${session.id}`)}
      handUp={handUp}
      helpBusy={helpBusy}
      toggleHelp={toggleHelp}
      printWorkbook={printWorkbook}
      failures={failures}
      blocks={blocks}
      sections={sections}
      retryFailed={retryFailed}
      sentNotice={sentNotice}
    />
  );
  // The hand's state, shown under the bar on both layouts.
  const handNotices = on.hand && (
    <>
      {helpError && <p className="error no-print">{helpError}</p>}
      {handUp && (
        <div className={`help-banner no-print${handUp.acknowledged_at ? ' is-coming' : ''}`} role="status">
          {handUp.acknowledged_at
            ? <>👋 <strong>{handUp.acknowledged_by_name || 'Your trainer'} is coming over.</strong> Carry on — your answers are saved.</>
            : <>✋ <strong>Your trainer can see you've asked for help.</strong> Only they can see it. Carry on while you wait.</>}
        </div>
      )}
    </>
  );
  const materialsDrawer = on.materials && (
    <MaterialsDrawer
      open={materialsOpen}
      onClose={() => setMaterialsOpen(false)}
      materials={materials}
      signedUrlFor={materialUrlFor}
      loading={materialsLoading}
    />
  );

  // A class with no workbook (switched off in Session features): the same
  // header and bar, and the room's live moments, without exercises. Quizzes
  // and polls still take the screen from here, above.
  if (!on.workbook) {
    return (
      <>
        <TopBar />
        <main className="page workbook">
          <WorkbookHeader workbook={workbook} session={session} progress={{ total: 0, filled: 0, pct: 0 }} resume={null} onContinue={() => {}} noWorkbook />
          {actionsBar}
          {handNotices}
          {on.amadeus && <AmadeusShareNotices />}
          {on.pulse && <DayPulseCard latest={pulse.latest} onAnswer={pulse.answer} />}
          <section className="wb-no-workbook">
            <h2>Nothing to fill in for this class</h2>
            <p>Keep this page open. When your trainer starts a quiz or a poll, it appears here.</p>
          </section>
        </main>
        {materialsDrawer}
      </>
    );
  }

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
          aside={liveReviewSectionId && (
            // The trainer going over an exercise, in the header's empty right
            // side rather than a full-width bar of its own under the actions.
            <div className="wbh-live rv-banner" role="status">
              <span className="wbh-live-text">
                🗣 Your trainer is going over <strong>{sections.find(s => s.id === liveReviewSectionId)?.title || 'an exercise'}</strong> with the class
              </span>
              {selectedSectionId !== liveReviewSectionId && (
                <button type="button" className="spotlight-jump" onClick={() => setSelectedSectionId(liveReviewSectionId)}>
                  See the answer
                </button>
              )}
              {selectedSectionId === liveReviewSectionId && (
                <button type="button" className="spotlight-jump" onClick={backToAll}>← All exercises</button>
              )}
            </div>
          )}
        />

        {overallProgress.total > 0 && !resume && (
          <WorkbookDoneCard
            sessionId={session?.id}
            exerciseCount={sectionStats.filter(st => st.kind !== 'group' && st.total > 0).length}
            assessment={session?.assessment_id && on.assessment ? {
              id: session.assessment_id,
              unlockedAt: session.assessment_unlocked_at,
              deadlineAt: session.assessment_deadline_at,
            } : null}
            onOpenAssessment={() => navigate(`/assessment?session=${session.id}`)}
            onDownload={printWorkbook}
          />
        )}

        {actionsBar}

        {handNotices}
        {on.amadeus && <AmadeusShareNotices />}
        {on.hand && !handUp && handMovedOn && (
          // A toast, not a banner in the flow: it fires because they scrolled
          // DOWN, so anything up at the actions bar is already off screen.
          <div className="hand-toast no-print" role="status">
            <span>✋ Your hand went down when you moved on to a later exercise.</span>
            <span className="hand-toast-actions">
              <button type="button" className="hand-toast-btn" onClick={toggleHelp} disabled={helpBusy}>Raise it again</button>
              <button type="button" className="hand-toast-x" onClick={() => setHandMovedOn(false)} aria-label="Dismiss">×</button>
            </span>
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

        {on.pulse && <DayPulseCard latest={pulse.latest} onAnswer={pulse.answer} />}

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

          <WorkbookRail
            sidebarRef={sidebarRef}
            sectionRefs={sectionRefs}
            sectionStats={sectionStats}
            overallProgress={overallProgress}
            resume={resume}
            onContinue={continueWorkbook}
            selectedSectionId={selectedSectionId}
            setSelectedSectionId={setSelectedSectionId}
            currentSectionId={currentSectionId}
            focus={focus}
            notesByCount={notesByCount}
          />

          <div className="exresp-main">
            {/* Print-only cover and running footer, so trainers / the
                participant know whose answers they're looking at. */}
            <WorkbookPrintCover
              workbook={workbook}
              session={session}
              participantName={profile?.full_name}
              progress={overallProgress}
              sections={sections}
            />
            <WorkbookPrintFooter workbook={workbook} session={session} participantName={profile?.full_name} />
            {/* One exercise on its own — from the rail, "Jump to it" or "See the
                answer". The rail's own "All exercises" row is easy to miss when
                the trainer's banner is what brought them here. */}
            {selectedSectionId !== ALL_KEY && (
              <button type="button" className="wb-back-all no-print" onClick={backToAll}>← All exercises</button>
            )}
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
                      {on.review && reviews[sec.id] && (
                        <span className={`rv-section-tag${reviews[sec.id].status === 'open' ? ' is-live' : ''}`}>
                          {reviews[sec.id].status === 'open' ? 'Being gone over now' : 'Gone over with the class'}
                        </span>
                      )}
                    </h2>
                  )}
                  {on.prep && (
                    <PrepCallout
                      items={calloutItems(prepText, expectedPrep?.ownLabels?.[sec.id], prepWithExercise[sec.id])}
                    />
                  )}
                  {blocks.filter(b => b.section_id === sec.id).map(b => (
                    <Block
                      key={b.id}
                      block={b}
                      value={answers[b.id]}
                      onChange={v => saveAnswer(b.id, v)}
                      recentlyUpdated={!!recentlyUpdated[b.id]}
                      marks={on.review && reviews[sec.id] ? marksForBlock(reviewMarks, b.id) : null}
                    />
                  ))}
                  {/* Once the last box is filled: one private tap for the trainer.
                      Open only when finished just now; already answered shows
                      the one quiet line; anything else stays out of the way. */}
                  {on.confidence && !isGroup && !confidence.unavailable && statById[sec.id]?.total > 0 && statById[sec.id]?.pct === 100
                    && (finishedNow.has(sec.id) || confidence.mineBySection[sec.id]) && (
                    <ConfidenceStrip
                      key={`conf-${sec.id}`}
                      title={sec.title}
                      mine={confidence.mineBySection[sec.id]}
                      onSet={(level, note) => confidence.setLevel(sec.id, level, note)}
                    />
                  )}
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
      {materialsDrawer}

      <NotesDrawer
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        sections={sections}
        notes={sectionNotes}
        saveNote={saveNote}
        currentSectionId={selectedSectionId === ALL_KEY ? (currentSectionId || sections[0]?.id) : selectedSectionId}
      />
      {on.prep && <PrepDrawer
        open={prepOpen}
        onClose={() => setPrepOpen(false)}
        sections={sections}
        prep={sectionPrep}
        standalone={standalonePrep}
        expected={expectedPrep}
        className="prep-drawer--track-page"
      />}
    </>
  );
}

