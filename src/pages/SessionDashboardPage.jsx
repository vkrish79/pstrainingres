import { useEffect, useMemo, useRef, useState } from 'react';
import { SkeletonPage } from '../components/Skeleton.jsx';
import { useParams, useNavigate } from 'react-router-dom';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { useSessionDashboard } from '../hooks/useSessionDashboard.js';
import { useSessionCursor } from '../hooks/useSessionCursor.js';
import { useHelpRequests } from '../hooks/useHelpRequests.js';
import { useSessionNotes } from '../hooks/useSessionNotes.js';
import { useSessionParticipantNotes } from '../hooks/useSessionParticipantNotes.js';
import { useSessionPrep } from '../hooks/useSessionPrep.js';
import { useSessionPrepLayout } from '../hooks/useSessionPrepLayout.js';
import { useProgramMaterials } from '../hooks/useProgramMaterials.js';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock.js';
import ClosedSessionView from '../components/dashboard/ClosedSessionView.jsx';
import PrepEditor from '../components/dashboard/PrepEditor.jsx';
import ChangeTrainerControl from '../components/dashboard/ChangeTrainerControl.jsx';
import HandsBar from '../components/dashboard/HandsBar.jsx';
import HelpedToasts from '../components/dashboard/HelpedToasts.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { isVendorManagerOrAbove } from '../lib/roles.js';
import MaterialsDrawer from '../components/participant/MaterialsDrawer.jsx';
import { CockpitGauges, CockpitRail, RoomTiles } from '../components/dashboard/SessionCockpit.jsx';
import { sessionPace, lastActiveTs } from '../lib/sessionPace.js';
import ExerciseResponses from '../components/dashboard/ExerciseResponses.jsx';
import HeatBoard from '../components/dashboard/HeatBoard.jsx';
import TrainerPracticeView from '../components/dashboard/TrainerPracticeView.jsx';
import AddSessionParticipants from '../components/dashboard/AddSessionParticipants.jsx';
import CloseSessionModal from '../components/dashboard/CloseSessionModal.jsx';
import DeactivateParticipantModal from '../components/dashboard/DeactivateParticipantModal.jsx';
import EditSessionDatesModal from '../components/dashboard/EditSessionDatesModal.jsx';
import KebabMenu from '../components/KebabMenu.jsx';
import NewSessionDrawer from '../components/sessions/NewSessionDrawer.jsx';
import SessionQuizzes from '../components/dashboard/SessionQuizzes.jsx';
import SessionPolls from '../components/dashboard/SessionPolls.jsx';
import TopBar from '../components/TopBar.jsx';
import { useSessionInvites } from '../hooks/useSessionInvites.js';
import { useRoomPresence } from '../hooks/useRoomPresence.js';
import DeleteSessionModal from '../components/dashboard/DeleteSessionModal.jsx';
import SessionAssessmentTab from '../components/dashboard/SessionAssessmentTab.jsx';
import ParticipantAnswersPane from '../components/dashboard/ParticipantAnswersPane.jsx';
import SelectedPersonCard from '../components/dashboard/SelectedPersonCard.jsx';
import ParticipantsTable from '../components/dashboard/ParticipantsTable.jsx';
import InvitesBanner from '../components/dashboard/InvitesBanner.jsx';
import SessionCockpitHeader from '../components/dashboard/SessionCockpitHeader.jsx';
import { useAmadeusWatch } from '../hooks/useAmadeusWatch.js';
import { AmadeusThumb, AmadeusRoomControls, AmadeusWatchPane, AmadeusWall } from '../components/dashboard/AmadeusWatch.jsx';
import '../styles/dashboard.css';
import '../styles/workbook.css';
import '../styles/editor.css';



export default function SessionDashboardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    loading, error, session, workbook, sections, blocks, participants, answers, assessmentStarted, prepEnabled, programAssessment, attachProgramAssessment,
    setParticipantDeactivated, participantHasProgress, addSessionParticipants, resetParticipantPassword, deleteParticipant, allocateSessionPrep, setSessionTrainer, updateSessionDates, closeSession, deleteSession, setAssessmentUnlocked, extendAssessmentDeadline,
  } = useSessionDashboard(id);
  // A re-sit is a paper-only session: no workbook, so nothing measured against
  // one has anything to say here.
  const paperOnly = session?.kind === 'resit';
  // A re-sit needs a paper to copy, and a session that is still OPEN: closing
  // deletes the participant accounts the first attempt is read from, which is
  // the same rule create_resit_session enforces. A re-sit of a re-sit is not a
  // thing, so a paper-only session does not offer it.
  const canArrangeResit = !!session?.assessment_id && !paperOnly && !session?.closed_at;
  const { session: authSession, profile } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const canChangeTrainer = isVendorManagerOrAbove(profile?.role);
  const { notes, saveNote, deleteNote } = useSessionNotes(id, authSession?.user.id);
  const { notes: participantNotes } = useSessionParticipantNotes(id);
  const { prep: prepBy, standalone: standaloneBy, saveOne: savePrepOne, refresh: refreshPrep } = useSessionPrep(id);
  // Which general prep the template shows with which exercise (show_with).
  const prepLayout = useSessionPrepLayout(id);
  const { materials, signedUrlFor: materialUrlFor, loading: materialsLoading } = useProgramMaterials(id);
  // Live cursors: where each participant is looking right now. Read-only here.
  const { cursors } = useSessionCursor(id, { selfId: authSession?.user.id, track: false });
  // Raised hands, live. Each is also shown on that person wherever they appear.
  const help = useHelpRequests(id);
  const [helpError, setHelpError] = useState('');


  const [view, setView] = useState('participants'); // 'participants' | 'exercise' | 'practice' | 'assessment' | 'quiz' | 'poll'
  const [assessmentSubView, setAssessmentSubView] = useState('responses'); // 'responses' | 'preview'
  const [selectedParticipantId, setSelectedParticipantId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleteError, setDeleteError] = useState({}); // { [participantId]: msg }
  // { id, startedSinceLoad } — the participant whose dropout is being recorded.
  const [deactivating, setDeactivating] = useState(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [editingDates, setEditingDates] = useState(false);
  // Arranging a re-sit starts HERE, from the session being re-sat, rather than
  // from a dropdown of every open session. With cohorts running in several
  // cities that list is a row of near-identical names, and choosing the wrong
  // one re-locks a paper somebody else is sitting.
  const [arrangingResit, setArrangingResit] = useState(false);
  // Mount and open are two separate things, one frame apart — see where the
  // drawer is rendered for why.
  const [resitMounted, setResitMounted] = useState(false);
  function openResitDrawer() {
    setResitMounted(true);
    // Two frames: the first lets React paint the drawer in its closed,
    // off-screen state, the second flips it open so the transition has
    // somewhere to travel from. One frame is enough in most browsers and not
    // in all of them.
    requestAnimationFrame(() => requestAnimationFrame(() => setArrangingResit(true)));
  }
  const [closeError, setCloseError] = useState('');
  const [confirmDeleteSession, setConfirmDeleteSession] = useState(false);
  const [deleteSessionError, setDeleteSessionError] = useState('');
  const [confirmReset, setConfirmReset] = useState(null);
  const [resetResult, setResetResult] = useState({}); // { [participantId]: { temp_password } | { error } }
  const [busy, setBusy] = useState(false);
  const [prepEditorFor, setPrepEditorFor] = useState(null); // participant id
  const [allocating, setAllocating] = useState(false);
  const [allocateMsg, setAllocateMsg] = useState('');
  const [attachError, setAttachError] = useState('');
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [answersOpen, setAnswersOpen] = useState(false);
  // Stepping through people while reading answers. "Stay on this exercise"
  // keeps the same exercise in view as you move from one person to the next,
  // so Exercise 4 is compared with Exercise 4. Remembered per browser.
  const [stayOnExercise, setStayOnExerciseState] = useState(() => {
    try { return localStorage.getItem('answers-stay-on-exercise') !== 'off'; } catch { return true; }
  });
  function setStayOnExercise(v) {
    setStayOnExerciseState(v);
    try { localStorage.setItem('answers-stay-on-exercise', v ? 'on' : 'off'); } catch { /* fine */ }
  }
  // Where to scroll once the next person's answers have rendered: a section id,
  // 'top', or null. A ref, because it is set in a click and read after render.
  const pendingAnchor = useRef(null);
  useEffect(() => {
    const target = pendingAnchor.current;
    if (!target) return;
    pendingAnchor.current = null;
    requestAnimationFrame(() => {
      const head = document.querySelector('.answers-pane-header');
      const offset = (head ? head.getBoundingClientRect().height : 0) + 70; // sticky TopBar + header
      const el = target === 'top'
        ? document.querySelector('.answers-pane')
        : document.querySelector(`[data-answers-section="${target}"]`);
      if (el) window.scrollTo({ top: Math.max(0, window.scrollY + el.getBoundingClientRect().top - offset) });
    });
  }, [selectedParticipantId]);

  // Keyboard: ← → next person, Esc back to the class (while reading), 1–5 tabs.
  // What the keys do is read from a ref filled in on every render, so this
  // listener is bound once and always sees the current page. It stands aside
  // while someone is typing — a trainer note, a search — and while any dialog,
  // drawer or menu is open, since those own their own keys.
  const keysRef = useRef(null);
  useEffect(() => {
    function onKey(e) {
      const k = keysRef.current;
      if (!k || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      // Only fields you TYPE into. A checkbox just clicked keeps focus, and
      // treating it as typing left the arrow keys dead until you clicked away.
      const typing = t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
        || (t.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file)$/i.test(t.type)));
      if (typing) return;
      if (document.querySelector('.modal-backdrop.visible, .materials-drawer.open, .kebab-menu, .idle-signout, .prep-editor.open, .amx-wall-full')) return;
      if (k.reading && e.key === 'ArrowRight' && k.next) { e.preventDefault(); k.step(k.next); return; }
      if (k.reading && e.key === 'ArrowLeft' && k.prev) { e.preventDefault(); k.step(k.prev); return; }
      if (k.reading && e.key === 'Escape') { e.preventDefault(); k.back(); return; }
      const tab = { 1: 'participants', 2: 'practice', 3: 'assessment', 4: 'quiz', 5: 'poll' }[e.key];
      if (tab) { e.preventDefault(); k.setView(tab); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Changing the trainer is started from the ⋯ menu; while it is open, its
  // editor stands where the controls are.
  const [changingTrainer, setChangingTrainer] = useState(false);
  // Tiles, table or heat board, remembered per browser — a trainer who prefers the
  // board should not have to pick it again on every session.
  const [roomView, setRoomViewState] = useState(() => {
    try {
      const v = localStorage.getItem('session-room-view');
      return v === 'heat' || v === 'table' || v === 'exercise' || v === 'screens' ? v : 'tiles';
    } catch { return 'tiles'; }
  });
  function setRoomView(v) {
    setRoomViewState(v);
    try { localStorage.setItem('session-room-view', v); } catch { /* private window — fine */ }
  }

  // The room view is remembered per browser, so a trainer arriving from a
  // regular session can land on a board this session cannot draw. Fall back
  // rather than render an empty one with no obvious way out.
  useEffect(() => {
    if (paperOnly && (roomView === 'heat' || roomView === 'exercise')) setRoomView('tiles');
  }, [paperOnly, roomView]);

  // Watch Amadeus: each participant can share their ARD Web tab. Pictures on
  // the tiles (switchable, remembered per browser), a Screens grid of
  // everyone, and a watch view for one person.
  const [amxPictures, setAmxPicturesState] = useState(() => {
    try { return localStorage.getItem('room-amadeus-pictures') !== 'off'; } catch { return true; }
  });
  function setAmxPictures(v) {
    setAmxPicturesState(v);
    try { localStorage.setItem('room-amadeus-pictures', v ? 'on' : 'off'); } catch { /* fine */ }
  }
  const [amxOpen, setAmxOpen] = useState(false);
  const [wallSize, setWallSizeState] = useState(() => {
    try { const v = localStorage.getItem('room-screens-size'); return v === 'S' || v === 'L' ? v : 'M'; } catch { return 'M'; }
  });
  function setWallSize(v) {
    setWallSizeState(v);
    try { localStorage.setItem('room-screens-size', v); } catch { /* fine */ }
  }
  const [wallFull, setWallFull] = useState(false);
  // The grid asks for bigger (640px) pictures, and only while it is on screen;
  // it needs pictures even if they're switched off for the tiles.
  const wallOn = view === 'participants' && roomView === 'screens' && !answersOpen && !amxOpen;
  const amx = useAmadeusWatch(id, participants.filter(p => !p.deactivated_at).map(p => p.id), {
    enabled: session?.kind !== 'resit' && !session?.closed_at,
    thumbs: amxPictures || wallOn,
    big: wallOn,
  });
  // Live pictures only while someone's Amadeus is actually open.
  const amxWatch = amx.watch;
  useEffect(() => {
    amxWatch(amxOpen && selectedParticipantId ? selectedParticipantId : null);
  }, [amxOpen, selectedParticipantId, amxWatch]);

  // Where "By exercise" should open when the heat board sends a trainer there.
  const [exerciseJump, setExerciseJump] = useState(null); // { sectionId, participantId, n }

  useBodyScrollLock(confirmDeleteSession);
  useEffect(() => {
    if (!confirmDeleteSession) return undefined;
    function onKey(e) { if (e.key === 'Escape' && !busy) setConfirmDeleteSession(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmDeleteSession, busy]);

  // A participant "needs prep" when the workbook expects prep but they have no
  // section prep rows yet (un-allocated, or enrolled while the pool was empty).
  function hasPrep(pid) {
    const sec = prepBy[pid];
    return !!sec && Object.keys(sec).length > 0;
  }
  // Dropouts are left out: allocating a kit to someone who has gone would take
  // it from the pool for nothing.
  const unPreppedIds = useMemo(
    () => (prepEnabled ? participants.filter(p => !p.deactivated_at && !hasPrep(p.id)).map(p => p.id) : []),
    [prepEnabled, participants, prepBy],
  );
  const dropoutCount = participants.filter(p => p.deactivated_at).length;

  // "Started" = any saved answer, workbook or assessment. The same test the
  // database is asked in participantHasProgress, so the menu and the check on
  // click agree.
  function hasStarted(pid) {
    return Object.keys(answers[pid] || {}).length > 0 || assessmentStarted.has(pid);
  }

  // The join link, Print invites, and one person's invite; see useSessionInvites.
  const invites = useSessionInvites({ session, participants, resetParticipantPassword, resetResult });
  const { joinUrl, joinCopied, copyJoinUrl, invitesPhase, setInvitesPhase, copiedRowInvite, copyRowInvite, printRowHandout } = invites;

  // Progress and live presence per participant; see useRoomPresence.
  const { totalFillable, progressFor, presenceFor, onlineCount, liveBySection, isOnline } =
    useRoomPresence({ participants, cursors, answers, blocks, sections });

  async function doDelete(pid) {
    setBusy(true);
    const { error: err } = await runBusy('Deleting participant…', () => deleteParticipant(pid));
    setBusy(false);
    setConfirmDelete(null);
    if (err) {
      setDeleteError(prev => ({ ...prev, [pid]: err.message }));
      return;
    }
    if (selectedParticipantId === pid) setSelectedParticipantId(null);
  }

  // "Remove" is only offered to someone with no answers on this page — but the
  // assessment answers here are from page load, so ask the database before
  // offering a delete. If they have started since, record a dropout instead.
  async function requestRemove(pid) {
    if (await participantHasProgress(pid)) setDeactivating({ id: pid, startedSinceLoad: true });
    else setConfirmDelete(pid);
  }

  async function doReactivate(pid) {
    const { error: err } = await runBusy('Reactivating participant…', () => setParticipantDeactivated(pid, false));
    if (err) setDeleteError(prev => ({ ...prev, [pid]: err.message }));
  }

  async function doResetPassword(pid) {
    setBusy(true);
    const { data, error: err } = await runBusy('Resetting password…', () => resetParticipantPassword(pid));
    setBusy(false);
    setConfirmReset(null);
    setResetResult(prev => ({
      ...prev,
      [pid]: err ? { error: err.message } : { temp_password: data.temp_password, username: data.username },
    }));
  }

  async function doAllocateAll() {
    setAllocating(true);
    setAllocateMsg('');
    const { data, error: err } = await runBusy('Allocating prep…', () => allocateSessionPrep());
    setAllocating(false);
    if (err) { setAllocateMsg(err.message); return; }
    await refreshPrep();
    const a = data.allocated || 0;
    const ex = data.exhausted || 0;
    let msg = a > 0 ? `Allocated prep to ${a} participant${a === 1 ? '' : 's'}.` : 'No prep allocated.';
    if (ex > 0) msg += ` ${ex} could not be allocated — the pool is out of kits.`;
    setAllocateMsg(msg);
  }

  // Used by PrepEditor's "Allocate from pool" action for a single participant.
  async function allocateOne(participantId) {
    const { data, error: err } = await allocateSessionPrep(participantId);
    if (err) return { error: err };
    await refreshPrep();
    return { data };
  }


  if (loading) return <><TopBar /><SkeletonPage body="table" rows={6} label="Loading session…" /></>;
  if (error) return <><TopBar /><main className="page"><p className="error">{error}</p></main></>;

  async function doDeleteSession() {
    setBusy(true);
    setDeleteSessionError('');
    const { error: err } = await runBusy('Deleting session…', () => deleteSession());
    setBusy(false);
    if (err) { setDeleteSessionError(err.message); return; }
    setConfirmDeleteSession(false);
    navigate('/trainer');
  }

  // Once closed, render the snapshot view instead of the live dashboard —
  // participants and answers are gone from the live tables. Trainers still
  // need a way to permanently discard a closed session, so the snapshot view
  // gets the same delete control (and confirm modal) wired through.
  if (session?.closed_at && session?.closed_summary) {
    return (
      <ClosedSessionView
        snapshot={session.closed_summary}
        liveAssessmentId={session.assessment_id || null}
        onDelete={() => { setDeleteSessionError(''); setConfirmDeleteSession(true); }}
        deleteModal={confirmDeleteSession ? (
          <DeleteSessionModal
            sessionName={session?.name}
            participantCount={null /* unknown post-close; the cascade handles whatever's left */}
            isClosed={true}
            error={deleteSessionError}
            busy={busy}
            onConfirm={doDeleteSession}
            onCancel={() => setConfirmDeleteSession(false)}
          />
        ) : null}
      />
    );
  }

  async function doClose(check) {
    setBusy(true);
    setCloseError('');
    const { error: err } = await runBusy('Closing session…', () => closeSession(check));
    setBusy(false);
    if (err) { setCloseError(err.message); return; } // keep the modal open to show it
    setConfirmClose(false);
  }

  const selected = participants.find(p => p.id === selectedParticipantId);
  const selectedAnswers = selected ? (answers[selected.id] || {}) : {};
  const selectedNotes = selected ? (notes[selected.id] || {}) : {};
  // Selecting someone fills the Selected card beside the class; their answers
  // open only when asked for, and then take the panel's width.
  const reading = !!selected && (answersOpen || amxOpen);
  // The same click in every view: select, or deselect if already selected.
  function pickParticipant(pid) {
    setAnswersOpen(false);
    setAmxOpen(false);
    setSelectedParticipantId(prev => (prev === pid ? null : pid));
  }

  // A person's actions — the ⋯ menu and every confirm it leads to. ONE copy,
  // rendered in the table's last column and in the Selected card, so the two
  // can never offer different things or lose a confirm step between them.
  // The confirms render in place rather than inside the menu: the menu closes
  // on the click, this re-renders as the question, and a popup that dismisses
  // on outside-click never has to hold one.
  function participantActions(p) {
    const isDropout = !!p.deactivated_at;
    return (
      <>
        {confirmDelete === p.id ? (
          <>
            <span className="confirm-text">Delete account &amp; all answers?</span>
            <button className="danger" onClick={() => doDelete(p.id)} disabled={busy}>Yes</button>
            <button className="ghost" onClick={() => setConfirmDelete(null)} disabled={busy}>No</button>
          </>
        ) : deleteError[p.id] ? (
          <>
            <span className="error">{deleteError[p.id]}</span>
            <button
              className="ghost"
              onClick={() => setDeleteError(prev => { const n = { ...prev }; delete n[p.id]; return n; })}
            >Dismiss</button>
          </>
        ) : confirmReset === p.id ? (
          <>
            <span className="confirm-text">Reset password?</span>
            <button className="danger" onClick={() => doResetPassword(p.id)} disabled={busy}>Yes</button>
            <button className="ghost" onClick={() => setConfirmReset(null)} disabled={busy}>No</button>
          </>
        ) : resetResult[p.id]?.temp_password ? (
          <>
            <span className="confirm-text">New pwd:</span>
            <span className="mono">{resetResult[p.id].temp_password}</span>
            <button
              className="ghost btn-sm"
              title="Copy just the password"
              onClick={() => {
                navigator.clipboard?.writeText(resetResult[p.id].temp_password).catch(() => {});
              }}
            >Copy</button>
            <button
              className="ghost btn-sm"
              title="Copy a ready-to-send message with link, username and this password"
              onClick={() => copyRowInvite(p)}
            >{copiedRowInvite === p.id ? 'Copied!' : 'Copy invite'}</button>
            <button
              className="ghost btn-sm"
              title="Open a printable handout slip for this participant"
              onClick={() => printRowHandout(p)}
            >🖨 Print</button>
            <button
              className="ghost btn-sm"
              onClick={() => setResetResult(prev => { const n = { ...prev }; delete n[p.id]; return n; })}
            >Done</button>
          </>
        ) : resetResult[p.id]?.error ? (
          <>
            <span className="error">{resetResult[p.id].error}</span>
            <button
              className="ghost"
              onClick={() => setResetResult(prev => { const n = { ...prev }; delete n[p.id]; return n; })}
            >Dismiss</button>
          </>
        ) : (
          /* Three buttons per row, on every row, was the loudest thing on
             this page — the noise scaled with the cohort. Hence a menu. */
          <KebabMenu
            label={`Actions for ${p.full_name || 'participant'}`}
            items={[
              { label: 'Edit prep…', glyph: '▤', onClick: () => setPrepEditorFor(p.id) },
              { label: 'Reset password', glyph: '⟲', onClick: () => setConfirmReset(p.id) },
              { separator: true },
              // Once someone has started, removing them
              // would delete what they wrote — so the
              // destructive option is replaced, not added to.
              isDropout
                ? { label: 'Reactivate', glyph: '↺', onClick: () => doReactivate(p.id) }
                : hasStarted(p.id)
                  ? { label: 'Deactivate…', glyph: '⊘', onClick: () => setDeactivating({ id: p.id, startedSinceLoad: false }) }
                  : { label: 'Remove from session', glyph: '✕', danger: true, onClick: () => requestRemove(p.id) },
            ]}
          />
        )}
      </>
    );
  }

  // The cockpit's figures, from what is already loaded. Online is the same
  // heartbeat test as the "N online" count, so the two can never disagree.
  const cockpit = sessionPace(participants.map(p => {
    const { answered, lastTs } = progressFor(p.id);
    const cur = cursors[p.id];
    return {
      id: p.id,
      name: p.full_name || '(unnamed)',
      answered,
      lastTs,
      movedTs: cur?.moved_at || null,
      online: isOnline(p.id),
      dropped: !!p.deactivated_at,
    };
  }));

  // One person as every view of the class describes them. The tone is the
  // coloured edge: behind and quiet come from the gauges, so a tile can never
  // disagree with the numbers above it.
  const behindIds = new Set(cockpit.behind.map(x => x.id));
  const quietIds = new Set(cockpit.quiet.map(x => x.id));
  function roomPerson(p) {
    const { answered, total, lastTs } = progressFor(p.id);
    const presence = presenceFor(p.id, lastTs);
    const dropped = !!p.deactivated_at;
    const tone = dropped ? 'out'
      : behindIds.has(p.id) ? 'bad'
        : quietIds.has(p.id) ? 'warn'
          : presence.state !== 'offline' ? 'ok' : 'off';
    return {
      p, id: p.id, name: p.full_name || '(unnamed)', answered, total, presence, dropped, tone,
      lastActive: lastActiveTs({ lastTs, movedTs: cursors[p.id]?.moved_at }),
      hand: dropped ? null : (help.byParticipant[p.id] || null),
      noPrep: !dropped && prepEnabled && !hasPrep(p.id),
    };
  }
  const roomPeople = participants.map(roomPerson);

  // Four ways to show the Room. By exercise used to be a tab of its own; it is
  // the same class read one exercise at a time, so it lives with the others.
  const roomSwitch = (
    <div className="room-view-switch" role="group" aria-label="Show the class as">
      <button type="button" aria-pressed={roomView === 'tiles'} onClick={() => setRoomView('tiles')}>Tiles</button>
      <button type="button" aria-pressed={roomView === 'table'} onClick={() => setRoomView('table')}>Table</button>
      {/* Both of these read the workbook -- the board is heat per exercise, and
          By exercise is one exercise at a time. A paper-only session has none,
          so they are not offered. Tiles and Table still say who is here. */}
      {!paperOnly && <button type="button" aria-pressed={roomView === 'heat'} onClick={() => setRoomView('heat')}>Heat board</button>}
      {!paperOnly && <button type="button" aria-pressed={roomView === 'exercise'} onClick={() => { setExerciseJump(null); setRoomView('exercise'); }}>By exercise</button>}
      {/* Everyone's shared Amadeus at once. Only once sharing is available here. */}
      {amx.available && <button type="button" aria-pressed={roomView === 'screens'} onClick={() => setRoomView('screens')}>Screens</button>}
    </div>
  );

  // The people you step through: everyone still in the class, in the class's
  // own order. Someone who dropped out is only in it while they are the one
  // open, so opening them from the class still works.
  const stepPeople = roomPeople.filter(x => !x.dropped || x.id === selectedParticipantId);
  const stepAt = stepPeople.findIndex(x => x.id === selectedParticipantId);
  const stepPrev = stepAt > 0 ? stepPeople[stepAt - 1].id : null;
  const stepNext = stepAt >= 0 && stepAt < stepPeople.length - 1 ? stepPeople[stepAt + 1].id : null;
  // The exercise at the top of the answers right now, to land on in the next person.
  function currentAnswersSection() {
    const head = document.querySelector('.answers-pane-header');
    const line = head ? head.getBoundingClientRect().bottom + 4 : 0;
    for (const el of document.querySelectorAll('[data-answers-section]')) {
      if (el.getBoundingClientRect().bottom > line) return el.getAttribute('data-answers-section');
    }
    return null;
  }
  function stepTo(pid) {
    if (!pid || pid === selectedParticipantId) return;
    pendingAnchor.current = stayOnExercise ? (currentAnswersSection() || 'top') : 'top';
    setSelectedParticipantId(pid);
  }
  keysRef.current = {
    reading,
    prev: stepPrev,
    next: stepNext,
    step: stepTo,
    back: () => { setAnswersOpen(false); setAmxOpen(false); },
    setView,
  };

  // Open someone's Amadeus from anywhere (their card, a raised hand).
  function openAmadeus(pid) {
    setView('participants');
    if (roomView === 'exercise') setRoomView('tiles');
    setSelectedParticipantId(pid);
    setAnswersOpen(false);
    setAmxOpen(true);
  }
  const selectedPerson = selected ? roomPerson(selected) : null;
  const selectedCard = selectedPerson && (
    <SelectedPersonCard
      sp={selectedPerson}
      pace={cockpit.pace}
      help={help}
      helpError={helpError}
      setHelpError={setHelpError}
      onClear={() => setSelectedParticipantId(null)}
      onOpenAnswers={() => { setAmxOpen(false); setAnswersOpen(true); }}
      actions={participantActions(selectedPerson.p)}
      amadeus={amx.available && !selectedPerson.dropped && (() => {
        const st = amx.stateOf(selectedPerson.id);
        return (
          <div className="amx-card">
            {st.status !== 'off' && <AmadeusThumb state={st} size="card" />}
            <div className="amx-card-actions">
              {st.status !== 'off'
                ? <button type="button" className="amx-watch-btn" onClick={() => openAmadeus(selectedPerson.id)}>▶ Watch Amadeus</button>
                : <button type="button" className="ghost" onClick={() => amx.ask(selectedPerson.id)}>Ask to share Amadeus</button>}
            </div>
          </div>
        );
      })()}
    />
  );

  return (
    <>
      <TopBar />
      <main className="page dashboard">
        <SessionCockpitHeader
          session={session}
          joinUrl={joinUrl}
          joinCopied={joinCopied}
          onCopyJoin={copyJoinUrl}
          view={view}
          setView={setView}
          paperOnly={paperOnly}
        >
          {/* Who is delivering is on the line under the title; changing it
              is a ⋯ item. A permanent "Trainer: X  Change" here cost ~190px
              — the difference between one header row and two on a laptop. */}
          {canChangeTrainer && changingTrainer && (
            <ChangeTrainerControl
              sessionVendorId={session?.vendor_id || null}
              currentTrainer={session?.trainer || null}
              onChange={setSessionTrainer}
              startEditing
              onDone={() => setChangingTrainer(false)}
            />
          )}
          <KebabMenu
            label="Session actions"
            items={[
              canChangeTrainer && {
                label: 'Change trainer…',
                glyph: '⇄',
                onClick: () => setChangingTrainer(true),
              },
              {
                label: 'Edit dates',
                glyph: '▦',
                onClick: () => setEditingDates(true),
              },
              canArrangeResit && {
                label: "Arrange a re-sit…",
                glyph: '↻',
                onClick: openResitDrawer,
              },
              prepEnabled && {
                label: 'Manage prep',
                glyph: '▤',
                onClick: () => navigate(`/trainer/sessions/${id}/prep`),
              },
              { separator: true },
              {
                label: 'Close session',
                glyph: '⊟',
                onClick: () => { setCloseError(''); setConfirmClose(true); },
              },
              {
                label: 'Delete session',
                glyph: '✕',
                danger: true,
                onClick: () => { setDeleteSessionError(''); setConfirmDeleteSession(true); },
              },
            ]}
          />
        </SessionCockpitHeader>

        {/* The class before the handouts. The materials used to be a band of
            PDF cards here, costing ~170px above every tab; they are one button
            in the panel beside the roster now, in the same drawer participants
            use. */}
        <CockpitGauges
          paperOnly={paperOnly}
          stats={cockpit}
          total={totalFillable}
          dropouts={dropoutCount}
          assessment={{
            id: session?.assessment_id || null,
            unlockedAt: session?.assessment_unlocked_at,
            deadlineAt: session?.assessment_deadline_at,
            started: participants.filter(p => !p.deactivated_at && (assessmentStarted.has(p.id) || p.assessment_finished_at)).length,
            of: participants.filter(p => !p.deactivated_at).length,
            finished: participants.filter(p => !p.deactivated_at && p.assessment_finished_at).length,
          }}
          onOpenAssessment={() => setView('assessment')}
        />

        {/* Raised hands, above every tab body rather than only inside Room.
            The hook has always run at page level; until now only Room rendered
            what it returned, so a hand raised while the trainer was in the
            workbook went unnoticed by everyone except the person waiting. */}
        <HandsBar
          hands={help.open}
          participants={participants}
          error={helpError || help.error}
          onShowInRoom={() => setView('participants')}
          amxThumb={amx.available ? (pid => (amx.stateOf(pid).status !== 'off' ? <AmadeusThumb state={amx.stateOf(pid)} size="hand" /> : null)) : null}
          onWatch={openAmadeus}
          onAcknowledge={async (reqId) => {
            setHelpError('');
            const { error: e } = await help.acknowledge(reqId);
            if (e) setHelpError(e.message);
          }}
          onResolve={async (reqId) => {
            setHelpError('');
            const { error: e } = await help.resolve(reqId);
            if (e) setHelpError(e.message);
          }}
        />
        <HelpedToasts pending={help.pendingHelped} participants={participants} onUndo={help.undoResolve} />


        {view === 'participants' && roomView !== 'exercise' && (
          <div className={`cockpit-room${reading ? ' is-reading' : ''}`}>
          <div className="dashboard-layout">
            {/* While someone's answers are open the class steps aside: a column
                of everyone beside one person's workbook was not being used,
                and it took a third of the width the workbook needs. */}
            {!reading && (
            <div className="participants-pane">
              <div className="participants-header">
                <h2 className="section-title" style={{ margin: 0 }}>
                  Participants ({participants.length})
                  {dropoutCount > 0 && (
                    <span className="dropout-count" title="Deactivated — dropped out mid-session">
                      {dropoutCount} dropped out
                    </span>
                  )}
                  {onlineCount > 0 && (
                    <span className="online-count" title={`${onlineCount} viewing the workbook now`}>
                      <span className="presence-dot live" /> {onlineCount} online
                    </span>
                  )}
                </h2>
                <div className="participants-header-actions">
                  {participants.length > 0 && roomSwitch}
                  {amx.available && !reading && participants.length > 0 && (
                    <AmadeusRoomControls
                      sharing={participants.filter(p => !p.deactivated_at && amx.stateOf(p.id).status !== 'off').length}
                      of={participants.filter(p => !p.deactivated_at).length}
                      pictures={amxPictures}
                      onPictures={setAmxPictures}
                      onAskAll={amx.askAll}
                    />
                  )}
                  {unPreppedIds.length > 0 && (
                    <button className="ghost" onClick={doAllocateAll} disabled={allocating}>
                      {allocating ? 'Allocating…' : `Allocate prep (${unPreppedIds.length} need it)`}
                    </button>
                  )}
                  {!adding && !reading && participants.length > 0 && (
                    <button
                      className="ghost"
                      onClick={() => setInvitesPhase('confirm')}
                      disabled={invitesPhase === 'running'}
                      title="Reset every participant's password and print fresh credential handouts"
                    >
                      🖨 Print invites
                    </button>
                  )}
                  {!adding && !reading && (
                    <button className="ghost" onClick={() => setAdding(true)}>+ Add</button>
                  )}
                </div>
              </div>
              {allocateMsg && <p className="prep-notice">{allocateMsg}</p>}
              <InvitesBanner invites={invites} participantCount={participants.length} />
              {adding && (
                <AddSessionParticipants
                  onAdd={addSessionParticipants}
                  onCancel={() => setAdding(false)}
                  session={session}
                  joinUrl={joinUrl}
                />
              )}

              {participants.length === 0 && <p className="muted">No participants enrolled.</p>}
              {participants.length > 0 && (roomView === 'tiles' || (roomView === 'screens' && !amx.available)) && (
                <RoomTiles
                  people={roomPeople}
                  selectedId={selectedParticipantId}
                  onPick={pickParticipant}
                  amx={amx.available && amxPictures ? (x => <AmadeusThumb state={amx.stateOf(x.id)} />) : null}
                />
              )}
              {participants.length > 0 && roomView === 'screens' && amx.available && (
                <AmadeusWall
                  people={roomPeople}
                  stateOf={amx.stateOf}
                  onOpen={pid => { setWallFull(false); openAmadeus(pid); }}
                  onAsk={amx.ask}
                  size={wallSize}
                  onSize={setWallSize}
                  full={wallFull}
                  onFull={setWallFull}
                />
              )}
              {participants.length > 0 && roomView === 'heat' && (
                <HeatBoard
                  hands={help.byParticipant}
                  sections={sections}
                  blocks={blocks}
                  participants={participants}
                  answers={answers}
                  cursors={cursors}
                  isOnline={isOnline}
                  presenceStateFor={(pid) => presenceFor(pid, progressFor(pid).lastTs).state}
                  selectedId={selectedParticipantId}
                  onPickParticipant={pickParticipant}
                  onOpenCell={(sectionId, participantId) => {
                    setExerciseJump(prev => ({ sectionId, participantId, n: (prev?.n || 0) + 1 }));
                    setRoomViewState('exercise');
                  }}
                />
              )}
              {participants.length > 0 && roomView === 'table' && (
                <ParticipantsTable
                  participants={participants}
                  progressFor={progressFor}
                  presenceFor={presenceFor}
                  selectedParticipantId={selectedParticipantId}
                  pickParticipant={pickParticipant}
                  reading={reading}
                  hands={help.byParticipant}
                  prepEnabled={prepEnabled}
                  hasPrep={hasPrep}
                  participantActions={participantActions}
                />
              )}
            </div>
            )}

            {reading && amxOpen && (
              <AmadeusWatchPane
                selected={selected}
                selectedParticipantId={selectedParticipantId}
                state={amx.stateOf(selected.id)}
                frame={amx.frame}
                history={amx.historyOf(selected.id)}
                onAsk={() => amx.ask(selected.id)}
                onBack={() => setAmxOpen(false)}
                onOpenAnswers={() => { setAmxOpen(false); setAnswersOpen(true); }}
                stepPeople={stepPeople}
                stepAt={stepAt}
                stepPrev={stepPrev}
                stepNext={stepNext}
                stepTo={stepTo}
                section={sections.find(x => x.id === cursors[selected.id]?.section_id) || null}
                blocks={blocks}
                answers={selectedAnswers}
              />
            )}
            {reading && !amxOpen && (
              <ParticipantAnswersPane
                selected={selected}
                selectedParticipantId={selectedParticipantId}
                selectedAnswers={selectedAnswers}
                selectedNotes={selectedNotes}
                onBack={() => setAnswersOpen(false)}
                stepPeople={stepPeople}
                stepAt={stepAt}
                stepPrev={stepPrev}
                stepNext={stepNext}
                stepTo={stepTo}
                stayOnExercise={stayOnExercise}
                setStayOnExercise={setStayOnExercise}
                sections={sections}
                blocks={blocks}
                participantNotes={participantNotes}
                prepBy={prepBy}
                standaloneBy={standaloneBy}
                prepLayout={prepLayout}
                saveNote={saveNote}
                deleteNote={deleteNote}
              />
            )}
          </div>
          {/* Hidden while someone's answers are open: that pane needs the
              width, and reading one person is not the moment for the room. */}
          {!reading && (
            <CockpitRail
              paperOnly={paperOnly}
              selectedCard={selected ? selectedCard : null}
              hands={roomPeople.filter(x => x.hand).sort((a, b) => a.hand.raised_at.localeCompare(b.hand.raised_at))}
              stats={cockpit}
              materialsCount={materialsLoading ? 0 : (materials?.length || 0)}
              onOpenMaterials={() => setMaterialsOpen(true)}
              onPick={(pid) => { setAnswersOpen(false); setAmxOpen(false); setSelectedParticipantId(pid); }}
            />
          )}
          </div>
        )}

        {view === 'participants' && roomView === 'exercise' && (
          <>
          <div className="room-exercise-bar">
            <h2 className="section-title" style={{ margin: 0 }}>By exercise</h2>
            {roomSwitch}
          </div>
          <ExerciseResponses
            key={exerciseJump ? `jump-${exerciseJump.n}` : 'exercise'}
            sessionId={id}
            initialSectionId={exerciseJump?.sectionId || null}
            initialParticipantId={exerciseJump?.participantId || null}
            sections={sections}
            blocks={blocks}
            participants={participants}
            answers={answers}
            notes={notes}
            participantNotes={participantNotes}
            prepBy={prepBy}
            standaloneBy={standaloneBy}
            prepLayout={prepLayout}
            liveBySection={liveBySection}
            onSaveNote={saveNote}
            onDeleteNote={deleteNote}
          />
          </>
        )}

        {view === 'practice' && (
          <TrainerPracticeView
            sessionId={id}
            trainerId={authSession?.user.id}
            prepEnabled={prepEnabled}
            participants={participants}
            participantAnswers={answers}
            liveBySection={liveBySection}
          />
        )}

        {view === 'assessment' && (
          <SessionAssessmentTab
            session={session}
            programAssessment={programAssessment}
            attachProgramAssessment={attachProgramAssessment}
            runBusy={runBusy}
            attachError={attachError}
            setAttachError={setAttachError}
            participants={participants}
            assessmentStarted={assessmentStarted}
            hands={help.byParticipant}
            assessmentSubView={assessmentSubView}
            setAssessmentSubView={setAssessmentSubView}
            setAssessmentUnlocked={setAssessmentUnlocked}
            extendAssessmentDeadline={extendAssessmentDeadline}
          />
        )}

        {view === 'quiz' && <SessionQuizzes sessionId={id} joinCode={session?.join_code} />}
        {view === 'poll' && <SessionPolls sessionId={id} />}
      </main>
      {/* Not mounted at all on a paper-only session: its opener is hidden, so
          the drawer would only ever be unreachable markup carrying handouts
          this session does not have. */}
      {!paperOnly && <MaterialsDrawer
        open={materialsOpen}
        onClose={() => setMaterialsOpen(false)}
        materials={materials}
        signedUrlFor={materialUrlFor}
        loading={materialsLoading}
      />}
      <PrepEditor
        open={!!prepEditorFor}
        onClose={() => setPrepEditorFor(null)}
        participant={participants.find(p => p.id === prepEditorFor)}
        sections={sections}
        prepForParticipant={prepBy[prepEditorFor] || {}}
        saveOne={savePrepOne}
        prepEnabled={prepEnabled}
        onAllocate={allocateOne}
      />
      {confirmClose && (
        <CloseSessionModal
          session={session}
          sections={sections}
          blocks={blocks}
          participants={participants}
          answers={answers}
          busy={busy}
          error={closeError}
          onConfirm={doClose}
          onCancel={() => setConfirmClose(false)}
        />
      )}
      {deactivating && (() => {
        const p = participants.find(x => x.id === deactivating.id);
        const { answered, total } = progressFor(deactivating.id);
        return (
          <DeactivateParticipantModal
            participant={p}
            progressLabel={total ? `${answered} / ${total}` : null}
            startedSinceLoad={deactivating.startedSinceLoad}
            onCancel={() => setDeactivating(null)}
            onConfirm={async (reason) => {
              const res = await setParticipantDeactivated(deactivating.id, true, reason);
              if (!res.error) setDeactivating(null);
              return res;
            }}
          />
        );
      })()}
      {editingDates && (
        <EditSessionDatesModal
          session={session}
          onSave={updateSessionDates}
          onClose={() => setEditingDates(false)}
        />
      )}
      {/* MOUNTED LAZILY, THEN KEPT. The drawer slides in and out on a CSS
          transition, and a transition needs a previous state to move from — so
          mounting it already open (which is what this did) put it on screen
          with no slide at all, and unmounting it on close removed it before it
          could slide back.

          So: nothing is mounted until the action is used once, which keeps this
          drawer's queries off every session page load; from then on it stays
          mounted and only `open` changes, which is exactly what the sessions
          list does and what the animation is written for. */}
      {resitMounted && (
        <NewSessionDrawer
          open={arrangingResit}
          onClose={() => setArrangingResit(false)}
          resitOf={{
            id: session.id,
            name: session.name,
            join_code: session.join_code,
            city_code: session.city_code,
          }}
        />
      )}
      {confirmDeleteSession && (
        <DeleteSessionModal
          sessionName={session?.name}
          participantCount={participants.length}
          isClosed={false}
          error={deleteSessionError}
          busy={busy}
          onConfirm={doDeleteSession}
          onCancel={() => setConfirmDeleteSession(false)}
        />
      )}
    </>
  );
}
