import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSessionDashboard } from '../hooks/useSessionDashboard.js';
import { useSessionNotes } from '../hooks/useSessionNotes.js';
import { useSessionParticipantNotes } from '../hooks/useSessionParticipantNotes.js';
import { useSessionPrep } from '../hooks/useSessionPrep.js';
import ClosedSessionView from '../components/dashboard/ClosedSessionView.jsx';
import PrepEditor from '../components/dashboard/PrepEditor.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { isFillableBlock, isAnswered } from '../lib/blockHelpers.js';
import { buildAnswersCsv, downloadCsv } from '../lib/sessionExport.js';
import Block from '../components/blocks/Block.jsx';
import ExerciseResponses from '../components/dashboard/ExerciseResponses.jsx';
import NoteRow from '../components/dashboard/NoteRow.jsx';
import TrainerPracticeView from '../components/dashboard/TrainerPracticeView.jsx';
import AddSessionParticipants from '../components/dashboard/AddSessionParticipants.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/workbook.css';
import '../styles/editor.css';

function formatDateRange(start, end) {
  const fmt = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (start && end) return `${fmt(start)} → ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  if (end) return `Until ${fmt(end)}`;
  return '';
}

export default function SessionDashboardPage() {
  const { id } = useParams();
  const {
    loading, error, session, workbook, sections, blocks, participants, answers,
    addSessionParticipants, resetParticipantPassword, deleteParticipant, closeSession,
  } = useSessionDashboard(id);
  const { session: authSession } = useAuth();
  const { notes, saveNote, deleteNote } = useSessionNotes(id, authSession?.user.id);
  const { notes: participantNotes } = useSessionParticipantNotes(id);
  const { prep: prepBy, standalone: standaloneBy, saveOne: savePrepOne } = useSessionPrep(id);

  const [view, setView] = useState('participants'); // 'participants' | 'exercise' | 'practice'
  const [selectedParticipantId, setSelectedParticipantId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleteError, setDeleteError] = useState({}); // { [participantId]: msg }
  const [confirmClose, setConfirmClose] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [confirmReset, setConfirmReset] = useState(null);
  const [resetResult, setResetResult] = useState({}); // { [participantId]: { temp_password } | { error } }
  const [busy, setBusy] = useState(false);
  const [joinCopied, setJoinCopied] = useState(false);
  const [prepEditorFor, setPrepEditorFor] = useState(null); // participant id

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

  const fillableBlocks = useMemo(() => blocks.filter(isFillableBlock), [blocks]);
  const totalFillable = fillableBlocks.length;

  function progressFor(participantId) {
    const ans = answers[participantId] || {};
    let answered = 0; let lastTs = null;
    for (const b of fillableBlocks) {
      const a = ans[b.id];
      if (a && isAnswered(b, a.value)) answered += 1;
      if (a?.updated_at && (!lastTs || a.updated_at > lastTs)) lastTs = a.updated_at;
    }
    return { answered, total: totalFillable, lastTs };
  }

  async function doDelete(pid) {
    setBusy(true);
    const { error: err } = await deleteParticipant(pid);
    setBusy(false);
    setConfirmDelete(null);
    if (err) {
      setDeleteError(prev => ({ ...prev, [pid]: err.message }));
      return;
    }
    if (selectedParticipantId === pid) setSelectedParticipantId(null);
  }

  async function doResetPassword(pid) {
    setBusy(true);
    const { data, error: err } = await resetParticipantPassword(pid);
    setBusy(false);
    setConfirmReset(null);
    setResetResult(prev => ({
      ...prev,
      [pid]: err ? { error: err.message } : { temp_password: data.temp_password, username: data.username },
    }));
  }

  function handleExport() {
    const csv = buildAnswersCsv({ session, sections, blocks, participants, answers, notes, participantNotes, participantPrep: prepBy, participantStandalone: standaloneBy });
    const safe = (session?.name || 'session').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    downloadCsv(`${safe}_answers_${stamp}.csv`, csv);
  }

  if (loading) return <><TopBar /><div className="loading">Loading session…</div></>;
  if (error) return <><TopBar /><main className="page"><p className="error">{error}</p></main></>;

  // Once closed, render the snapshot view instead of the live dashboard —
  // participants and answers are gone from the live tables.
  if (session?.closed_at && session?.closed_summary) {
    return <ClosedSessionView snapshot={session.closed_summary} />;
  }

  async function doClose() {
    setBusy(true);
    setCloseError('');
    const { error: err } = await closeSession();
    setBusy(false);
    setConfirmClose(false);
    if (err) setCloseError(err.message);
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
              {session?.city_code && <span className="city-tag inline">{session.city_code}</span>}
            </h1>
            <p>
              {workbook?.title}
              {(session?.starts_at || session?.ends_at) && (
                <span className="session-dates"> · {formatDateRange(session.starts_at, session.ends_at)}</span>
              )}
            </p>
            {session?.join_code && (
              <p className="join-code-row">
                Join URL: <a href={joinUrl} className="mono">{joinUrl}</a>
                <button type="button" className="ghost" onClick={copyJoinUrl} style={{ marginLeft: '0.5rem' }}>
                  {joinCopied ? 'Copied!' : 'Copy'}
                </button>
              </p>
            )}
          </div>
          <div className="page-hero-actions">
            {workbook?.id && (
              <Link to={`/trainer/workbooks/${workbook.id}`} className="ghost-link">
                ✎ Edit workbook
              </Link>
            )}
            <button className="ghost-link" onClick={handleExport} disabled={participants.length === 0}>
              ↓ Export CSV
            </button>
            {confirmClose ? (
              <>
                <span className="confirm-text">Close session? Participants and their accounts will be permanently deleted; a JSON summary is saved.</span>
                <button className="danger" onClick={doClose} disabled={busy}>Yes, close</button>
                <button className="ghost" onClick={() => setConfirmClose(false)} disabled={busy}>Cancel</button>
              </>
            ) : (
              <button className="ghost-link danger" onClick={() => setConfirmClose(true)}>
                ✕ Close session
              </button>
            )}
          </div>
        </section>
        {closeError && <p className="error">{closeError}</p>}

        <div className="view-tabs">
          <button className={`view-tab ${view === 'participants' ? 'active' : ''}`} onClick={() => setView('participants')}>Participants</button>
          <button className={`view-tab ${view === 'exercise' ? 'active' : ''}`} onClick={() => setView('exercise')}>By exercise</button>
          <button className={`view-tab ${view === 'practice' ? 'active' : ''}`} onClick={() => setView('practice')}>▶ My copy</button>
        </div>

        {view === 'participants' && (
          <div className={`dashboard-layout ${selected ? 'with-panel' : ''}`}>
            <div className="participants-pane">
              <div className="participants-header">
                <h2 className="section-title" style={{ margin: 0 }}>Participants ({participants.length})</h2>
                {!adding && (
                  <button className="ghost" onClick={() => setAdding(true)}>+ Add</button>
                )}
              </div>
              {adding && (
                <AddSessionParticipants
                  onAdd={addSessionParticipants}
                  onCancel={() => setAdding(false)}
                />
              )}

              {participants.length === 0 && <p className="muted">No participants enrolled.</p>}
              {participants.length > 0 && (
                <table className="participants-table">
                  <thead>
                    <tr><th>Name</th><th>Progress</th><th>Last activity</th><th></th></tr>
                  </thead>
                  <tbody>
                    {participants.map(p => {
                      const { answered, total, lastTs } = progressFor(p.id);
                      const pct = total ? Math.round((answered / total) * 100) : 0;
                      const isSel = p.id === selectedParticipantId;
                      return (
                        <tr key={p.id} className={isSel ? 'selected' : ''}
                            onClick={() => setSelectedParticipantId(isSel ? null : p.id)}>
                          <td>{p.full_name || '(unnamed)'}</td>
                          <td>
                            <div className="progress-cell">
                              <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                              <span className="progress-text">{answered} / {total}</span>
                            </div>
                          </td>
                          <td>{lastTs ? new Date(lastTs).toLocaleString() : '—'}</td>
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
                                  className="ghost"
                                  onClick={() => {
                                    navigator.clipboard?.writeText(resetResult[p.id].temp_password).catch(() => {});
                                  }}
                                >Copy</button>
                                <button
                                  className="ghost"
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
                              <>
                                <button className="ghost" onClick={() => setPrepEditorFor(p.id)}>Prep…</button>
                                <button className="ghost" onClick={() => setConfirmReset(p.id)}>Reset pwd</button>
                                <button className="ghost danger" onClick={() => setConfirmDelete(p.id)}>Delete</button>
                              </>
                            )}
                          </td>
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
                            <div className="participant-note-readonly-text">{pNote}</div>
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
            onSaveNote={saveNote}
            onDeleteNote={deleteNote}
          />
        )}

        {view === 'practice' && (
          <TrainerPracticeView sessionId={id} trainerId={authSession?.user.id} />
        )}
      </main>
      <PrepEditor
        open={!!prepEditorFor}
        onClose={() => setPrepEditorFor(null)}
        participant={participants.find(p => p.id === prepEditorFor)}
        sections={sections}
        prepForParticipant={prepBy[prepEditorFor] || {}}
        saveOne={savePrepOne}
      />
    </>
  );
}
