import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { useSessionDashboard } from '../hooks/useSessionDashboard.js';
import { useSessionCursor } from '../hooks/useSessionCursor.js';
import { useSessionNotes } from '../hooks/useSessionNotes.js';
import { useSessionParticipantNotes } from '../hooks/useSessionParticipantNotes.js';
import { useSessionPrep } from '../hooks/useSessionPrep.js';
import { useProgramMaterials } from '../hooks/useProgramMaterials.js';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock.js';
import { sanitizeNotesHtml } from '../lib/notesRichText.js';
import ClosedSessionView from '../components/dashboard/ClosedSessionView.jsx';
import PrepEditor from '../components/dashboard/PrepEditor.jsx';
import ChangeTrainerControl from '../components/dashboard/ChangeTrainerControl.jsx';
import AssessmentStatusChip from '../components/dashboard/AssessmentStatusChip.jsx';
import AssessmentRunStrip from '../components/dashboard/AssessmentRunStrip.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { isVendorManagerOrAbove } from '../lib/roles.js';
import { isFillableBlock, expectedInputs, filledInputs } from '../lib/blockHelpers.js';
import { buildAllInvitesText, buildHandoutHtml, buildInviteText } from '../lib/participantInvite.js';
import Block from '../components/blocks/Block.jsx';
import MaterialsList from '../components/MaterialsList.jsx';
import ExerciseResponses from '../components/dashboard/ExerciseResponses.jsx';
import NoteRow from '../components/dashboard/NoteRow.jsx';
import TrainerPracticeView from '../components/dashboard/TrainerPracticeView.jsx';
import TrainerAssessmentPreview from '../components/dashboard/TrainerAssessmentPreview.jsx';
import AssessmentResponses from '../components/dashboard/AssessmentResponses.jsx';
import AssessmentReport from '../components/dashboard/AssessmentReport.jsx';
import { formatRange } from '../lib/sessionDates.js';
import AddSessionParticipants from '../components/dashboard/AddSessionParticipants.jsx';
import CloseSessionModal from '../components/dashboard/CloseSessionModal.jsx';
import DeactivateParticipantModal from '../components/dashboard/DeactivateParticipantModal.jsx';
import EditSessionDatesModal from '../components/dashboard/EditSessionDatesModal.jsx';
import KebabMenu from '../components/KebabMenu.jsx';
import SessionQuizzes from '../components/dashboard/SessionQuizzes.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/workbook.css';
import '../styles/editor.css';

// A participant counts as "live" (vs. idle) if they changed exercise or saved
// an answer within this window; otherwise the dot decays to idle.
const IDLE_MS = 45000;
// No heartbeat within this window → treated as offline (must exceed the
// participant heartbeat interval, currently 20s, with headroom).
const OFFLINE_MS = 45000;



export default function SessionDashboardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    loading, error, session, workbook, sections, blocks, participants, answers, assessmentStarted, prepEnabled,
    setParticipantDeactivated, participantHasProgress, addSessionParticipants, resetParticipantPassword, deleteParticipant, allocateSessionPrep, setSessionTrainer, updateSessionDates, closeSession, deleteSession, setAssessmentUnlocked, extendAssessmentDeadline,
  } = useSessionDashboard(id);
  const { session: authSession, profile } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const canChangeTrainer = isVendorManagerOrAbove(profile?.role);
  const { notes, saveNote, deleteNote } = useSessionNotes(id, authSession?.user.id);
  const { notes: participantNotes } = useSessionParticipantNotes(id);
  const { prep: prepBy, saveOne: savePrepOne, refresh: refreshPrep } = useSessionPrep(id);
  const { materials, signedUrlFor: materialUrlFor, loading: materialsLoading } = useProgramMaterials(id);
  // Live cursors: where each participant is looking right now. Read-only here.
  const { cursors } = useSessionCursor(id, { selfId: authSession?.user.id, track: false });

  // live/idle/offline are time-based, so tick periodically to let dots decay
  // even when no cursor/answer event arrives.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick(n => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const [view, setView] = useState('participants'); // 'participants' | 'exercise' | 'practice' | 'assessment' | 'quiz'
  const [assessmentSubView, setAssessmentSubView] = useState('responses'); // 'responses' | 'preview'
  const [selectedParticipantId, setSelectedParticipantId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleteError, setDeleteError] = useState({}); // { [participantId]: msg }
  // { id, startedSinceLoad } — the participant whose dropout is being recorded.
  const [deactivating, setDeactivating] = useState(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [editingDates, setEditingDates] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [confirmDeleteSession, setConfirmDeleteSession] = useState(false);
  const [deleteSessionError, setDeleteSessionError] = useState('');
  const [confirmReset, setConfirmReset] = useState(null);
  const [resetResult, setResetResult] = useState({}); // { [participantId]: { temp_password } | { error } }
  const [busy, setBusy] = useState(false);
  const [joinCopied, setJoinCopied] = useState(false);
  const [prepEditorFor, setPrepEditorFor] = useState(null); // participant id
  const [allocating, setAllocating] = useState(false);
  const [allocateMsg, setAllocateMsg] = useState('');
  // Bulk "reset all & print invites": regenerates every participant's password
  // and opens the printable handouts. Destructive (invalidates already-shared
  // passwords), so it's gated behind a confirm step.
  const [invitesPhase, setInvitesPhase] = useState('idle'); // idle | confirm | running | done
  const [invitesProgress, setInvitesProgress] = useState({ done: 0, total: 0 });
  const [invitesRows, setInvitesRows] = useState([]);
  const [invitesError, setInvitesError] = useState('');
  const [invitesCopied, setInvitesCopied] = useState(false);
  const [copiedRowInvite, setCopiedRowInvite] = useState(null); // participant id

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

  const joinUrl = session?.join_code
    ? `${window.location.origin}/join/${session.join_code}`
    : '';

  async function copyJoinUrl() {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setJoinCopied(true);
      setTimeout(() => setJoinCopied(false), 1500);
    } catch {
      // clipboard blocked — fall back to selecting the text
    }
  }

  // Shared context for the invite/handout builders.
  const inviteCtx = useMemo(() => ({
    sessionName: session?.name || 'the training session',
    joinUrl,
    dateRange: formatRange(session?.starts_at, session?.ends_at),
  }), [session?.name, session?.starts_at, session?.ends_at, joinUrl]);

  function openHandoutWindow(rows) {
    const win = window.open('', '_blank');
    if (!win) { setInvitesError('Pop-up blocked — allow pop-ups for this site to print handouts.'); return; }
    win.document.open();
    win.document.write(buildHandoutHtml(rows, inviteCtx));
    win.document.close();
  }

  // Reset every enrolled participant's password (one call each — the edge fn
  // returns username + full_name + the fresh temp password) and open the
  // printable handouts. Sequential to stay gentle on the auth admin API.
  async function resetAllAndPrintInvites() {
    if (participants.length === 0) return;
    setInvitesError('');
    setInvitesPhase('running');
    setInvitesProgress({ done: 0, total: participants.length });
    // Open the print window NOW, while still inside the click gesture — opening
    // it after the awaits below would be outside the gesture and pop-up blockers
    // would block it. We fill it in once the resets finish. If it's blocked
    // anyway, the "Print again" button (a fresh gesture) is the fallback.
    const win = window.open('', '_blank');
    if (win) {
      win.document.open();
      win.document.write('<!doctype html><meta charset="utf-8"><title>Preparing handouts…</title><body style="font-family:system-ui,sans-serif;color:#1e3c5a;padding:28px">Preparing handouts…</body>');
      win.document.close();
    }
    const rows = [];
    const failures = [];
    for (const p of participants) {
      const { data, error: err } = await resetParticipantPassword(p.id);
      if (err || !data?.temp_password) {
        failures.push(p.full_name || p.id);
      } else {
        rows.push({
          username: data.username,
          full_name: data.full_name || p.full_name || '',
          temp_password: data.temp_password,
          status: 'created',
        });
      }
      setInvitesProgress(prev => ({ ...prev, done: prev.done + 1 }));
    }
    setInvitesRows(rows);
    if (failures.length) {
      setInvitesError(`Couldn't reset ${failures.length} participant(s): ${failures.join(', ')}.`);
    }
    setInvitesPhase('done');
    if (rows.length > 0) {
      if (win) {
        win.document.open();
        win.document.write(buildHandoutHtml(rows, inviteCtx));
        win.document.close();
      } else {
        setInvitesError(prev => prev || 'Pop-up blocked — use "Print again" to open the handouts.');
      }
    } else if (win) {
      win.close();
    }
  }

  async function copyAllInvites() {
    try {
      await navigator.clipboard.writeText(buildAllInvitesText(invitesRows, inviteCtx));
      setInvitesCopied(true);
      setTimeout(() => setInvitesCopied(false), 1500);
    } catch { setInvitesError('Could not copy to the clipboard.'); }
  }

  // Build a single handout/invite row from a just-reset participant: the reset
  // result carries the fresh password + username; full_name comes from the row.
  function inviteRowFromReset(p) {
    const r = resetResult[p.id] || {};
    return { username: r.username, full_name: p.full_name || '', temp_password: r.temp_password, status: 'created' };
  }

  async function copyRowInvite(p) {
    try {
      await navigator.clipboard.writeText(buildInviteText(inviteRowFromReset(p), inviteCtx));
      setCopiedRowInvite(p.id);
      setTimeout(() => setCopiedRowInvite(c => (c === p.id ? null : c)), 1500);
    } catch { /* clipboard blocked — leave the visible password as fallback */ }
  }

  function printRowHandout(p) {
    openHandoutWindow([inviteRowFromReset(p)]);
  }

  const fillableBlocks = useMemo(() => blocks.filter(isFillableBlock), [blocks]);
  // Inputs, not blocks — the cohort roster must agree with the exercise views.
  const totalFillable = fillableBlocks.reduce((n, b) => n + expectedInputs(b), 0);

  function progressFor(participantId) {
    const ans = answers[participantId] || {};
    let answered = 0; let lastTs = null;
    for (const b of fillableBlocks) {
      const a = ans[b.id];
      answered += filledInputs(b, a?.value);
      if (a?.updated_at && (!lastTs || a.updated_at > lastTs)) lastTs = a.updated_at;
    }
    return { answered, total: totalFillable, lastTs };
  }

  // Section title of the participant's most recently edited answer — the
  // offline fallback for the "On now" column.
  function lastSectionTitleFor(participantId) {
    const ans = answers[participantId] || {};
    let lastTs = null; let lastBlockId = null;
    for (const b of fillableBlocks) {
      const a = ans[b.id];
      if (a?.updated_at && (!lastTs || a.updated_at > lastTs)) { lastTs = a.updated_at; lastBlockId = b.id; }
    }
    if (!lastBlockId) return null;
    const secId = blocks.find(b => b.id === lastBlockId)?.section_id;
    return sections.find(s => s.id === secId)?.title || null;
  }

  // Live "On now" state for a row. A fresh last_seen (heartbeat) means online;
  // moved_at (server-stamped only on a section change) OR a recent answer
  // (`lastTs`) within IDLE_MS keeps them "live" vs. "idle".
  function presenceFor(participantId, lastTs) {
    const cur = cursors[participantId];
    const now = Date.now();
    const online = cur?.last_seen && now - new Date(cur.last_seen).getTime() < OFFLINE_MS;
    if (online) {
      const movedRecently = cur.moved_at && now - new Date(cur.moved_at).getTime() < IDLE_MS;
      const answeredRecently = lastTs && now - new Date(lastTs).getTime() < IDLE_MS;
      return {
        state: movedRecently || answeredRecently ? 'live' : 'idle',
        label: cur.section_title || 'In workbook',
      };
    }
    const last = lastSectionTitleFor(participantId);
    return { state: 'offline', label: last ? `last · ${last}` : 'offline' };
  }

  const onlineCount = useMemo(() => {
    const now = Date.now();
    return participants.filter(p => {
      const cur = cursors[p.id];
      return cur?.last_seen && now - new Date(cur.last_seen).getTime() < OFFLINE_MS;
    }).length;
    // nowTick forces recompute so the count decays as heartbeats go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, cursors, nowTick]);

  // Which online participants are parked on each exercise right now — the
  // cohort-spread read for the "By exercise" sidebar (count = list length; the
  // names feed the hover popover). Keyed by section id (clone sections, which
  // the cursor writes and the dashboard loads).
  const liveBySection = useMemo(() => {
    const now = Date.now();
    const out = {};
    for (const p of participants) {
      const cur = cursors[p.id];
      if (cur?.section_id && cur.last_seen && now - new Date(cur.last_seen).getTime() < OFFLINE_MS) {
        (out[cur.section_id] = out[cur.section_id] || []).push({ id: p.id, full_name: p.full_name });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, cursors, nowTick]);

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


  if (loading) return <><TopBar /><div className="loading">Loading session…</div></>;
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

  return (
    <>
      <TopBar />
      <main className="page dashboard">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>
              {session?.name}
              {session?.session_type?.name && <span className="type-tag inline">{session.session_type.name}</span>}
              {session?.city_code && <span className="city-tag inline">{session.city_code}</span>}
            </h1>
            {(session?.starts_at || session?.ends_at) && (
              <p><span className="session-dates">{formatRange(session.starts_at, session.ends_at)}</span></p>
            )}
            {session?.join_code && (
              <p className="join-code-row">
                <span className="join-code-label">Join URL</span>
                <a href={joinUrl} className="mono join-code-url">{joinUrl}</a>
                <button type="button" className="ghost join-code-copy" onClick={copyJoinUrl}>
                  {joinCopied ? 'Copied!' : 'Copy'}
                </button>
              </p>
            )}
          </div>
          <div className="page-hero-actions">
            {canChangeTrainer && (
              <ChangeTrainerControl
                sessionVendorId={session?.vendor_id || null}
                currentTrainer={session?.trainer || null}
                onChange={setSessionTrainer}
              />
            )}
            {/* Status, not controls. The controls moved to the Assessment tab —
                see AssessmentRunStrip for why. This chip's width changes by a
                couple of characters as the clock runs and never by more, so it
                cannot reflow the row the way the old control did. */}
            {session?.assessment_id && (
              <AssessmentStatusChip
                unlockedAt={session.assessment_unlocked_at}
                deadlineAt={session.assessment_deadline_at}
                onOpen={() => setView('assessment')}
              />
            )}
            {/* SIX CONTROLS ON ONE ROW WAS THE PROBLEM. What is left in the
                open is the two things that are STATE rather than actions — who
                is delivering this session, and how the assessment is going.
                Every button is behind the ⋯.
                Closing is reversible and deleting is not, so only one of them
                is red — and the separator puts a beat before it. */}
            <KebabMenu
              label="Session actions"
              items={[
                {
                  label: 'Edit dates',
                  glyph: '▦',
                  onClick: () => setEditingDates(true),
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
          </div>
        </section>

        <MaterialsList
          materials={materials}
          signedUrlFor={materialUrlFor}
          loading={materialsLoading}
        />

        <div className="view-tabs">
          <button className={`view-tab ${view === 'participants' ? 'active' : ''}`} onClick={() => setView('participants')}>Participants</button>
          <button className={`view-tab ${view === 'exercise' ? 'active' : ''}`} onClick={() => setView('exercise')}>By exercise</button>
          <button className={`view-tab ${view === 'practice' ? 'active' : ''}`} onClick={() => setView('practice')}>My copy</button>
          {session?.assessment_id && (
            <button className={`view-tab ${view === 'assessment' ? 'active' : ''}`} onClick={() => setView('assessment')}>Assessment</button>
          )}
          {/* Always shown, unlike Assessment: a quiz is attached from this very
              tab, so hiding it until one exists would hide the only way in. */}
          <button className={`view-tab ${view === 'quiz' ? 'active' : ''}`} onClick={() => setView('quiz')}>Quiz</button>
        </div>

        {view === 'participants' && (
          <div className={`dashboard-layout ${selected ? 'with-panel' : ''}`}>
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
                  {unPreppedIds.length > 0 && (
                    <button className="ghost" onClick={doAllocateAll} disabled={allocating}>
                      {allocating ? 'Allocating…' : `Allocate prep (${unPreppedIds.length} need it)`}
                    </button>
                  )}
                  {!adding && !selected && participants.length > 0 && (
                    <button
                      className="ghost"
                      onClick={() => setInvitesPhase('confirm')}
                      disabled={invitesPhase === 'running'}
                      title="Reset every participant's password and print fresh credential handouts"
                    >
                      🖨 Print invites
                    </button>
                  )}
                  {!adding && !selected && (
                    <button className="ghost" onClick={() => setAdding(true)}>+ Add</button>
                  )}
                </div>
              </div>
              {allocateMsg && <p className="prep-notice">{allocateMsg}</p>}
              {invitesPhase === 'confirm' && (
                <div className="invite-banner warn">
                  <span>
                    Reset <strong>all {participants.length}</strong> participants' passwords and open fresh
                    printable handouts? This invalidates any password you've already shared.
                  </span>
                  <div className="invite-banner-actions">
                    <button className="danger" onClick={resetAllAndPrintInvites}>Reset all &amp; print</button>
                    <button className="ghost" onClick={() => setInvitesPhase('idle')}>Cancel</button>
                  </div>
                </div>
              )}
              {invitesPhase === 'running' && (
                <p className="prep-notice">Resetting passwords… {invitesProgress.done}/{invitesProgress.total}</p>
              )}
              {invitesPhase === 'done' && (
                <div className="invite-banner">
                  <span>
                    {invitesRows.length > 0
                      ? `Reset ${invitesRows.length} password${invitesRows.length === 1 ? '' : 's'} and opened the printable handouts.`
                      : 'No handouts were generated.'}
                  </span>
                  <div className="invite-banner-actions">
                    {invitesRows.length > 0 && (
                      <>
                        <button className="ghost" onClick={() => openHandoutWindow(invitesRows)}><span className="btn-glyph" aria-hidden>⎙</span> Print again</button>
                        <button className="ghost" onClick={copyAllInvites}>{invitesCopied ? 'Copied!' : <><span className="btn-glyph" aria-hidden>⧉</span> Copy all invites</>}</button>
                      </>
                    )}
                    <button className="ghost" onClick={() => { setInvitesPhase('idle'); setInvitesRows([]); setInvitesError(''); }}>Dismiss</button>
                  </div>
                </div>
              )}
              {invitesError && <p className="error">{invitesError}</p>}
              {adding && (
                <AddSessionParticipants
                  onAdd={addSessionParticipants}
                  onCancel={() => setAdding(false)}
                  session={session}
                  joinUrl={joinUrl}
                />
              )}

              {participants.length === 0 && <p className="muted">No participants enrolled.</p>}
              {participants.length > 0 && (
                <table className="participants-table">
                  <thead>
                    <tr><th>Name</th><th>Progress</th><th>On now</th><th>Last activity</th>{!selected && <th></th>}</tr>
                  </thead>
                  <tbody>
                    {participants.map(p => {
                      const { answered, total, lastTs } = progressFor(p.id);
                      const pct = total ? Math.round((answered / total) * 100) : 0;
                      const isSel = p.id === selectedParticipantId;
                      const isDropout = !!p.deactivated_at;
                      return (
                        <tr key={p.id} className={`${isSel ? 'selected' : ''}${isDropout ? ' deactivated' : ''}`}
                            onClick={() => setSelectedParticipantId(isSel ? null : p.id)}>
                          <td>
                            {p.full_name || '(unnamed)'}
                            {isDropout && <span className="dropout-tag">Dropped out</span>}
                            {!isDropout && prepEnabled && !hasPrep(p.id) && <span className="no-prep-tag" title="No prep allocated yet">No prep</span>}
                            {isDropout && (
                              <div className="dropout-reason">
                                {p.deactivation_reason}
                                <span className="dropout-meta">
                                  {' '}— {p.deactivated_by_name ? `${p.deactivated_by_name}, ` : ''}
                                  {new Date(p.deactivated_at).toLocaleDateString()}
                                </span>
                              </div>
                            )}
                          </td>
                          <td>
                            <div className="progress-cell">
                              <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                              <span className="progress-text">{answered} / {total}</span>
                            </div>
                          </td>
                          <td>
                            {(() => {
                              const { state, label } = presenceFor(p.id, lastTs);
                              return (
                                <span className={`presence ${state}`}>
                                  <span className={`presence-dot ${state}`} />
                                  <span className="presence-label">{label}</span>
                                </span>
                              );
                            })()}
                          </td>
                          <td>{lastTs ? new Date(lastTs).toLocaleString() : '—'}</td>
                          {!selected && (
                          <td onClick={e => e.stopPropagation()} className="row-actions">
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
                              /* Three buttons per row, on every row, was the
                                 loudest thing on this page — the noise scaled
                                 with the cohort. Both confirms still render
                                 INLINE in this cell rather than inside the
                                 menu: the menu closes on the click, the cell
                                 re-renders as the confirm, and a popup that
                                 dismisses on outside-click never has to hold a
                                 question. */
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
                          </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {selected && (
              <aside className="answers-pane">
                <header className="answers-pane-header">
                  <h2>{selected.full_name}'s answers</h2>
                  <button className="icon-btn" onClick={() => setSelectedParticipantId(null)} aria-label="Close">×</button>
                </header>
                <div className="answers-pane-body">
                  {sections.map(sec => {
                    const pNote = participantNotes[selected.id]?.[sec.id]?.note;
                    const prepText = prepBy[selected.id]?.[sec.id]?.content;
                    return (
                      <section key={sec.id} className="wb-section answers-section">
                        <h3>{sec.title}</h3>
                        {prepText && (
                          <div className="participant-prep-callout">
                            <span className="participant-prep-callout-label">Prep</span>
                            {prepText}
                          </div>
                        )}
                        {pNote && (
                          <div className="participant-note-readonly">
                            <span className="participant-note-readonly-label">Participant note</span>
                            <div className="participant-note-readonly-text" dangerouslySetInnerHTML={{ __html: sanitizeNotesHtml(pNote) }} />
                          </div>
                        )}
                        {blocks.filter(b => b.section_id === sec.id).map(b => (
                          <div key={b.id} className="answers-block">
                            <Block block={b} value={selectedAnswers[b.id]?.value} onChange={() => {}} readOnly />
                            {(b.block_type === 'field' || b.block_type === 'table') && (
                              <NoteRow
                                note={selectedNotes[b.id]}
                                participantId={selected.id}
                                blockId={b.id}
                                onSaveNote={saveNote}
                                onDeleteNote={deleteNote}
                              />
                            )}
                          </div>
                        ))}
                      </section>
                    );
                  })}
                </div>
              </aside>
            )}
          </div>
        )}

        {view === 'exercise' && (
          <ExerciseResponses
            sections={sections}
            blocks={blocks}
            participants={participants}
            answers={answers}
            notes={notes}
            participantNotes={participantNotes}
            prepBy={prepBy}
            liveBySection={liveBySection}
            onSaveNote={saveNote}
            onDeleteNote={deleteNote}
          />
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
          <div className="assessment-view">
            <AssessmentRunStrip
              unlockedAt={session?.assessment_unlocked_at}
              deadlineAt={session?.assessment_deadline_at}
              onUnlock={(mins) => setAssessmentUnlocked(true, mins)}
              onLock={() => setAssessmentUnlocked(false)}
              onExtend={(mins) => extendAssessmentDeadline(mins)}
            />
            <div className="assessment-subtabs">
              <button
                className={`view-subtab ${assessmentSubView === 'responses' ? 'active' : ''}`}
                onClick={() => setAssessmentSubView('responses')}
              >
                Live responses
              </button>
              <button
                className={`view-subtab ${assessmentSubView === 'preview' ? 'active' : ''}`}
                onClick={() => setAssessmentSubView('preview')}
              >
                Preview
              </button>
              <button
                className={`view-subtab ${assessmentSubView === 'report' ? 'active' : ''}`}
                onClick={() => setAssessmentSubView('report')}
              >
                Report
              </button>
            </div>
            {assessmentSubView === 'responses' && (
              <AssessmentResponses
                sessionId={session?.id}
                assessmentId={session?.assessment_id}
                participants={participants}
              />
            )}
            {assessmentSubView === 'preview' && (
              <TrainerAssessmentPreview assessmentId={session?.assessment_id} />
            )}
            {assessmentSubView === 'report' && (
              <AssessmentReport
                sessionId={session?.id}
                assessmentId={session?.assessment_id}
                participants={participants}
                session={session}
              />
            )}
          </div>
        )}

        {view === 'quiz' && <SessionQuizzes sessionId={id} joinCode={session?.join_code} />}
      </main>
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

// Shared confirm modal for permanently deleting a session. Used on both the
// live dashboard and the closed-snapshot view — the wording adapts to
// whichever the trainer is staring at, but the action (and irreversibility)
// is the same: every session-scoped row + the clone workbook + remaining
// participant accounts are wiped.
function DeleteSessionModal({ sessionName, participantCount, isClosed, error, busy, onConfirm, onCancel }) {
  return (
    <div className="modal-backdrop visible" onClick={() => { if (!busy) onCancel(); }}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <header className="modal-head">
          <h2>Delete this session?</h2>
          <button className="icon-btn" onClick={onCancel} disabled={busy} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <p>Permanently deleting <strong>{sessionName}</strong> will:</p>
          <ul className="confirm-list">
            {isClosed ? (
              <li><strong>Discard the saved summary</strong> of this session — answers, notes, and analytics are gone forever.</li>
            ) : (
              <>
                <li><strong>Permanently delete</strong> all {participantCount} participant{participantCount === 1 ? '' : 's'} and their accounts.</li>
                <li><strong>Wipe</strong> every answer, note, and prep entry for this session.</li>
              </>
            )}
            <li>Remove the session’s workbook copy.</li>
          </ul>
          <p className="muted"><strong>This cannot be undone.</strong> The session will not appear in any list afterwards.</p>
          {error && <p className="error">{error}</p>}
        </div>
        <footer className="modal-foot">
          <button className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="danger" onClick={onConfirm} disabled={busy}>{busy ? 'Deleting…' : 'Yes, delete session'}</button>
        </footer>
      </div>
    </div>
  );
}
