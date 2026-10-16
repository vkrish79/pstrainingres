import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useReviewPeopleMarks } from '../../hooks/useAnswerReview.js';
import { isFillableBlock, expectedInputs, filledInputs } from '../../lib/blockHelpers.js';
import { itemsForExercise } from '../../lib/prepAttach.js';
import MarkingScreen from './MarkingScreen.jsx';
import { questionTally } from '../../lib/questionTally.js';
import ParticipantTile from './exerciseResponses/ParticipantTile.jsx';
import ParticipantFocus from './exerciseResponses/ParticipantFocus.jsx';
import BlockAnswer from './exerciseResponses/BlockAnswer.jsx';
import { byFullName } from '../../lib/byName.js';

// Layout: sidebar nav (one row per exercise, with cohort progress) → tile grid
// of participant responses on the right. Toolbar above the grid lets the
// trainer sort/filter/search and expand or collapse all tiles. Tiles default
// to collapsed when participant count > AUTO_COLLAPSE_THRESHOLD.
//
// Trainer annotations: each block in a tile shows a note/flag editor inline.

const AUTO_COLLAPSE_THRESHOLD = 8;

export default function ExerciseResponses({
  // Optional: with a session id, the trainer can compare every answer with
  // their own practice copy (and with whatever they accepted while going over
  // the exercise with the class). The assessment view passes none.
  sessionId = null,
  sections, blocks, participants, answers,
  notes = {}, participantNotes = {}, prepBy = {}, standaloneBy = {}, prepLayout = null, liveBySection = {}, onSaveNote, onDeleteNote,
  showNotes = true, emptyLabel = 'No fillable blocks in this workbook.', answerKey = null, answerPoints = null,
  // Optional { [blockId]: questionNumber }. When supplied (assessment view),
  // each answer row is prefixed "Q{n}" so it matches the flat editor/participant
  // numbering. Omitted for the workbook view, which keeps plain labels.
  questionNumbers = null,
  // Manual marking (assessment view only). answerModes says which questions a
  // person judges; marks holds what was awarded; onMark records it. Omit them
  // and this renders exactly as the workbook view always has.
  answerModes = null,
  marks = null,
  onMark = null,
  onComment = null,
  // { [participantId]: helpRequest } — who has their hand up. Optional; the
  // workbook view passes none.
  hands = null,
  // Marking criteria per question, and the writer for a criterion-by-criterion
  // breakdown. Present only on the assessment view, and only once someone has
  // authored criteria; without them this renders exactly as it always has.
  guidance = null,
  onBreakdown = null,
  markingIds = null,
  // Where to open: an exercise, and optionally one person in it to reveal.
  // Set when the heat board sends a trainer here from a cell or a heading.
  initialSectionId = null,
  initialParticipantId = null,
  // Assessment view only. { [sectionId]: heading } is the paper's own numbering
  // (buildQuestions): a question added from the bank keeps the title it had
  // there, so the stored "Question 4" can be the first question. The workbook
  // passes none and its exercises keep their own titles.
  sectionHeadings = null,
  navLabel = 'Exercises',
  // Assessment view: (participantId, sectionId) → [{ label, content }], their
  // pre-work for that question, shown on the marking screen.
  prepFor = null,
}) {
  const headingOf = sec => sectionHeadings?.[sec.id] ?? sec.title;
  // Marking happens here only on an assessment; the workbook view has no modes.
  const marking = !!answerModes;

  // The marking screen lives in the link — ?mark=<person>&mq=<question>, or
  // ?mpart=<part> — so a refresh, or a link sent to a co-marker, opens the
  // same place.
  const [searchParams, setSearchParams] = useSearchParams();
  const markPid = marking ? searchParams.get('mark') : null;
  const markPart = marking ? searchParams.get('mpart') : null;
  const markQ = marking ? searchParams.get('mq') : null;
  const setMarkParams = useCallback((patch) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v == null) next.delete(k); else next.set(k, v); }
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const [showMarks, setShowMarks] = useState(() => {
    try { return localStorage.getItem('session-answer-marks') === '1'; } catch { return false; }
  });
  const sectionsWithFillable = useMemo(() => {
    return sections
      .filter(sec => blocks.some(b => b.section_id === sec.id && isFillableBlock(b)))
      .map(sec => {
        const sBlocks = blocks.filter(b => b.section_id === sec.id && isFillableBlock(b));
        // Slots are INPUTS x participants, not blocks x participants: a 10-cell
        // table is ten things each participant has to fill.
        const inputsPerParticipant = sBlocks.reduce((n, b) => n + expectedInputs(b), 0);
        const totalSlots = inputsPerParticipant * participants.length;
        let answered = 0;
        let participantsDone = 0;
        for (const p of participants) {
          let pAnswered = 0;
          for (const b of sBlocks) {
            pAnswered += filledInputs(b, answers[p.id]?.[b.id]?.value);
          }
          answered += pAnswered;
          if (inputsPerParticipant > 0 && pAnswered === inputsPerParticipant) participantsDone += 1;
        }
        const pct = totalSlots ? Math.round((answered / totalSlots) * 100) : 0;
        return { ...sec, _stats: { pct, answered, totalSlots, participantsDone, blocksCount: sBlocks.length } };
      });
  }, [sections, blocks, participants, answers]);

  // What each question is worth and how many people it is fully marked for.
  const markingBySection = useMemo(() => {
    if (!marking) return null;
    const out = {};
    for (const sec of sectionsWithFillable) {
      const sBlocks = blocks.filter(b => b.section_id === sec.id);
      let worth = 0;
      let done = 0;
      participants.forEach((p, i) => {
        const t = questionTally(sBlocks, answerKey || {}, answers[p.id] || {}, answerPoints, answerModes, marks?.[p.id] || {}, guidance);
        if (i === 0) worth = t.possible;
        if (t.parts.length && t.complete) done += 1;
      });
      out[sec.id] = { worth, done };
    }
    return out;
  }, [marking, sectionsWithFillable, blocks, participants, answers, answerKey, answerPoints, answerModes, marks, guidance]);
  const paperWorth = markingBySection
    ? Math.round(Object.values(markingBySection).reduce((s, m) => s + m.worth, 0) * 10) / 10
    : 0;

  const [selectedId, setSelectedId] = useState(
    (initialSectionId && sectionsWithFillable.some(s => s.id === initialSectionId) ? initialSectionId : null)
      || sectionsWithFillable[0]?.id || '',
  );
  const [sortBy, setSortBy] = useState('name');
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'incomplete' | 'done' | 'flagged'
  const [query, setQuery] = useState('');
  // On an assessment the rows start closed and open one at a time: each open
  // row is a whole paper.
  const [defaultExpanded, setDefaultExpanded] = useState(!marking && participants.length <= AUTO_COLLAPSE_THRESHOLD);
  const [toggleSet, setToggleSet] = useState(() => new Set());
  // "Who's here" popover: { sectionId, x, y, pinned }. Hover shows it
  // transiently; clicking the badge pins it open (and interactive). Names are
  // derived live from liveBySection at render, so the panel stays current.
  const [popover, setPopover] = useState(null);
  const popoverRef = useRef(null);
  // A participant to reveal (expand + scroll) after a popover drill-down. Done
  // via an effect because selecting a new exercise resets toggleSet first.
  const [drillTarget, setDrillTarget] = useState(initialParticipantId);

  function openHover(e, sectionId) {
    if (popover?.pinned) return; // a pinned popover takes precedence over hover
    const r = e.currentTarget.getBoundingClientRect();
    setPopover({ sectionId, x: r.right + 8, y: r.top, pinned: false });
  }
  function closeHover() {
    setPopover(prev => (prev && !prev.pinned ? null : prev));
  }
  function togglePin(e, sectionId) {
    const r = e.currentTarget.getBoundingClientRect();
    setPopover(prev => (prev?.pinned && prev.sectionId === sectionId
      ? null
      : { sectionId, x: r.right + 8, y: r.top, pinned: true }));
  }
  // Drill from a popover name to that participant's tile on that exercise.
  function drillTo(sectionId, participantId) {
    setSelectedId(sectionId);
    setDrillTarget(participantId);
    setPopover(null);
  }

  useEffect(() => {
    if (!selectedId && sectionsWithFillable.length) setSelectedId(sectionsWithFillable[0].id);
  }, [sectionsWithFillable, selectedId]);

  useEffect(() => { setToggleSet(new Set()); }, [selectedId]);

  // Reveal a drilled-to participant: FOCUS just them — collapse everyone
  // (default-collapsed) and expand only the target. Runs after the selectedId
  // reset above (declared later → runs later), so it sticks. Then scroll to it.
  useEffect(() => {
    if (!drillTarget) return;
    setDefaultExpanded(false);
    setToggleSet(new Set([drillTarget]));
    const el = document.getElementById(`exresp-tile-${drillTarget}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setDrillTarget(null);
  }, [drillTarget, selectedId]);

  // Dismiss a pinned popover on Escape or a click outside it. (Badge clicks
  // call stopPropagation, so they never reach this listener.)
  useEffect(() => {
    if (!popover?.pinned) return undefined;
    function onKey(e) { if (e.key === 'Escape') setPopover(null); }
    function onClick(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setPopover(null);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('click', onClick); };
  }, [popover?.pinned]);

  // Every hook runs before the early returns below, on every render — React
  // needs the same hooks in the same order each time. With no questions the
  // section is undefined and the review read simply does nothing.
  const selectedSection = sectionsWithFillable.find(s => s.id === selectedId) || sectionsWithFillable[0];
  const { marks: reviewMarks, loading: marksLoading } = useReviewPeopleMarks(
    sessionId, showMarks ? selectedSection?.id : null, !!sessionId && showMarks,
  );
  // The participant whose answers are open full-width. Marking a long paper
  // in a 320px column meant scrolling inside a scroll; this is the way out.
  const [focusId, setFocusId] = useState(null);
  // The row just opened on an assessment, brought to the top once drawn — the
  // row closing above it would otherwise move it off screen.
  const [scrollPid, setScrollPid] = useState(null);
  useEffect(() => {
    if (!scrollPid) return;
    requestAnimationFrame(() => {
      document.getElementById(`exresp-tile-${scrollPid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    setScrollPid(null);
  }, [scrollPid]);

  if (sectionsWithFillable.length === 0) {
    return <p className="muted">{emptyLabel}</p>;
  }
  if (participants.length === 0) {
    return <p className="muted">No participants enrolled.</p>;
  }

  const fillableInSection = blocks
    .filter(b => b.section_id === selectedSection.id && isFillableBlock(b))
    .sort((a, b) => a.order_index - b.order_index);
  // Denominator in INPUTS, matching how `answered` is now counted.
  const inputsInSection = fillableInSection.reduce((n, b) => n + expectedInputs(b), 0);

  const stats = participants.map(p => {
    const pAns = answers[p.id] || {};
    const pNotes = notes[p.id] || {};
    let answered = 0;
    let lastTs = 0;
    let flaggedCount = 0;
    let noteCount = 0;
    for (const b of fillableInSection) {
      const a = pAns[b.id];
      answered += filledInputs(b, a?.value);
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
    return { participant: p, answered, total: inputsInSection, lastTs, flaggedCount, noteCount };
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
    if (sortBy === 'name') return byFullName(a.participant, b.participant);
    if (sortBy === 'progress_desc') return b.answered - a.answered;
    if (sortBy === 'progress_asc') return a.answered - b.answered;
    if (sortBy === 'recent') return b.lastTs - a.lastTs;
    return 0;
  });

  const isExpanded = (pid) => defaultExpanded !== toggleSet.has(pid);

  function toggleTile(pid) {
    if (marking) {
      const opening = !toggleSet.has(pid);
      setDefaultExpanded(false);
      setToggleSet(opening ? new Set([pid]) : new Set());
      if (opening) setScrollPid(pid);
      return;
    }
    setToggleSet(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  }
  function expandAll() { setDefaultExpanded(true); setToggleSet(new Set()); }
  function collapseAll() { setDefaultExpanded(false); setToggleSet(new Set()); }

  const flaggedTotal = stats.filter(s => s.flaggedCount > 0).length;

  // Next to mark: the first person after the open row, in the list's order,
  // with a part still to mark on this question. Wraps round.
  const leftFor = pid => questionTally(fillableInSection, answerKey || {}, answers[pid] || {}, answerPoints, answerModes, marks?.[pid] || {}, guidance).left;
  const nextToMark = (() => {
    if (!marking || sorted.length === 0) return null;
    const openIdx = sorted.findIndex(x => toggleSet.has(x.participant.id));
    for (let i = 1; i <= sorted.length; i += 1) {
      const s = sorted[(openIdx + i + sorted.length) % sorted.length];
      if (s.participant.id !== sorted[openIdx]?.participant.id && leftFor(s.participant.id) > 0) return s.participant.id;
    }
    return null;
  })();

  return (
    <div className="exresp-layout">
      <div className="exresp-mobile-nav">
        <select className="form-input" value={selectedSection.id} onChange={e => setSelectedId(e.target.value)}>
          {sectionsWithFillable.map(sec => (
            <option key={sec.id} value={sec.id}>{headingOf(sec)} — {sec._stats.pct}%</option>
          ))}
        </select>
      </div>

      <aside className="exresp-sidebar">
        <div className="exresp-sidebar-head">{navLabel}{marking && paperWorth > 0 ? ` · ${paperWorth} marks` : ''}</div>
        <ul className="exresp-sidebar-list">
          {sectionsWithFillable.map(sec => {
            const isActive = sec.id === selectedSection.id;
            const { pct, participantsDone } = sec._stats;
            // On an assessment the bar is MARKING progress — how many people
            // this question is finished for — and the figure is its worth.
            const m = markingBySection?.[sec.id];
            const barPct = m ? (participants.length ? Math.round((m.done / participants.length) * 100) : 0) : pct;
            const barClass = barPct === 0 ? 'none' : barPct === 100 ? 'full' : 'partial';
            const here = liveBySection[sec.id] || [];
            return (
              <li key={sec.id}>
                <button
                  className={`exresp-sidebar-item ${isActive ? 'active' : ''}`}
                  onClick={() => setSelectedId(sec.id)}
                >
                  <div className="exresp-sidebar-row">
                    <span className="exresp-sidebar-title">{headingOf(sec)}</span>
                    <span className="exresp-sidebar-pct">{m ? `${m.worth} marks` : `${pct}%`}</span>
                  </div>
                  <div className={`exresp-sidebar-bar ${barClass}${m ? ' is-marking' : ''}`}>
                    <div className="exresp-sidebar-bar-fill" style={{ width: `${barPct}%` }} />
                  </div>
                  <div className="exresp-sidebar-meta">
                    {m
                      ? <>{m.done} of {participants.length} marked<span className="exresp-sidebar-meta-r">{pct}% answered</span></>
                      : <>{participantsDone}/{participants.length} done</>}
                  </div>
                </button>
                {/* Sibling of the select button (not nested) so it can be its
                    own focusable, clickable control — invalid as a button-in-a-
                    button, and the reason the row is restructured. */}
                {here.length > 0 && (
                  <button
                    type="button"
                    className={`exresp-sidebar-live exresp-sidebar-live ${popover?.sectionId === sec.id && popover?.pinned ? 'pinned' : ''}`}
                    aria-label={`${here.length} on this exercise now: ${here.map(p => p.full_name || 'unnamed').join(', ')}`}
                    aria-expanded={popover?.sectionId === sec.id}
                    onMouseEnter={(e) => openHover(e, sec.id)}
                    onMouseLeave={closeHover}
                    onFocus={(e) => openHover(e, sec.id)}
                    onBlur={closeHover}
                    onClick={(e) => { e.stopPropagation(); togglePin(e, sec.id); }}
                  >
                    <span className="presence-dot live" /> {here.length} here
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="exresp-main">
        <h3 className="exresp-main-title">{headingOf(selectedSection)}</h3>

        <div className={`exresp-toolbar${marking ? ' is-marking' : ''}`}>
          <input
            className="form-input exresp-search"
            type="search"
            placeholder={marking ? 'Search names…' : 'Search participants…'}
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
          {sessionId && (
            <button
              className={`ghost ${showMarks ? 'active' : ''}`}
              onClick={() => setShowMarks(v => {
                const next = !v;
                try { localStorage.setItem('session-answer-marks', next ? '1' : '0'); } catch { /* private window */ }
                return next;
              })}
              data-tip="Compare every answer with your practice copy, and with what you accepted when going over the exercise"
            >
              {marksLoading ? '✓ Checking…' : showMarks ? '✓ Hide right/wrong' : '✓ Show right/wrong'}
            </button>
          )}
          {marking && fillableInSection.length > 0 && (
            <button
              className="ghost"
              onClick={() => setMarkParams({ mpart: fillableInSection[0].id, mark: null, mq: null })}
              data-tip="Mark one part for the whole class, answers side by side"
            >
              Mark by part
            </button>
          )}
          {marking ? (
            <button
              className="exresp-next"
              onClick={() => toggleTile(nextToMark)}
              disabled={!nextToMark}
              data-tip={nextToMark ? 'Open the next person with parts of this question still to mark' : 'Nothing left to mark on this question'}
            >
              Next to mark →
            </button>
          ) : (
            <>
              <button className="ghost" onClick={expandAll} disabled={defaultExpanded && toggleSet.size === 0}>Expand all</button>
              <button className="ghost" onClick={collapseAll} disabled={!defaultExpanded && toggleSet.size === 0}>Collapse all</button>
            </>
          )}
        </div>

        {sorted.length === 0 && <p className="muted">No participants match the current filter.</p>}

        <div className={`exresp-tiles${marking ? ' is-rows' : ''}`}>
          {sorted.map(s => (
            <ParticipantTile
              key={s.participant.id}
              rows={marking}
              stat={s}
              blocks={fillableInSection}
              answersForP={answers[s.participant.id] || {}}
              notesForP={notes[s.participant.id] || {}}
              reviewMarks={reviewMarks}
              sectionNote={participantNotes[s.participant.id]?.[selectedSection.id]?.note || ''}
              prepItems={itemsForExercise(prepBy[s.participant.id]?.[selectedSection.id]?.content, standaloneBy[s.participant.id], prepLayout, selectedSection.id)}
              expanded={isExpanded(s.participant.id)}
              onToggle={() => toggleTile(s.participant.id)}
              onFocus={() => (marking
                ? setMarkParams({ mark: s.participant.id, mq: selectedSection.id, mpart: null })
                : setFocusId(s.participant.id))}
              onSaveNote={onSaveNote}
              onDeleteNote={onDeleteNote}
              showNotes={showNotes}
              answerKey={answerKey}
              answerPoints={answerPoints}
              questionNumbers={questionNumbers}
              answerModes={answerModes}
              marksForP={marks ? (marks[s.participant.id] || {}) : null}
              onMark={onMark}
              onComment={onComment}
              hands={hands}
              guidance={guidance}
              onBreakdown={onBreakdown}
              markingIds={markingIds}
              questionHeading={marking ? headingOf(selectedSection) : null}
            />
          ))}
        </div>
      </div>

      {marking && (markPid || markPart) && (() => {
        // Everyone, by name — marking covers the class whatever the tile filter.
        const people = [...participants]
          .sort(byFullName)
          .map(p => ({ id: p.id, name: p.full_name || '(unnamed)' }));
        const nameOf = id => people.find(p => p.id === id)?.name || '';
        const questionsAll = sectionsWithFillable.map(sec => {
          const all = blocks.filter(b => b.section_id === sec.id).sort((a, b) => a.order_index - b.order_index);
          return { id: sec.id, heading: headingOf(sec), all, narration: all.filter(b => !isFillableBlock(b)), fillable: all.filter(b => isFillableBlock(b)) };
        });
        const firstPart = questionsAll[0]?.fillable[0]?.id || null;
        const qid = markQ && questionsAll.some(x => x.id === markQ) ? markQ : (questionsAll[0]?.id || null);
        const marksOf = pid => (marks ? (marks[pid] || {}) : {});
        const tallyFor = (pid, sid) => {
          const qq = questionsAll.find(x => x.id === sid);
          return questionTally(qq ? qq.all : [], answerKey || {}, answers[pid] || {}, answerPoints, answerModes, marksOf(pid), guidance);
        };
        const partChip = (pid, blockId) => {
          const b = blocks.find(x => x.id === blockId);
          const t = b ? questionTally([b], answerKey || {}, answers[pid] || {}, answerPoints, answerModes, marksOf(pid), guidance) : null;
          return t?.parts[0]?.chip || null;
        };
        return (
          <MarkingScreen
            mode={markPart ? 'part' : 'person'}
            onMode={m => (m === 'part'
              ? setMarkParams({ mpart: (questionsAll.find(x => x.id === qid)?.fillable[0]?.id) || firstPart, mark: null, mq: null })
              : setMarkParams({ mark: people[0]?.id || null, mq: qid, mpart: null }))}
            people={people}
            personId={markPid}
            onPerson={pid => setMarkParams({ mark: pid })}
            questions={questionsAll}
            qid={qid}
            onQuestion={sid => setMarkParams({ mq: sid })}
            partId={markPart}
            onPart={bid => setMarkParams({ mpart: bid })}
            tallyFor={tallyFor}
            partChip={partChip}
            labelOf={id => questionNumbers?.[id] || ''}
            prepFor={(pid, sid) => (prepFor ? prepFor(pid, sid) : [])}
            onClose={() => setMarkParams({ mark: null, mq: null, mpart: null })}
            renderPart={(pid, b, { showName, prep } = {}) => (
              <BlockAnswer
                split
                block={b}
                entry={(answers[pid] || {})[b.id]}
                participantId={pid}
                showNotes={false}
                answerKey={answerKey}
                answerPoints={answerPoints}
                questionNumber={questionNumbers ? questionNumbers[b.id] : null}
                answerModes={answerModes}
                markForBlock={marksOf(pid)[b.id] || null}
                onMark={onMark}
                onComment={onComment}
                guidanceForBlock={guidance ? guidance[b.id] : null}
                onBreakdown={onBreakdown}
                marking={markingIds ? markingIds.has(`${pid}:${b.id}`) : false}
                who={showName ? nameOf(pid) : null}
                prepValues={(prep || (prepFor ? prepFor(pid, b.section_id) : [])).map(i => i.content)}
              />
            )}
          />
        );
      })()}

      {focusId && !marking && (() => {
        const idx = sorted.findIndex(x => x.participant.id === focusId);
        if (idx === -1) return null;   // filtered out from under us
        const s = sorted[idx];
        return (
          <ParticipantFocus
            stat={s}
            position={`${idx + 1} of ${sorted.length}`}
            sectionTitle={selectedSection?.title}
            onPrev={idx > 0 ? () => setFocusId(sorted[idx - 1].participant.id) : null}
            onNext={idx < sorted.length - 1 ? () => setFocusId(sorted[idx + 1].participant.id) : null}
            onClose={() => setFocusId(null)}
            blocks={fillableInSection}
            answersForP={answers[s.participant.id] || {}}
            notesForP={notes[s.participant.id] || {}}
            reviewMarks={reviewMarks}
            sectionNote={participantNotes[s.participant.id]?.[selectedSection.id]?.note || ''}
            prepItems={itemsForExercise(prepBy[s.participant.id]?.[selectedSection.id]?.content, standaloneBy[s.participant.id], prepLayout, selectedSection.id)}
            onSaveNote={onSaveNote}
            onDeleteNote={onDeleteNote}
            showNotes={showNotes}
            answerKey={answerKey}
            answerPoints={answerPoints}
            questionNumbers={questionNumbers}
            answerModes={answerModes}
            marksForP={marks ? (marks[s.participant.id] || {}) : null}
            onMark={onMark}
            onComment={onComment}
            hands={hands}
            guidance={guidance}
            onBreakdown={onBreakdown}
            markingIds={markingIds}
          />
        );
      })()}

      {popover && (() => {
        const here = liveBySection[popover.sectionId] || [];
        if (here.length === 0) return null; // everyone left → nothing to show
        return createPortal(
          <div
            ref={popoverRef}
            className={`live-here-popover ${popover.pinned ? 'pinned' : ''}`}
            style={{ left: popover.x, top: popover.y }}
          >
            <div className="live-here-popover-head">
              <span>On this exercise now</span>
              {popover.pinned && (
                <button type="button" className="live-here-popover-close" onClick={() => setPopover(null)} aria-label="Close">×</button>
              )}
            </div>
            <ul>
              {here.map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="live-here-name"
                    onClick={() => drillTo(popover.sectionId, p.id)}
                    title="Show this participant's answer for this exercise"
                  >
                    <span className="presence-dot live" /> {p.full_name || '(unnamed)'}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}
