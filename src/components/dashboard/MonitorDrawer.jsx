import { useEffect, useState } from 'react';
import Block from '../blocks/Block.jsx';
import { isFillableBlock, isAnswered } from '../../lib/blockHelpers.js';

// Right push-in drawer for the trainer's "My copy": a live monitor of the
// cohort on the currently-SELECTED exercise. Driven by the sidebar selection
// (not a scroll-spy) — in teaching, "I'm on this exercise now" is a deliberate
// gesture, and a scroll-spy would flicker as the trainer scrolls past.
//
// Shows, for the selected exercise: who's on it right now (live dot), every
// participant's completion (answered/total), and an inline drill-down to each
// participant's actual answers. Read-only.
export default function MonitorDrawer({
  open, onClose, section, blocks, participants = [], participantAnswers = {}, liveHere = [],
  className = '', onWideChange,
}) {
  const [expanded, setExpanded] = useState(() => new Set());

  // Expanding a participant shows their full exercise — too wide for the narrow
  // drawer. Report "wide" so the parent shrinks the canvas to the exercise
  // sidebar and the drawer takes the freed space.
  const isWide = open && expanded.size > 0;
  useEffect(() => { onWideChange?.(isWide); }, [isWide, onWideChange]);

  const sectionBlocks = section
    ? blocks.filter(b => b.section_id === section.id && isFillableBlock(b))
    : [];
  const total = sectionBlocks.length;
  const hereIds = new Set(liveHere.map(p => p.id));

  const rows = participants.map(p => {
    const pa = participantAnswers[p.id] || {};
    let answered = 0;
    for (const b of sectionBlocks) if (isAnswered(b, pa[b.id]?.value)) answered += 1;
    const status = total > 0 && answered === total ? 'done' : answered > 0 ? 'partial' : 'none';
    return { p, answered, status, here: hereIds.has(p.id) };
  });
  // Online-on-this-exercise first, then alphabetical.
  rows.sort((a, b) => (Number(b.here) - Number(a.here)) || (a.p.full_name || '').localeCompare(b.p.full_name || ''));
  const doneCount = rows.filter(r => r.status === 'done').length;

  function toggle(pid) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  }

  return (
    <aside className={`monitor-drawer ${className} ${open ? 'open' : ''} ${isWide ? 'monitor-drawer--wide' : ''}`} role="dialog" aria-label="Monitor participants" aria-hidden={!open}>
      <header className="monitor-drawer-head">
        <h2>👁 Monitor</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close monitor">×</button>
      </header>
      <div className="monitor-drawer-body">
        {!section ? (
          <p className="monitor-empty">Pick an exercise from the list on the left to monitor who's working on it.</p>
        ) : (
          <>
            <div className="monitor-exercise">{section.title}</div>
            <div className="monitor-summary">
              <span className="monitor-summary-here"><span className="presence-dot live" /> {liveHere.length} here now</span>
              <span>{doneCount}/{participants.length} completed</span>
            </div>
            {participants.length === 0 ? (
              <p className="monitor-empty">No participants enrolled.</p>
            ) : (
              <ul className="monitor-list">
                {rows.map(({ p, answered, status, here }) => {
                  const isOpen = expanded.has(p.id);
                  return (
                    <li key={p.id} className="monitor-row">
                      <button type="button" className="monitor-row-head" onClick={() => toggle(p.id)} aria-expanded={isOpen}>
                        <span className={`presence-dot ${here ? 'live' : 'offline'}`} title={here ? 'On this exercise now' : 'Not here now'} />
                        <span className="monitor-row-name">{p.full_name || '(unnamed)'}</span>
                        <span className={`monitor-status ${status}`}>{total > 0 ? `${answered}/${total}` : '—'}</span>
                        <span className="monitor-chevron" aria-hidden>{isOpen ? '▾' : '▸'}</span>
                      </button>
                      {isOpen && (
                        <div className="monitor-row-body">
                          {sectionBlocks.length === 0 && <p className="muted" style={{ margin: 0 }}>No fillable blocks in this exercise.</p>}
                          {sectionBlocks.map(b => (
                            <Block key={b.id} block={b} value={(participantAnswers[p.id] || {})[b.id]?.value} onChange={() => {}} readOnly />
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
