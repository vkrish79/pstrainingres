import { useMemo, useState } from 'react';
import { useTrainerPractice } from '../../hooks/useTrainerPractice.js';
import { isFillableBlock, isAnswered } from '../../lib/blockHelpers.js';
import Block from '../blocks/Block.jsx';
import '../../styles/workbook.css';

const ALL_KEY = '__all__';

// Tab body: trainer's private fillable copy of the session workbook.
// Answers persist in localStorage only — see useTrainerPractice for details.
export default function TrainerPracticeView({ sessionId, trainerId }) {
  const {
    loading, error, sections, blocks, answers, saveAnswer, resetAnswers,
  } = useTrainerPractice(sessionId, trainerId);

  const [selectedSectionId, setSelectedSectionId] = useState(ALL_KEY);
  const [confirmReset, setConfirmReset] = useState(false);

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
          <strong>Trainer practice copy.</strong> Answers are saved on this device only.
          Participants don't see them; they don't appear in cohort progress or CSV exports.
        </div>
        <div className="practice-banner-actions">
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
    </div>
  );
}
