import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../TopBar.jsx';
import { isFillableBlock, isAnswered, labelOf, inputCellsOf } from '../../lib/blockHelpers.js';
import { sanitizeNotesHtml } from '../../lib/notesRichText.js';

// Read-only summary view rendered when sessions.closed_at is set. Driven
// entirely by sessions.closed_summary (the snapshot saved at close time)
// since the live participants/answers tables are wiped on close.

export default function ClosedSessionView({ snapshot, onDelete, deleteModal = null }) {
  const { session, participants = [], closed_at, closed_by, trainer_notes = [] } = snapshot;

  // Snapshots store block.type, but blockHelpers (isFillableBlock/isAnswered/
  // labelOf) read block.block_type. Alias both so the helpers work — without
  // this, no block counts as fillable, so answers never render and completion
  // stats read 0 (older closed sessions showed only prep for this reason).
  const workbook = useMemo(() => {
    const wb = snapshot.workbook;
    if (!wb) return null;
    return {
      ...wb,
      sections: (wb.sections || []).map(s => ({
        ...s,
        blocks: (s.blocks || []).map(b => ({
          ...b,
          block_type: b.block_type ?? b.type,
          type: b.type ?? b.block_type,
        })),
      })),
    };
  }, [snapshot.workbook]);

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

  // Session-level rollup (the same metrics persisted in session_analytics).
  const stats = useMemo(() => {
    const pc = participants.length;
    let totalAnswered = 0;
    let fullyCompleted = 0;
    let notStarted = 0;
    let firstAct = null;
    let lastAct = null;
    for (const p of participants) {
      let a = 0;
      for (const b of fillable) {
        const entry = p.answers?.[b.id];
        if (entry && isAnswered(b, entry.value)) a += 1;
        const ts = entry?.updated_at ? new Date(entry.updated_at).getTime() : NaN;
        if (!Number.isNaN(ts)) {
          if (firstAct == null || ts < firstAct) firstAct = ts;
          if (lastAct == null || ts > lastAct) lastAct = ts;
        }
      }
      totalAnswered += a;
      if (totalFillable > 0 && a >= totalFillable) fullyCompleted += 1;
      if (totalFillable > 0 && a === 0) notStarted += 1;
    }
    let flagged = 0;
    let trainerNoted = 0;
    for (const n of trainer_notes) {
      if (n.flag) flagged += 1;
      if (n.note && String(n.note).trim() !== '') trainerNoted += 1;
    }
    let prepped = 0;
    for (const p of participants) {
      const hasPrep = (p.section_prep && Object.keys(p.section_prep).length > 0)
        || (Array.isArray(p.standalone_prep) && p.standalone_prep.length > 0);
      if (hasPrep) prepped += 1;
    }
    const slots = pc * totalFillable;
    const avgPct = slots ? Math.round((totalAnswered / slots) * 100) : 0;
    return { avgPct, flagged, trainerNoted, fullyCompleted, notStarted, prepped, firstAct, lastAct };
  }, [participants, fillable, totalFillable, trainer_notes]);

  // Per-exercise rollup (the same metrics persisted in session_section_analytics).
  const sectionStats = useMemo(() => {
    const pc = participants.length;
    const blockSection = {};
    for (const s of (workbook?.sections || [])) for (const b of (s.blocks || [])) blockSection[b.id] = s.id;
    const flagsBySection = {};
    for (const n of trainer_notes) {
      if (!n.flag) continue;
      const sid = blockSection[n.block_id];
      if (sid) flagsBySection[sid] = (flagsBySection[sid] || 0) + 1;
    }
    return (workbook?.sections || [])
      .map(s => {
        const fb = (s.blocks || []).filter(isFillableBlock);
        let answered = 0;
        for (const p of participants) for (const b of fb) {
          if (isAnswered(b, p.answers?.[b.id]?.value)) answered += 1;
        }
        const total = fb.length * pc;
        return {
          id: s.id,
          title: s.title,
          order_index: s.order_index,
          fillable: fb.length,
          answered,
          total,
          pct: total ? Math.round((answered / total) * 100) : 0,
          flagged: flagsBySection[s.id] || 0,
        };
      })
      .filter(s => s.fillable > 0)
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  }, [workbook, participants, trainer_notes]);

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
              {session?.session_type?.name && <span className="type-tag inline">{session.session_type.name}</span>}
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
            {onDelete && (
              <button type="button" className="ghost-link danger no-print" onClick={onDelete}>🗑 Delete session</button>
            )}
          </div>
        </section>

        <div className="stat-strip">
          <div className="stat-card"><div className="stat-icon">P</div><div><div className="stat-num">{participants.length}</div><div className="stat-label">Participant{participants.length === 1 ? '' : 's'}</div></div></div>
          <div className="stat-card"><div className="stat-icon">%</div><div><div className="stat-num">{stats.avgPct}%</div><div className="stat-label">Avg completion</div></div></div>
          <div className="stat-card"><div className="stat-icon">✓</div><div><div className="stat-num">{stats.fullyCompleted}</div><div className="stat-label">Fully complete</div></div></div>
          <div className="stat-card"><div className="stat-icon">∅</div><div><div className="stat-num">{stats.notStarted}</div><div className="stat-label">Not started</div></div></div>
          <div className="stat-card"><div className="stat-icon">🚩</div><div><div className="stat-num">{stats.flagged}</div><div className="stat-label">Flagged answer{stats.flagged === 1 ? '' : 's'}</div></div></div>
        </div>

        {sectionStats.length > 0 && (
          <section className="closed-by-exercise">
            <h2 className="closed-subhead">By exercise</h2>
            <table className="closed-exercise-table">
              <thead>
                <tr><th>Exercise</th><th>Completion</th><th className="cet-num">Flags</th></tr>
              </thead>
              <tbody>
                {sectionStats.map(s => (
                  <tr key={s.id}>
                    <td className="cet-title">{s.title || '(untitled)'}</td>
                    <td>
                      <div className="cet-bar-row">
                        <div className="cet-bar"><div className="cet-bar-fill" style={{ width: `${s.pct}%` }} /></div>
                        <span className="cet-bar-label">{s.answered}/{s.total} · {s.pct}%</span>
                      </div>
                    </td>
                    <td className="cet-num">{s.flagged > 0 ? `🚩 ${s.flagged}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

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
      {deleteModal}
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
          {(participant.standalone_prep?.length > 0) && (
            <section className="closed-section">
              <h3>Pre-work</h3>
              {participant.standalone_prep.map((s, i) => (
                <div key={i} className="participant-prep-callout">
                  <span className="participant-prep-callout-label">{s.label}</span>
                  {s.content}
                </div>
              ))}
            </section>
          )}
          {(workbook?.sections || []).map(sec => {
            const secBlocks = (sec.blocks || []).filter(isFillableBlock);
            const sectionNote = participant.section_notes?.[sec.id]?.note;
            const sectionPrep = participant.section_prep?.[sec.id]?.content;
            // Skip rendering a section if there's nothing to show.
            const hasContent = secBlocks.some(b => participant.answers?.[b.id]?.value != null)
              || sectionNote
              || sectionPrep
              || secBlocks.some(b => notesForP[b.id]);
            if (!hasContent) return null;
            return (
              <section key={sec.id} className="closed-section">
                <h3>{sec.title}</h3>
                {sectionPrep && (
                  <div className="participant-prep-callout">
                    <span className="participant-prep-callout-label">Prep</span>
                    {sectionPrep}
                  </div>
                )}
                {sectionNote && (
                  <div className="participant-note-readonly">
                    <span className="participant-note-readonly-label">Participant note</span>
                    <div className="participant-note-readonly-text" dangerouslySetInnerHTML={{ __html: sanitizeNotesHtml(sectionNote) }} />
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
