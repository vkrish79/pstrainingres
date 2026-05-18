import { useEffect, useMemo, useState } from 'react';
import { isFillableBlock, isAnswered, labelOf, inputCellsOf } from '../../lib/blockHelpers.js';
import NoteRow from './NoteRow.jsx';

// Layout: sidebar nav (one row per exercise, with cohort progress) → tile grid
// of participant responses on the right. Toolbar above the grid lets the
// trainer sort/filter/search and expand or collapse all tiles. Tiles default
// to collapsed when participant count > AUTO_COLLAPSE_THRESHOLD.
//
// Trainer annotations: each block in a tile shows a note/flag editor inline.

const AUTO_COLLAPSE_THRESHOLD = 8;

export default function ExerciseResponses({
  sections, blocks, participants, answers,
  notes = {}, participantNotes = {}, onSaveNote, onDeleteNote,
}) {
  const sectionsWithFillable = useMemo(() => {
    return sections
      .filter(sec => blocks.some(b => b.section_id === sec.id && isFillableBlock(b)))
      .map(sec => {
        const sBlocks = blocks.filter(b => b.section_id === sec.id && isFillableBlock(b));
        const totalSlots = sBlocks.length * participants.length;
        let answered = 0;
        let participantsDone = 0;
        for (const p of participants) {
          let pAnswered = 0;
          for (const b of sBlocks) {
            const a = answers[p.id]?.[b.id];
            if (a && isAnswered(b, a.value)) {
              answered += 1;
              pAnswered += 1;
            }
          }
          if (sBlocks.length > 0 && pAnswered === sBlocks.length) participantsDone += 1;
        }
        const pct = totalSlots ? Math.round((answered / totalSlots) * 100) : 0;
        return { ...sec, _stats: { pct, answered, totalSlots, participantsDone, blocksCount: sBlocks.length } };
      });
  }, [sections, blocks, participants, answers]);

  const [selectedId, setSelectedId] = useState(sectionsWithFillable[0]?.id || '');
  const [sortBy, setSortBy] = useState('name');
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'incomplete' | 'done' | 'flagged'
  const [query, setQuery] = useState('');
  const [defaultExpanded, setDefaultExpanded] = useState(participants.length <= AUTO_COLLAPSE_THRESHOLD);
  const [toggleSet, setToggleSet] = useState(() => new Set());

  useEffect(() => {
    if (!selectedId && sectionsWithFillable.length) setSelectedId(sectionsWithFillable[0].id);
  }, [sectionsWithFillable, selectedId]);

  useEffect(() => { setToggleSet(new Set()); }, [selectedId]);

  if (sectionsWithFillable.length === 0) {
    return <p className="muted">No fillable blocks in this workbook.</p>;
  }
  if (participants.length === 0) {
    return <p className="muted">No participants enrolled.</p>;
  }

  const selectedSection = sectionsWithFillable.find(s => s.id === selectedId) || sectionsWithFillable[0];
  const fillableInSection = blocks
    .filter(b => b.section_id === selectedSection.id && isFillableBlock(b))
    .sort((a, b) => a.order_index - b.order_index);

  const stats = participants.map(p => {
    const pAns = answers[p.id] || {};
    const pNotes = notes[p.id] || {};
    let answered = 0;
    let lastTs = 0;
    let flaggedCount = 0;
    let noteCount = 0;
    for (const b of fillableInSection) {
      const a = pAns[b.id];
      if (a && isAnswered(b, a.value)) answered += 1;
      if (a?.updated_at) {
        const t = new Date(a.updated_at).getTime();
        if (t > lastTs) lastTs = t;
      }
      const n = pNotes[b.id];
      if (n) {
        if (n.flag) flaggedCount += 1;
        if (n.note?.trim()) noteCount += 1;
      }
    }
    return { participant: p, answered, total: fillableInSection.length, lastTs, flaggedCount, noteCount };
  });

  const q = query.trim().toLowerCase();
  const filtered = stats.filter(s => {
    if (q && !(s.participant.full_name || '').toLowerCase().includes(q) && !(s.participant.email || '').toLowerCase().includes(q)) return false;
    if (filterMode === 'incomplete') return s.answered < s.total;
    if (filterMode === 'done') return s.total > 0 && s.answered === s.total;
    if (filterMode === 'flagged') return s.flaggedCount > 0;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'name') return (a.participant.full_name || '').localeCompare(b.participant.full_name || '');
    if (sortBy === 'progress_desc') return b.answered - a.answered;
    if (sortBy === 'progress_asc') return a.answered - b.answered;
    if (sortBy === 'recent') return b.lastTs - a.lastTs;
    return 0;
  });

  const isExpanded = (pid) => defaultExpanded !== toggleSet.has(pid);
  function toggleTile(pid) {
    setToggleSet(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  }
  function expandAll() { setDefaultExpanded(true); setToggleSet(new Set()); }
  function collapseAll() { setDefaultExpanded(false); setToggleSet(new Set()); }

  const flaggedTotal = stats.filter(s => s.flaggedCount > 0).length;

  return (
    <div className="exresp-layout">
      <div className="exresp-mobile-nav">
        <select className="form-input" value={selectedSection.id} onChange={e => setSelectedId(e.target.value)}>
          {sectionsWithFillable.map(sec => (
            <option key={sec.id} value={sec.id}>{sec.title} — {sec._stats.pct}%</option>
          ))}
        </select>
      </div>

      <aside className="exresp-sidebar">
        <div className="exresp-sidebar-head">Exercises</div>
        <ul className="exresp-sidebar-list">
          {sectionsWithFillable.map(sec => {
            const isActive = sec.id === selectedSection.id;
            const { pct, participantsDone, blocksCount } = sec._stats;
            const barClass = pct === 0 ? 'none' : pct === 100 ? 'full' : 'partial';
            return (
              <li key={sec.id}>
                <button
                  className={`exresp-sidebar-item ${isActive ? 'active' : ''}`}
                  onClick={() => setSelectedId(sec.id)}
                  title={`${participantsDone} of ${participants.length} participants done · ${blocksCount} block${blocksCount === 1 ? '' : 's'}`}
                >
                  <div className="exresp-sidebar-row">
                    <span className="exresp-sidebar-title">{sec.title}</span>
                    <span className="exresp-sidebar-pct">{pct}%</span>
                  </div>
                  <div className={`exresp-sidebar-bar ${barClass}`}>
                    <div className="exresp-sidebar-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="exresp-sidebar-meta">{participantsDone}/{participants.length} done</div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="exresp-main">
        <h3 className="exresp-main-title">{selectedSection.title}</h3>

        <div className="exresp-toolbar">
          <input
            className="form-input exresp-search"
            type="search"
            placeholder="Search participants…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <select className="form-input exresp-toolbar-select" value={filterMode} onChange={e => setFilterMode(e.target.value)}>
            <option value="all">All ({stats.length})</option>
            <option value="incomplete">Incomplete ({stats.filter(s => s.answered < s.total).length})</option>
            <option value="done">Done ({stats.filter(s => s.total > 0 && s.answered === s.total).length})</option>
            <option value="flagged">Flagged ({flaggedTotal})</option>
          </select>
          <select className="form-input exresp-toolbar-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="name">Name (A→Z)</option>
            <option value="progress_desc">Most progress first</option>
            <option value="progress_asc">Least progress first</option>
            <option value="recent">Recent activity</option>
          </select>
          <div className="exresp-toolbar-spacer" />
          <button className="ghost" onClick={expandAll} disabled={defaultExpanded && toggleSet.size === 0}>Expand all</button>
          <button className="ghost" onClick={collapseAll} disabled={!defaultExpanded && toggleSet.size === 0}>Collapse all</button>
        </div>

        {sorted.length === 0 && <p className="muted">No participants match the current filter.</p>}

        <div className="exresp-tiles">
          {sorted.map(s => (
            <ParticipantTile
              key={s.participant.id}
              stat={s}
              blocks={fillableInSection}
              answersForP={answers[s.participant.id] || {}}
              notesForP={notes[s.participant.id] || {}}
              sectionNote={participantNotes[s.participant.id]?.[selectedSection.id]?.note || ''}
              expanded={isExpanded(s.participant.id)}
              onToggle={() => toggleTile(s.participant.id)}
              onSaveNote={onSaveNote}
              onDeleteNote={onDeleteNote}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ParticipantTile({ stat, blocks, answersForP, notesForP, sectionNote, expanded, onToggle, onSaveNote, onDeleteNote }) {
  const { participant, answered, total, lastTs, flaggedCount, noteCount } = stat;
  const pct = total ? Math.round((answered / total) * 100) : 0;
  const progressClass = answered === 0 ? 'none' : answered === total ? 'full' : 'partial';
  const lastLabel = lastTs ? relativeTime(lastTs) : 'No activity yet';

  return (
    <div className={`exresp-tile ${expanded ? 'expanded' : 'collapsed'} ${flaggedCount > 0 ? 'has-flag' : ''}`}>
      <button className="exresp-tile-head" onClick={onToggle} aria-expanded={expanded}>
        <div className="exresp-tile-head-left">
          <span className="exresp-chevron" aria-hidden>{expanded ? '▾' : '▸'}</span>
          <span className="exresp-tile-name">{participant.full_name || '(unnamed)'}</span>
          {flaggedCount > 0 && <span className="exresp-flag-badge" title={`${flaggedCount} flagged`}>🚩 {flaggedCount}</span>}
          {noteCount > 0 && <span className="exresp-note-badge" title={`${noteCount} note${noteCount === 1 ? '' : 's'}`}>💬 {noteCount}</span>}
        </div>
        <div className="exresp-tile-head-right">
          <span className="exresp-tile-meta">{lastLabel}</span>
          <span className={`exresp-progress-pill ${progressClass}`}>{answered} / {total} ({pct}%)</span>
        </div>
      </button>
      {expanded && (
        <div className="exresp-tile-body">
          {sectionNote && (
            <div className="participant-note-readonly">
              <span className="participant-note-readonly-label">Participant note</span>
              <div className="participant-note-readonly-text">{sectionNote}</div>
            </div>
          )}
          {blocks.map(b => (
            <BlockAnswer
              key={b.id}
              block={b}
              entry={answersForP[b.id]}
              note={notesForP[b.id]}
              participantId={participant.id}
              onSaveNote={onSaveNote}
              onDeleteNote={onDeleteNote}
            />
          ))}
          {blocks.length === 0 && <p className="muted" style={{ margin: 0 }}>No questions in this exercise.</p>}
        </div>
      )}
    </div>
  );
}

function BlockAnswer({ block, entry, note, participantId, onSaveNote, onDeleteNote }) {
  const value = entry?.value;
  const label = labelOf(block);

  return (
    <div className="exresp-block">
      {block.block_type === 'field' && <FieldRender label={label} value={value} />}
      {block.block_type === 'table' && <TableRender block={block} label={label} value={value} />}
      <NoteRow
        note={note}
        participantId={participantId}
        blockId={block.id}
        onSaveNote={onSaveNote}
        onDeleteNote={onDeleteNote}
      />
    </div>
  );
}

function FieldRender({ label, value }) {
  const display = formatFieldValue(value);
  return (
    <div className={`exresp-answer ${display == null ? 'is-blank' : ''}`}>
      <div className="exresp-answer-label">{label}</div>
      <div className="exresp-answer-value">{display ?? '—'}</div>
    </div>
  );
}

function TableRender({ block, label, value }) {
  const cells = inputCellsOf(block);
  const cellMap = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  const filledCount = cells.filter(c => cellMap[c.id] != null && String(cellMap[c.id]).trim() !== '').length;
  return (
    <div className="exresp-table-answer">
      <div className="exresp-answer-label">
        {label}
        <span className="exresp-cellcount">{filledCount}/{cells.length}</span>
      </div>
      {cells.length === 0 && <p className="muted" style={{ margin: 0 }}>No input cells.</p>}
      {cells.length > 0 && (
        <table className="exresp-cell-table">
          <tbody>
            {cells.map(c => {
              const v = cellMap[c.id];
              const blank = v == null || String(v).trim() === '';
              return (
                <tr key={c.id} className={blank ? 'is-blank' : ''}>
                  <th>{c.label}</th>
                  <td>{blank ? '—' : String(v)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatFieldValue(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length ? v.join(', ') : null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  return Math.floor(diff / 86_400_000) + 'd ago';
}
