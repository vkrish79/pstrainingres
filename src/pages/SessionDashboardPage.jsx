import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useSessionDashboard } from '../hooks/useSessionDashboard.js';
import { useParticipants } from '../hooks/useParticipants.js';
import { isFillableBlock, isAnswered } from '../lib/blockHelpers.js';
import Block from '../components/blocks/Block.jsx';
import '../styles/dashboard.css';
import '../styles/workbook.css';
import '../styles/editor.css';

export default function SessionDashboardPage() {
  const { id } = useParams();
  const { profile, signOut } = useAuth();
  const {
    loading, error, session, workbook, sections, blocks, participants, answers,
    addParticipant, removeParticipant,
  } = useSessionDashboard(id);
  const { participants: allParticipants } = useParticipants();

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

  if (loading) return <div className="loading">Loading session…</div>;
  if (error) return <div className="page"><p className="error">{error}</p></div>;

  const selected = participants.find(p => p.id === selectedParticipantId);
  const selectedAnswers = selected ? (answers[selected.id] || {}) : {};

  return (
    <div className="page dashboard">
      <header className="page-header">
        <div>
          <Link to="/trainer" className="back-link">&larr; Back</Link>
          <h1>{session?.name}</h1>
          <p className="muted">{workbook?.title}</p>
        </div>
        <div>
          <span>{profile?.full_name}</span>
          <button onClick={signOut}>Sign out</button>
        </div>
      </header>

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
                    <Block key={b.id} block={b} value={selectedAnswers[b.id]?.value} onChange={() => {}} readOnly />
                  ))}
                </section>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
