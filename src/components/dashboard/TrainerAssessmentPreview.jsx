import { useCallback, useEffect, useState } from 'react';
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
  if (loading) return <div className="loading">Loading assessment…</div>;
  if (error) return <div className="error" style={{ padding: '1rem' }}>{error}</div>;
  if (!assessment) return <div className="muted" style={{ padding: '1rem' }}>Assessment unavailable.</div>;

  // Withdrawn questions stay in this list — a trainer must be able to see what
  // they took out and put it back. Only the participant's copy loses them.
  const { questions, partLabelByBlockId } = buildQuestions(sections, blocks);

  return (
    <div className="trainer-assessment-preview">
      <header className="trainer-assessment-preview-head">
        <h2 style={{ margin: 0 }}>{assessment.title}</h2>
        {assessment.description && <p className="muted" style={{ marginTop: '0.25rem' }}>{assessment.description}</p>}
        <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
          This session's copy. You can withdraw a question from this cohort — it stays in the
          master for every other session, and what you withdraw is recorded in Session changes.
        </p>
        <div className="preview-demo-note">
          <span>
            <strong>Try it as a participant would.</strong> Type, drag and match to demonstrate the
            paper — nothing here is saved, scored, or seen by anyone.
          </span>
          <button
            type="button"
            className="ghost btn-sm"
            onClick={() => setDemo({})}
            disabled={Object.keys(demo).length === 0}
          >
            Clear answers
          </button>
        </div>
      </header>

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
  );
}
