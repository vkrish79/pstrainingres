import { useEffect, useMemo, useState } from 'react';

export const ALL_KEY = '__all__';

// The exercise rail down the left of the workbook: overall progress, the
// Next-unanswered jump, the filter, and the exercises grouped under their
// chapters (folding), with the row for where the participant is kept in view.
export default function WorkbookRail({
  sidebarRef, sectionRefs, sectionStats, overallProgress, resume, onContinue,
  selectedSectionId, setSelectedSectionId, currentSectionId, focus, notesByCount,
}) {
  const [exFilter, setExFilter] = useState('');

  // Exercise-jump filter: narrows the sidebar to exercises whose title contains
  // the typed text. Titles already carry the exercise number ("Exercise 18"), so
  // a plain substring match handles both "18" and title words — and avoids the
  // false hits a position-based match caused (section order ≠ exercise number).
  // Enter jumps to the top match; Esc clears. See docs/enhancements-roadmap.md #4.
  const filteredStats = useMemo(() => {
    const q = exFilter.trim().toLowerCase();
    if (!q) return sectionStats;
    return sectionStats.filter(s => s.title.toLowerCase().includes(q));
  }, [sectionStats, exFilter]);

  // ── The exercise rail ─────────────────────────────────────────────────────
  // Exercises sit under the group (Word H1) before them. A group with no
  // exercises of its own — Cover, Document information — is a page, not a
  // chapter, and moves to the foot of the rail.
  const railModel = useMemo(() => {
    const groups = [];
    let cur = null;
    for (const st of sectionStats) {
      if (st.kind === 'group') { cur = { id: st.id, title: st.title, items: [] }; groups.push(cur); continue; }
      if (!cur) { cur = { id: '__lead', title: null, items: [] }; groups.push(cur); }
      cur.items.push(st);
    }
    const out = [], pages = [];
    for (const g of groups) {
      if (!g.items.length) { if (g.title) pages.push(g); continue; }
      const counted = g.items.filter(i => i.total > 0);
      const total = counted.reduce((n, i) => n + i.total, 0);
      const answered = counted.reduce((n, i) => n + i.answered, 0);
      const done = counted.filter(i => i.pct === 100).length;
      out.push({
        ...g, total, answered, done, of: counted.length,
        pct: total ? Math.round((answered / total) * 100) : 0,
        complete: counted.length > 0 && done === counted.length,
      });
    }
    return { groups: out, pages };
  }, [sectionStats]);

  const groupOfSection = useMemo(() => {
    const m = {};
    for (const g of railModel.groups) for (const i of g.items) m[i.id] = g.id;
    return m;
  }, [railModel]);

  // Folding. A finished group folds by itself; any other group is open. The
  // participant can fold or open either, and the group holding where they are
  // — scrolled to, picked, or spotlighted by the trainer — reopens whenever
  // that place moves into it, so a folded group never hides their place.
  const [foldedGroups, setFoldedGroups] = useState(() => new Set());
  const [openedGroups, setOpenedGroups] = useState(() => new Set());
  const isGroupOpen = g => !g.title || (g.complete ? openedGroups.has(g.id) : !foldedGroups.has(g.id));
  function toggleGroup(g) {
    const open = isGroupOpen(g);
    const edit = add => prev => {
      const next = new Set(prev);
      if (add) next.add(g.id); else next.delete(g.id);
      return next;
    };
    if (g.complete) setOpenedGroups(edit(!open));
    else setFoldedGroups(edit(open));
  }
  const hereSectionId = selectedSectionId === ALL_KEY ? currentSectionId : selectedSectionId;
  useEffect(() => {
    const ids = [hereSectionId, focus?.section_id].map(id => groupOfSection[id]).filter(Boolean);
    if (!ids.length) return;
    setFoldedGroups(prev => (ids.some(id => prev.has(id)) ? new Set([...prev].filter(id => !ids.includes(id))) : prev));
    setOpenedGroups(prev => (ids.every(id => prev.has(id)) ? prev : new Set([...prev, ...ids])));
  }, [hereSectionId, focus?.section_id, groupOfSection]);

  // Searching shows matching exercises as one flat list, groups set aside.
  const railFiltered = useMemo(
    () => (exFilter.trim() ? filteredStats.filter(st => st.kind !== 'group') : []),
    [filteredStats, exFilter],
  );

  function renderRailRow(st) {
    const isActive = selectedSectionId === st.id;
    // WHERE THEY ARE, as opposed to what they picked: in All exercises the
    // scroll-spy's section is marked, so the rail follows the page.
    const isHere = selectedSectionId === ALL_KEY && currentSectionId === st.id;
    const noteWords = notesByCount[st.id] || 0;
    const state = st.total === 0 ? 'read' : st.pct === 100 ? 'done' : st.answered > 0 ? 'part' : 'none';
    return (
      <li key={st.id}>
        <button
          className={`exresp-sidebar-item wb-rail-row ${isActive ? 'active' : ''} ${isHere ? 'is-here' : ''}`}
          data-nav-id={st.id}
          aria-current={isHere || isActive ? 'true' : undefined}
          onClick={() => setSelectedSectionId(st.id)}
        >
          <span
            className={`wb-rail-tick is-${state}`}
            style={state === 'part' ? { '--p': `${st.pct}%` } : undefined}
            role={state === 'read' ? undefined : 'img'}
            aria-label={state === 'done' ? 'Every box answered' : state === 'part' ? `${st.pct}% answered` : state === 'none' ? 'Not started' : undefined}
          >
            {state === 'done' ? '✓' : ''}
          </span>
          <span className="exresp-sidebar-title wb-rail-name">
            {st.title}
            {focus?.section_id === st.id && <span className="wb-rail-spot">Trainer here</span>}
            {noteWords > 0 && (
              <span className="exresp-sidebar-note-badge" data-tip={`${noteWords} word${noteWords === 1 ? '' : 's'} in your note`}>
                💬 {noteWords}
              </span>
            )}
          </span>
          {st.total > 0 && <span className={`wb-rail-count is-${state}`}>{st.answered}/{st.total}</span>}
          {st.total > 0 && (
            <span className={`wb-rail-bar is-thin${state === 'done' ? ' is-done' : ''}`}>
              <i style={{ width: `${st.pct}%` }} />
            </span>
          )}
        </button>
      </li>
    );
  }

  function onExFilterKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (railFiltered.length) setSelectedSectionId(railFiltered[0].id);
    } else if (e.key === 'Escape') {
      setExFilter('');
    }
  }

  // Keep the "you are here" row visible IN THE RAIL as the page scrolls.
  //
  // The rail is 85 entries with its own scrollbar, so marking the current
  // exercise is only half of it — the mark lands on a row nobody can see, and
  // the rail reads as though it has stopped following.
  //
  // Nudges the rail's own scrollTop rather than calling scrollIntoView, which
  // would scroll the PAGE and fight the scroll that moved the marker.
  useEffect(() => {
    if (selectedSectionId !== ALL_KEY || !currentSectionId) return;
    const rail = sidebarRef.current;
    const item = rail?.querySelector(`[data-nav-id="${currentSectionId}"]`);
    if (!rail || !item) return;
    const r = rail.getBoundingClientRect();
    const i = item.getBoundingClientRect();
    if (i.top < r.top + 8) rail.scrollTop -= (r.top + 8 - i.top);
    else if (i.bottom > r.bottom - 8) rail.scrollTop += (i.bottom - (r.bottom - 8));
  }, [currentSectionId, selectedSectionId, foldedGroups, openedGroups, sidebarRef]);

  return (
    <aside className="exresp-sidebar wb-rail" ref={sidebarRef}>
      <div className="exresp-sidebar-head wb-rail-head">
        <div className="wb-rail-cap">
          <span>Exercises</span>
          <span className="wb-rail-total">{overallProgress.filled} / {overallProgress.total} answered</span>
        </div>
        <div className={`wb-rail-bar${overallProgress.total && overallProgress.filled === overallProgress.total ? ' is-done' : ''}`}>
          <i style={{ width: `${overallProgress.total ? Math.round(overallProgress.filled / overallProgress.total * 100) : 0}%` }} />
        </div>
      </div>
      {resume && (
        <button type="button" className="wb-rail-next" onClick={onContinue}>
          <span>Next unanswered → {resume.sectionTitle}{resume.questionCount > 1 ? `, question ${resume.questionNo}` : ''}</span>
          <span aria-hidden="true">›</span>
        </button>
      )}
      <input
        type="text"
        className="exresp-sidebar-filter"
        placeholder="Jump to exercise…"
        value={exFilter}
        onChange={e => setExFilter(e.target.value)}
        onKeyDown={onExFilterKeyDown}
        aria-label="Filter exercises"
      />
      <ul className="exresp-sidebar-list wb-rail-list">
        {!exFilter.trim() && (
          <li>
            <button
              className={`exresp-sidebar-item wb-rail-all ${selectedSectionId === ALL_KEY ? 'active' : ''}`}
              onClick={() => setSelectedSectionId(ALL_KEY)}
            >
              <div className="exresp-sidebar-row">
                <span className="exresp-sidebar-title">All exercises</span>
              </div>
            </button>
          </li>
        )}
        {exFilter.trim() ? (
          railFiltered.length === 0
            ? <li className="exresp-sidebar-empty">No exercises match “{exFilter.trim()}”</li>
            : railFiltered.map(renderRailRow)
        ) : (
          <>
            {railModel.groups.map(g => {
              const open = isGroupOpen(g);
              const groupHere = selectedSectionId === ALL_KEY && currentSectionId === g.id;
              return (
                <li key={g.id} className={`wb-rail-group${open ? ' is-open' : ''}`}>
                  {g.title && (
                    <>
                      <button
                        type="button"
                        className={`wb-rail-group-head${groupHere ? ' is-here' : ''}`}
                        data-nav-id={g.id}
                        aria-expanded={open}
                        onClick={() => toggleGroup(g)}
                        data-tip={open ? 'Fold this group' : 'Show the exercises in this group'}
                      >
                        <span className="wb-rail-chev" aria-hidden="true">▼</span>
                        {/* Break long chapter names after a slash, not mid-word. */}
                        <span className="wb-rail-group-title">{g.title.replace(/\//g, '/​')}</span>
                        {g.of > 0 && <span className="wb-rail-group-n">{g.done} of {g.of}</span>}
                      </button>
                      {g.total > 0 && (
                        <div className={`wb-rail-bar is-thin wb-rail-group-bar${g.complete ? ' is-done' : ''}`}>
                          <i style={{ width: `${g.pct}%` }} />
                        </div>
                      )}
                    </>
                  )}
                  {open && <ul className="wb-rail-rows">{g.items.map(renderRailRow)}</ul>}
                </li>
              );
            })}
            {railModel.pages.length > 0 && (
              <li className="wb-rail-pages">
                {railModel.pages.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    data-nav-id={p.id}
                    className={selectedSectionId === ALL_KEY && currentSectionId === p.id ? 'is-here' : ''}
                    onClick={() => {
                      setSelectedSectionId(ALL_KEY);
                      requestAnimationFrame(() => {
                        const el = sectionRefs.current[p.id];
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      });
                    }}
                  >
                    {p.title}
                  </button>
                ))}
              </li>
            )}
          </>
        )}
      </ul>
    </aside>
  );
}
