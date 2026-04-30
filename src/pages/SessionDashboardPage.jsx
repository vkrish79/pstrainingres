import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSessionDashboard } from '../hooks/useSessionDashboard.js';
import { useSessionNotes } from '../hooks/useSessionNotes.js';
import { useParticipants } from '../hooks/useParticipants.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { isFillableBlock, isAnswered } from '../lib/blockHelpers.js';
import { buildAnswersCsv, downloadCsv } from '../lib/sessionExport.js';
import Block from '../components/blocks/Block.jsx';
import ExerciseResponses from '../components/dashboard/ExerciseResponses.jsx';
import NoteRow from '../components/dashboard/NoteRow.jsx';
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
    addParticipant, removeParticipant,
  } = useSessionDashboard(id);
  const { session: authSession } = useAuth();
  const { notes, saveNote, deleteNote } = useSessionNotes(id, authSession?.user.id);
  const { participants: allParticipants } = useParticipants();

  const [view, setView] = useState('participants'); // 'participants' | 'exercise'
  const [selectedParticipantId, setSelectedParticipantId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [pickId, setPickId] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [busy, setBusy] = useState(false);

  const fillableBlocks = useMemo(() => blocks.filter(isFillableBlock), [blocks]);
  const totalFillable = fillableBlocks.length;

  const enrolledIds = new Set(participants.map(p => p.id));
  const candidates = allParticipants.filter(p => !enrolledIds.has(p.id));

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

  async function doAdd() {
    if (!pickId) return;
    setBusy(true);
    await addParticipant(pickId);
    setBusy(false);
    setPickId(''); setAdding(false);
  }

  async function doRemove(pid) {
    setBusy(true);
    await removeParticipant(pid);
    setBusy(false);
    setConfirmRemove(null);
    if (selectedParticipantId === pid) setSelectedParticipantId(null);
  }

  function handleExport() {
    const csv = buildAnswersCsv({ session, sections, blocks, participants, answers, notes });
    const safe = (session?.name || 'session').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    downloadCsv(`${safe}_answers_${stamp}.csv`, csv);
  }

  if (loading) return <><TopBar /><div className="loading">Loading session…</div></>;
  if (error) return <><TopBar /><main className="page"><p className="error">{error}</p></main></>;

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
          </div>
          <div className="page-hero-actions">
            <button className="ghost-link" onClick={handleExport} disabled={participants.length === 0}>
              ↓ Export CSV
            </button>
          </div>
        </section>

        <div className="view-tabs">
          <button className={`view-tab ${view === 'participants' ? 'active' : ''}`} onClick={() => setView('participants')}>Participants</button>
          <button className={`view-tab ${view === 'exercise' ? 'active' : ''}`} onClick={() => setView('exercise')}>By exercise</button>
        </div>

        {view === 'participants' && (
          <div className={`dashboard-layout ${selected ? 'with-panel' : ''}`}>
            <div className="participants-pane">
              <div className="participants-header">
                <h2 className="section-title" style={{ margin: 0 }}>Participants ({participants.length})</h2>
                {!adding ? (
                  <button className="ghost" onClick={() => setAdding(true)}>+ Add</button>
                ) : (
                  <div className="add-row">
                    <select className="form-input" value={pickId} onChange={e => setPickId(e.target.value)}>
                      <option value="">Select participant…</option>
                      {candidates.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
                    </select>
                    <button onClick={doAdd} disabled={busy || !pickId}>Add</button>
                    <button className="ghost" onClick={() => { setAdding(false); setPickId(''); }} disabled={busy}>Cancel</button>
                  </div>
                )}
              </div>

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
                            {confirmRemove === p.id ? (
                              <>
                                <span className="confirm-text">Remove?</span>
                                <button className="danger" onClick={() => doRemove(p.id)} disabled={busy}>Yes</button>
                                <button className="ghost" onClick={() => setConfirmRemove(null)} disabled={busy}>No</button>
                              </>
                            ) : (
                              <button className="ghost danger" onClick={() => setConfirmRemove(p.id)}>Remove</button>
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
                  {sections.map(sec => (
                    <section key={sec.id} className="wb-section answers-section">
                      <h3>{sec.title}</h3>
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
                  ))}
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
            onSaveNote={saveNote}
            onDeleteNote={deleteNote}
          />
        )}
      </main>
    </>
  );
}
