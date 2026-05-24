import { useEffect, useMemo, useState } from 'react';
import { useTrainerPractice } from '../../hooks/useTrainerPractice.js';
import { useTrainerPrep } from '../../hooks/useTrainerPrep.js';
import { isFillableBlock, isAnswered } from '../../lib/blockHelpers.js';
import Block from '../blocks/Block.jsx';
import PrepDrawer from '../participant/PrepDrawer.jsx';
import MonitorDrawer from './MonitorDrawer.jsx';
import '../../styles/workbook.css';

const ALL_KEY = '__all__';

const DRAW_MSG = {
  allocated: (n) => `Drew practice prep (${n} item${n === 1 ? '' : 's'}).`,
  exists: () => 'You already have practice prep for this session.',
  exhausted: () => 'Prep pool is empty — ask for a top-up, then try again.',
  none: () => 'No prep is set up for this workbook.',
};

// Tab body: the session's trainer-facing fillable copy of the workbook.
// Answers persist server-side, scoped to the session — see useTrainerPractice.
// The trainer can draw one prep kit from the pool (useTrainerPrep) so prep-
// dependent exercises have real values to practise with, mirroring participants.
export default function TrainerPracticeView({
  sessionId, trainerId, prepEnabled = false,
  participants = [], participantAnswers = {}, liveBySection = {},
}) {
  const {
    loading, error, sections, blocks, answers, saveAnswer, resetAnswers,
  } = useTrainerPractice(sessionId, trainerId);
  const { prep, standalone, hasPrep, drawPrep } = useTrainerPrep(sessionId);

  const [selectedSectionId, setSelectedSectionId] = useState(ALL_KEY);
  const [confirmReset, setConfirmReset] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [drawMsg, setDrawMsg] = useState('');
  const [prepOpen, setPrepOpen] = useState(false);
  const [monitorOpen, setMonitorOpen] = useState(false);

  // Prep and Monitor are both right push-drawers; keep at most one open.
  function openPrep() { setMonitorOpen(false); setPrepOpen(true); }
  function openMonitor() { setPrepOpen(false); setMonitorOpen(true); }

  // Push the page canvas left while a right drawer is open (no overlay); the
  // fixed drawer fills the gap. Mirrors the participant workbook view. One body
  // class each — mutual exclusivity (open*/) keeps them from stacking.
  useEffect(() => {
    document.body.classList.toggle('prep-drawer-pushed', prepOpen);
    document.body.classList.toggle('monitor-drawer-pushed', monitorOpen);
    return () => {
      document.body.classList.remove('prep-drawer-pushed');
      document.body.classList.remove('monitor-drawer-pushed');
    };
  }, [prepOpen, monitorOpen]);

  // Esc closes whichever drawer is open.
  useEffect(() => {
    if (!prepOpen && !monitorOpen) return undefined;
    function onKey(e) { if (e.key === 'Escape') { setPrepOpen(false); setMonitorOpen(false); } }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prepOpen, monitorOpen]);

  async function handleDrawPrep() {
    setDrawing(true);
    setDrawMsg('');
    const { data, error: err } = await drawPrep();
    setDrawing(false);
    if (err) { setDrawMsg(err.message); return; }
    const status = data?.status || 'none';
    setDrawMsg((DRAW_MSG[status] || DRAW_MSG.none)(data?.prepped || 0));
  }

  // Total participants online anywhere (each is on exactly one section), for
  // the Monitor button's live hint.
  const onlineTotal = useMemo(
    () => Object.values(liveBySection).reduce((n, arr) => n + (arr?.length || 0), 0),
    [liveBySection],
  );

  const sectionStats = useMemo(() => {
    return sections.map(sec => {
      const sBlocks = blocks.filter(b => b.section_id === sec.id);
      const fillable = sBlocks.filter(isFillableBlock);
      const answered = fillable.reduce((n, b) => n + (isAnswered(b, answers[b.id]) ? 1 : 0), 0);
      const pct = fillable.length ? Math.round((answered / fillable.length) * 100) : 0;
      return { id: sec.id, title: sec.title, total: fillable.length, answered, pct };
    });
  }, [sections, blocks, answers]);

  if (loading) return <div className="loading">Loading practice copy…</div>;
  if (error) return <p className="error">{error}</p>;

  const visibleSections = selectedSectionId === ALL_KEY
    ? sections
    : sections.filter(s => s.id === selectedSectionId);

  return (
    <div>
      <div className="practice-banner">
        <div>
          <strong>Trainer practice copy.</strong> Saved to this session — if the trainer is
          changed, the new trainer resumes this progress. Participants don't see it; it
          doesn't appear in cohort progress or CSV exports.
        </div>
        <div className="practice-banner-actions">
          {prepEnabled && !hasPrep && (
            <button className="ghost" onClick={handleDrawPrep} disabled={drawing}>
              {drawing ? 'Drawing…' : '🎯 Draw practice prep'}
            </button>
          )}
          {hasPrep && (
            <button className="ghost" onClick={openPrep}>🎯 Prep</button>
          )}
          <button className={`ghost ${monitorOpen ? 'active' : ''}`} onClick={openMonitor}>
            👁 Monitor{onlineTotal > 0 ? ` (${onlineTotal})` : ''}
          </button>
          {confirmReset ? (
            <>
              <span className="confirm-text">Clear all your practice answers?</span>
              <button className="danger" onClick={() => { resetAnswers(); setConfirmReset(false); }}>Yes, clear</button>
              <button className="ghost" onClick={() => setConfirmReset(false)}>No</button>
            </>
          ) : (
            <button className="ghost" onClick={() => setConfirmReset(true)}>↺ Reset</button>
          )}
        </div>
      </div>
      {drawMsg && <p className="prep-notice">{drawMsg}</p>}

      <div className="exresp-layout">
        <div className="exresp-mobile-nav">
          <select
            className="form-input"
            value={selectedSectionId}
            onChange={e => setSelectedSectionId(e.target.value)}
          >
            <option value={ALL_KEY}>All exercises</option>
            {sectionStats.map(s => (
              <option key={s.id} value={s.id}>
                {s.title} — {s.pct}%
              </option>
            ))}
          </select>
        </div>

        <aside className="exresp-sidebar">
          <div className="exresp-sidebar-head">Exercises</div>
          <ul className="exresp-sidebar-list">
            <li>
              <button
                className={`exresp-sidebar-item ${selectedSectionId === ALL_KEY ? 'active' : ''}`}
                onClick={() => setSelectedSectionId(ALL_KEY)}
              >
                <div className="exresp-sidebar-row">
                  <span className="exresp-sidebar-title">All exercises</span>
                </div>
              </button>
            </li>
            {sectionStats.map(s => {
              const barClass = s.pct === 0 ? 'none' : s.pct === 100 ? 'full' : 'partial';
              const isActive = selectedSectionId === s.id;
              return (
                <li key={s.id}>
                  <button
                    className={`exresp-sidebar-item ${isActive ? 'active' : ''}`}
                    onClick={() => setSelectedSectionId(s.id)}
                  >
                    <div className="exresp-sidebar-row">
                      <span className="exresp-sidebar-title">{s.title}</span>
                      <span className="exresp-sidebar-pct">{s.pct}%</span>
                    </div>
                    <div className={`exresp-sidebar-bar ${barClass}`}>
                      <div className="exresp-sidebar-bar-fill" style={{ width: `${s.pct}%` }} />
                    </div>
                    <div className="exresp-sidebar-meta">{s.answered}/{s.total} answered</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="exresp-main">
          {visibleSections.map(sec => (
            <section key={sec.id} className="wb-section">
              <h2>{sec.title}</h2>
              {prep[sec.id]?.content && (
                <div className="participant-prep-callout">
                  <span className="participant-prep-callout-label">Prep</span>
                  {prep[sec.id].content}
                </div>
              )}
              {blocks
                .filter(b => b.section_id === sec.id)
                .map(b => (
                  <Block
                    key={b.id}
                    block={b}
                    value={answers[b.id]}
                    onChange={v => saveAnswer(b.id, v)}
                  />
                ))}
            </section>
          ))}
        </div>
      </div>

      <PrepDrawer
        open={prepOpen}
        onClose={() => setPrepOpen(false)}
        sections={sections}
        prep={prep}
        standalone={standalone}
      />
      <MonitorDrawer
        open={monitorOpen}
        onClose={() => setMonitorOpen(false)}
        section={selectedSectionId === ALL_KEY ? null : sections.find(s => s.id === selectedSectionId) || null}
        blocks={blocks}
        participants={participants}
        participantAnswers={participantAnswers}
        liveHere={liveBySection[selectedSectionId] || []}
      />
    </div>
  );
}
