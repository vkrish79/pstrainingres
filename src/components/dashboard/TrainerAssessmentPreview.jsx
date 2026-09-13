import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SkeletonLines } from '../Skeleton.jsx';
import { supabase } from '../../lib/supabase.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import Block from '../blocks/Block.jsx';
import WithdrawQuestion from '../WithdrawQuestion.jsx';
import { buildQuestions } from '../../lib/assessmentStructure.js';
import { isWithdrawn, withdrawalOf, setQuestionWithdrawn } from '../../lib/questionWithdrawal.js';

// The session's copy of the assessment, as the trainer sees it — and can WORK.
//
// The questions are live: the same Block components the participant answers on,
// so a trainer can demonstrate the paper on the projector — type in a field,
// drag the cards, match the pairs — before the room starts. Answers are held in
// this component and nowhere else: nothing is written, nothing is scored, and
// no participant sees them. Clearing is one button.
//
// This is also where a question is WITHDRAWN. That is a session act by design: a trainer
// decides mid-course that a question is not working for the cohort in front of
// them, and takes it out for that cohort only. The master keeps it for every
// other session.
//
// Backed by 20260910000000_session_assessment_withdrawal.sql, which grants the
// session trainer their first write on assessment_blocks — config only, with a
// trigger refusing anything structural, and every change logged so it appears
// in Session changes.
export default function TrainerAssessmentPreview({ assessmentId }) {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assessment, setAssessment] = useState(null);
  const [sections, setSections] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [busyId, setBusyId] = useState(null);
  // The demonstration's own answers. Deliberately component state: a preview
  // that wrote to assessment_answers would put the trainer's demo in the
  // cohort's results.
  const [demo, setDemo] = useState({});
  const [rowError, setRowError] = useState({});

  const load = useCallback(async () => {
    if (!assessmentId) { setLoading(false); return; }
    setLoading(true);
    setError('');
    const [{ data: ass, error: e1 }, { data: secs, error: e2 }] = await Promise.all([
      supabase.from('assessments').select('id, title, description').eq('id', assessmentId).single(),
      supabase.from('assessment_sections').select('*').eq('assessment_id', assessmentId).order('order_index'),
    ]);
    if (e1 || e2) { setError((e1 || e2).message); setLoading(false); return; }
    const sectionIds = (secs || []).map(s => s.id);
    const { data: blks, error: e3 } = sectionIds.length
      ? await supabase.from('assessment_blocks').select('*').in('section_id', sectionIds).order('order_index')
      : { data: [], error: null };
    if (e3) { setError(e3.message); setLoading(false); return; }
    setAssessment(ass);
    setSections(secs || []);
    setBlocks(blks || []);
    setLoading(false);
  }, [assessmentId]);

  useEffect(() => { load(); }, [load]);

  // Withdrawn questions stay in this list — a trainer must be able to see what
  // they took out and put it back. Only the participant's copy loses them.
  //
  // Computed here rather than after the early returns below, because the nav
  // needs it and hooks cannot live under a conditional return.
  const { questions, partLabelByBlockId } = useMemo(
    () => buildQuestions(sections, blocks),
    [sections, blocks],
  );

  // Which question the trainer is looking at, for the rail's highlight.
  //
  // Observed rather than set on click: a paper this long is mostly navigated by
  // SCROLLING, and a rail that only updates when you click it starts lying the
  // moment you touch the wheel. -45% at the bottom means "the question crossing
  // the upper half of the screen", which is the one being read.
  const [activeId, setActiveId] = useState(null);
  const paperRef = useRef(null);
  useEffect(() => {
    if (loading || !questions.length) return undefined;
    const seen = new Map();
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) seen.set(e.target.dataset.sectionId, e.isIntersecting);
        const first = questions.find(q => seen.get(q.section.id));
        if (first) setActiveId(first.section.id);
      },
      { rootMargin: '-80px 0px -45% 0px', threshold: 0 },
    );
    const nodes = paperRef.current?.querySelectorAll('[data-section-id]') || [];
    nodes.forEach(n => io.observe(n));
    return () => io.disconnect();
  }, [loading, questions]);

  // Keep the highlighted question visible IN THE RAIL. On a 27-question paper
  // the rail has its own scrollbar, so tracking the page scroll is only half
  // the job — the highlight lands on a row nobody can see, and the rail looks
  // like it has stopped following.
  //
  // Nudges rail.scrollTop by hand rather than calling scrollIntoView, which
  // would also scroll the PAGE and fight the scroll that got us here.
  const railRef = useRef(null);
  useEffect(() => {
    if (!activeId) return;
    const rail = railRef.current;
    const item = rail?.querySelector(`[data-nav-id="${activeId}"]`);
    if (!rail || !item) return;
    const r = rail.getBoundingClientRect();
    const i = item.getBoundingClientRect();
    if (i.top < r.top + 8) rail.scrollTop -= (r.top + 8 - i.top);
    else if (i.bottom > r.bottom - 8) rail.scrollTop += (i.bottom - (r.bottom - 8));
  }, [activeId]);

  function jumpTo(sectionId) {
    const el = paperRef.current?.querySelector(`[data-section-id="${sectionId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(sectionId);
  }

  async function apply(sectionId, questionBlocks, withdrawn, reason) {
    setBusyId(sectionId);
    setRowError(prev => ({ ...prev, [sectionId]: null }));
    const res = await setQuestionWithdrawn(questionBlocks, {
      withdrawn,
      reason,
      actor: { name: profile?.full_name || null },
    });
    setBusyId(null);
    if (res.error) {
      setRowError(prev => ({ ...prev, [sectionId]: res.error.message || String(res.error) }));
      return res;
    }
    await load();
    return {};
  }

  if (!assessmentId) {
    return <div className="muted" style={{ padding: '1rem' }}>This session has no attached assessment.</div>;
  }
  if (loading) return <SkeletonLines rows={6} label="Loading assessment…" />;
  if (error) return <div className="error" style={{ padding: '1rem' }}>{error}</div>;
  if (!assessment) return <div className="muted" style={{ padding: '1rem' }}>Assessment unavailable.</div>;

  const withdrawnCount = questions.filter(
    q => q.blocks.length > 0 && q.blocks.every(isWithdrawn),
  ).length;

  return (
    <div className="trainer-assessment-preview">
      <header className="trainer-assessment-preview-head">
        <h2 style={{ margin: 0 }}>{assessment.title}</h2>
        {assessment.description && <p className="muted" style={{ marginTop: '0.25rem' }}>{assessment.description}</p>}
        <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
          This session's copy. You can withdraw a question from this cohort — it stays in the
          master for every other session, and what you withdraw is recorded in Session changes.
        </p>
      </header>

      {/* The same two-column shape as the workbook's exercise list, using its
          classes rather than a second set that drifts from them. */}
      <div className="exresp-layout">
        <aside className="exresp-sidebar tap-nav" ref={railRef}>
          <div className="exresp-sidebar-head">
            Questions
            <span className="tap-nav-count">{questions.length}</span>
          </div>
          <ul className="exresp-sidebar-list">
            {questions.map(q => {
              const withdrawn = q.blocks.length > 0 && q.blocks.every(isWithdrawn);
              return (
                <li key={q.section.id}>
                  <button
                    type="button"
                    className={`exresp-sidebar-item ${activeId === q.section.id ? 'active' : ''}`}
                    data-nav-id={q.section.id}
                    onClick={() => jumpTo(q.section.id)}
                    aria-current={activeId === q.section.id ? 'true' : undefined}
                  >
                    <div className="exresp-sidebar-row">
                      <span className={`exresp-sidebar-title ${withdrawn ? 'tap-nav-withdrawn' : ''}`}>
                        {q.heading}
                      </span>
                      {/* Withdrawn is the one thing about a question that a
                          trainer needs to see WITHOUT scrolling to it — it is
                          what they changed for this cohort. */}
                      {withdrawn && <span className="tap-nav-tag">Withdrawn</span>}
                    </div>
                    {q.partCount > 1 && (
                      <span className="tap-nav-parts">{q.partCount} parts</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="tap-nav-foot">
            {withdrawnCount > 0 && (
              <p className="tap-nav-foot-note">
                {withdrawnCount} withdrawn from this cohort
              </p>
            )}
            {/* The demo answers are the trainer's, held in this component and
                written nowhere — so the way to clear them belongs beside the
                navigation, not in a banner over the paper. */}
            <button
              type="button"
              className="ghost btn-sm"
              onClick={() => setDemo({})}
              disabled={Object.keys(demo).length === 0}
            >
              Clear answers
            </button>
          </div>
        </aside>

        {/* The rail is hidden under 800px by .exresp-sidebar, exactly as the
            workbook's is, so a narrow screen needs its own way to jump. */}
        <div className="exresp-mobile-nav">
          <select
            className="form-input"
            value={activeId || ''}
            onChange={e => jumpTo(e.target.value)}
            aria-label="Jump to a question"
          >
            <option value="" disabled>Jump to a question…</option>
            {questions.map(q => (
              <option key={q.section.id} value={q.section.id}>{q.heading}</option>
            ))}
          </select>
        </div>

        <div className="exresp-main" ref={paperRef}>
      {questions.map(q => {
        const qBlocks = q.blocks;
        const withdrawn = qBlocks.length > 0 && qBlocks.every(isWithdrawn);
        return (
          <section
            key={q.section.id}
            className={`wb-section wb-question ${withdrawn ? 'wb-question-withdrawn' : ''}`}
            data-section-id={q.section.id}
          >
            <div className="question-number">
              {q.heading}
              {q.partCount > 1 && <span className="question-parts-count">{q.partCount} parts</span>}
              <span className="question-withdraw-slot">
                {qBlocks.length > 0 && (
                  <WithdrawQuestion
                    withdrawn={withdrawn}
                    withdrawal={withdrawalOf(qBlocks)}
                    busy={busyId === q.section.id}
                    error={rowError[q.section.id]}
                    onWithdraw={reason => apply(q.section.id, qBlocks, true, reason)}
                    onRestore={() => apply(q.section.id, qBlocks, false, null)}
                  />
                )}
              </span>
            </div>
            {qBlocks.map(b => (
              <div key={b.id} className="wb-question-block">
                {partLabelByBlockId[b.id] && (
                  <div className="wb-part-label">{partLabelByBlockId[b.id]}</div>
                )}
                {/* A withdrawn question is out of the paper, so it cannot be
                    demonstrated either — it stays visible but inert. */}
                <Block
                  block={b}
                  value={demo[b.id]}
                  onChange={v => setDemo(prev => ({ ...prev, [b.id]: v }))}
                  readOnly={withdrawn}
                />
              </div>
            ))}
          </section>
        );
      })}
        </div>
      </div>
    </div>
  );
}
