import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../TopBar.jsx';
import { isFillableBlock, isAnswered, labelOf, inputCellsOf } from '../../lib/blockHelpers.js';

// Read-only summary view rendered when sessions.closed_at is set. Driven
// entirely by sessions.closed_summary (the snapshot saved at close time)
// since the live participants/answers tables are wiped on close.

export default function ClosedSessionView({ snapshot }) {
  const { session, workbook, participants = [], closed_at, closed_by, trainer_notes = [] } = snapshot;

  const fillable = useMemo(
    () => (workbook?.sections || []).flatMap(s => (s.blocks || []).filter(isFillableBlock)),
    [workbook],
  );
  const totalFillable = fillable.length;

  // Trainer notes indexed by [participant][block] for fast lookup in cards.
  const notesByParticipant = useMemo(() => {
    const out = {};
    for (const n of trainer_notes) {
      out[n.participant_id] = out[n.participant_id] || {};
      out[n.participant_id][n.block_id] = n;
    }
    return out;
  }, [trainer_notes]);

  const stats = useMemo(() => {
    let totalAnswered = 0;
    let flagged = 0;
    for (const p of participants) {
      for (const b of fillable) {
        const v = p.answers?.[b.id]?.value;
        if (v != null && isAnswered(b, v)) totalAnswered += 1;
      }
    }
    for (const n of trainer_notes) if (n.flag) flagged += 1;
    const slots = participants.length * totalFillable;
    const avgPct = slots ? Math.round((totalAnswered / slots) * 100) : 0;
    return { avgPct, flagged };
  }, [participants, fillable, totalFillable, trainer_notes]);

  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'flagged' | 'noted'
  const [expanded, setExpanded] = useState(() => new Set());

  function toggle(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const filteredParticipants = useMemo(() => {
    const q = query.trim().toLowerCase();
    return participants
      .filter(p => !q || (p.full_name || '').toLowerCase().includes(q) || (p.username || '').toLowerCase().includes(q))
      .filter(p => {
        if (filterMode === 'all') return true;
        if (filterMode === 'flagged') {
          const blockNotes = notesByParticipant[p.id] || {};
          return Object.values(blockNotes).some(n => n.flag);
        }
        if (filterMode === 'noted') {
          return Object.keys(p.section_notes || {}).length > 0;
        }
        return true;
      })
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  }, [participants, query, filterMode, notesByParticipant]);

  function downloadJson() {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safe = (session?.name || 'session').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const stamp = new Date(closed_at).toISOString().slice(0, 10);
    a.href = url;
    a.download = `${safe}_${stamp}_closed.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <TopBar />
      <main className="page closed-session">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>
              {session?.name}
              {session?.city_code && <span className="city-tag inline">{session.city_code}</span>}
              <span className="closed-pill">Closed</span>
            </h1>
            <p className="muted">
              {session?.vendor?.name && <>{session.vendor.name} · </>}
              {session?.trainer?.full_name && <>Trainer: {session.trainer.full_name} · </>}
              Closed {new Date(closed_at).toLocaleString()} by {closed_by?.full_name || '(unknown)'}
            </p>
          </div>
          <div className="page-hero-actions">
            <button type="button" className="ghost no-print" onClick={() => window.print()}>↓ Print / Download PDF</button>
            <button type="button" className="ghost no-print" onClick={downloadJson}>↓ Download JSON</button>
          </div>
        </section>

        <div className="stat-strip">
          <div className="stat-card"><div className="stat-icon">P</div><div><div className="stat-num">{participants.length}</div><div className="stat-label">Participant{participants.length === 1 ? '' : 's'}</div></div></div>
          <div className="stat-card"><div className="stat-icon">%</div><div><div className="stat-num">{stats.avgPct}%</div><div className="stat-label">Avg completion</div></div></div>
          <div className="stat-card"><div className="stat-icon">🚩</div><div><div className="stat-num">{stats.flagged}</div><div className="stat-label">Flagged answer{stats.flagged === 1 ? '' : 's'}</div></div></div>
        </div>

        <div className="exresp-toolbar no-print">
          <input
            className="form-input exresp-search"
            type="search"
            placeholder="Search participants…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <select className="form-input exresp-toolbar-select" value={filterMode} onChange={e => setFilterMode(e.target.value)}>
            <option value="all">All ({participants.length})</option>
            <option value="flagged">Has flags</option>
            <option value="noted">Has section notes</option>
          </select>
          <div className="exresp-toolbar-spacer" />
          <button className="ghost" onClick={() => setExpanded(new Set(participants.map(p => p.id)))}>Expand all</button>
          <button className="ghost" onClick={() => setExpanded(new Set())}>Collapse all</button>
        </div>

        {filteredParticipants.length === 0 && (
          <p className="muted">No participants match the current filter.</p>
        )}

        <div className="closed-participants">
          {filteredParticipants.map(p => (
            <ParticipantRecord
              key={p.id}
              participant={p}
              workbook={workbook}
              fillable={fillable}
              notesForP={notesByParticipant[p.id] || {}}
              expanded={expanded.has(p.id)}
              onToggle={() => toggle(p.id)}
            />
          ))}
        </div>
      </main>
    </>
  );
}

function ParticipantRecord({ participant, workbook, fillable, notesForP, expanded, onToggle }) {
  const answered = fillable.reduce(
    (n, b) => n + (isAnswered(b, participant.answers?.[b.id]?.value) ? 1 : 0),
    0,
  );
  const pct = fillable.length ? Math.round((answered / fillable.length) * 100) : 0;
  const flagCount = Object.values(notesForP).filter(n => n.flag).length;
  const noteCount = Object.values(notesForP).filter(n => n.note).length;
  const sectionNoteCount = Object.keys(participant.section_notes || {}).length;

  return (
    <div className={`closed-record ${expanded ? 'expanded' : 'collapsed'}`}>
      <button className="closed-record-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="exresp-chevron" aria-hidden>{expanded ? '▾' : '▸'}</span>
        <span className="closed-record-name">
          {participant.full_name || '(unnamed)'}
          {participant.username && participant.username !== participant.full_name && (
            <span className="muted" style={{ marginLeft: '0.5rem' }}>({participant.username})</span>
          )}
        </span>
        {flagCount > 0 && <span className="exresp-flag-badge">🚩 {flagCount}</span>}
        {noteCount > 0 && <span className="exresp-note-badge">💬 {noteCount}</span>}
        {sectionNoteCount > 0 && <span className="exresp-note-badge" title="Section notes">📝 {sectionNoteCount}</span>}
        <span className="exresp-progress-pill">{answered} / {fillable.length} ({pct}%)</span>
      </button>
      {expanded && (
        <div className="closed-record-body">
          {(workbook?.sections || []).map(sec => {
            const secBlocks = (sec.blocks || []).filter(isFillableBlock);
            const sectionNote = participant.section_notes?.[sec.id]?.note;
            // Skip rendering a section if there's nothing to show.
            const hasContent = secBlocks.some(b => participant.answers?.[b.id]?.value != null)
              || sectionNote
              || secBlocks.some(b => notesForP[b.id]);
            if (!hasContent) return null;
            return (
              <section key={sec.id} className="closed-section">
                <h3>{sec.title}</h3>
                {sectionNote && (
                  <div className="participant-note-readonly">
                    <span className="participant-note-readonly-label">Participant note</span>
                    <div className="participant-note-readonly-text">{sectionNote}</div>
                  </div>
                )}
                {secBlocks.map(b => (
                  <AnswerBlock
                    key={b.id}
                    block={b}
                    entry={participant.answers?.[b.id]}
                    trainerNote={notesForP[b.id]}
                  />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AnswerBlock({ block, entry, trainerNote }) {
  const value = entry?.value;
  const label = labelOf(block);
  return (
    <div className="closed-answer">
      <div className="closed-answer-label">{label}</div>
      {block.type === 'field' && <div className="closed-answer-value">{formatValue(value)}</div>}
      {block.type === 'table' && <TableAnswer block={block} value={value} />}
      {trainerNote && (
        <div className={`closed-trainer-note ${trainerNote.flag ? 'flagged' : ''}`}>
          {trainerNote.flag && <span className="trainer-flag-pill">🚩 Flagged</span>}
          {trainerNote.note && <span>{trainerNote.note}</span>}
        </div>
      )}
    </div>
  );
}

function TableAnswer({ block, value }) {
  const cells = inputCellsOf(block);
  const cellMap = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  return (
    <table className="closed-mini-table">
      <tbody>
        {cells.map(c => (
          <tr key={c.id}>
            <td className="closed-cell-label">{c.label}</td>
            <td className="closed-cell-value">{formatValue(cellMap[c.id])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatValue(v) {
  if (v == null || v === '') return <span className="muted">—</span>;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
