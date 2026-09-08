import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useParticipantAssessment } from '../hooks/useParticipantAssessment.js';
import { useParticipantAssessmentPrep } from '../hooks/useParticipantAssessmentPrep.js';
import { isAnswered } from '../lib/blockHelpers.js';
import { buildQuestions } from '../lib/assessmentStructure.js';
import { isInactiveBlock } from '../lib/assessmentScoring.js';
import Block from '../components/blocks/Block.jsx';
import AssessmentQuestionNav from '../components/participant/AssessmentQuestionNav.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/workbook.css';

export default function ParticipantAssessmentPage() {
  const { session: authSession } = useAuth();
  const [searchParams] = useSearchParams();
  const sessionIdParam = searchParams.get('session');
  const {
    loading, error, session, assessment, sections, blocks, answers, savingMap, saveAnswer, recentlyUpdated,
  } = useParticipantAssessment(authSession?.user.id, sessionIdParam);
  const { prep: sectionPrep, standalone: standalonePrep } = useParticipantAssessmentPrep(
    session?.id, authSession?.user.id, session?.assessment_id
  );

  // A question is a section: its prose is narration, its fillable blocks are
  // the lettered parts. See lib/assessmentStructure.js.
  //
  // Withdrawn questions never reach a participant — the read policy filters
  // them out server-side (20260909000000_manual_marking.sql). Filtering again
  // here is belt-and-braces against any path that loads blocks differently.
  const liveBlocks = useMemo(() => blocks.filter(b => !isInactiveBlock(b)), [blocks]);
  const { questions: qList, partLabelByBlockId } = useMemo(
    () => buildQuestions(sections, liveBlocks),
    [sections, liveBlocks]
  );

  // Per-question progress for the navigation sidebar — parts answered out of
  // parts total, so a half-finished scenario reads as half-finished.
  const qProgress = useMemo(() => {
    const out = {};
    for (const q of qList) {
      const total = q.parts.length;
      const answered = q.parts.filter(p => isAnswered(p.block, answers[p.block.id])).length;
      out[q.section.id] = { answered, total, pct: total ? Math.round((answered / total) * 100) : 0 };
    }
    return out;
  }, [qList, answers]);

  // Session-wide timer. assessment_deadline_at is null when the assessment was
  // unlocked untimed. Tick once a second until the deadline passes, then freeze:
  // inputs go read-only (RLS also rejects late writes) but answers stay visible.
  const deadlineMs = session?.assessment_deadline_at
    ? new Date(session.assessment_deadline_at).getTime()
    : null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const expired = deadlineMs != null && nowMs >= deadlineMs;
  useEffect(() => {
    if (deadlineMs == null) return;
    setNowMs(Date.now());
    if (Date.now() >= deadlineMs) return; // already past — no need to tick
    const id = setInterval(() => {
      setNowMs(prev => {
        const t = Date.now();
        if (t >= deadlineMs) clearInterval(id);
        return t;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [deadlineMs]);

  const remainingLabel = useMemo(() => {
    if (deadlineMs == null) return null;
    const ms = Math.max(0, deadlineMs - nowMs);
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }, [deadlineMs, nowMs]);

  const overallStatus = useMemo(() => {
    const statuses = Object.values(savingMap);
    if (statuses.includes('saving')) return 'saving';
    if (statuses.includes('error')) return 'error';
    if (statuses.length) return 'saved';
    return null;
  }, [savingMap]);

  if (loading) return <><TopBar /><div className="loading">Loading assessment…</div></>;
  if (error) {
    return (
      <>
        <TopBar />
        <main className="page">
          <section className="page-hero compact">
            <div className="page-hero-text">
              <h1>Assessment</h1>
              <p>{error}</p>
            </div>
          </section>
        </main>
      </>
    );
  }
  if (!session?.assessment_id) {
    return (
      <>
        <TopBar />
        <main className="page">
          <section className="page-hero compact">
            <div className="page-hero-text">
              <Link to="/workbook" className="back-link">&larr; Back to workbook</Link>
              <h1>Assessment</h1>
              <p>This session does not include an assessment.</p>
            </div>
          </section>
        </main>
      </>
    );
  }
  if (!session?.assessment_unlocked_at) {
    return (
      <>
        <TopBar />
        <main className="page">
          <section className="page-hero compact">
            <div className="page-hero-text">
              <Link to="/workbook" className="back-link">&larr; Back to workbook</Link>
              <h1>🔒 Assessment locked</h1>
              <p>Your trainer hasn't unlocked the assessment yet. Check back when they're ready.</p>
            </div>
          </section>
          {(Object.keys(sectionPrep).length > 0 || standalonePrep.length > 0) && (
            <section className="assessment-prep-panel">
              <h3 className="materials-list-title">🎯 Your assessment prep</h3>
              {standalonePrep.map(s => (
                <div key={s.id} className="participant-prep-callout">
                  <span className="participant-prep-callout-label">{s.label}</span>
                  {s.content}
                </div>
              ))}
            </section>
          )}
        </main>
      </>
    );
  }
  if (!assessment) {
    return (
      <>
        <TopBar />
        <main className="page">
          <section className="page-hero compact">
            <div className="page-hero-text">
              <Link to="/workbook" className="back-link">&larr; Back to workbook</Link>
              <h1>Assessment</h1>
              <p>Loading…</p>
            </div>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <main className="page workbook">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/workbook" className="back-link">&larr; Back to workbook</Link>
            <h1>
              {assessment.title}
              {session?.city_code && <span className="city-tag inline">{session.city_code}</span>}
            </h1>
            <p>{session?.name}</p>
            {assessment.description && <p className="muted">{assessment.description}</p>}
          </div>
          <div className="page-hero-actions">
            {remainingLabel != null && (
              <span className={`assessment-timer ${expired ? 'expired' : nowMs > deadlineMs - 60000 ? 'warning' : ''}`}>
                {expired ? '⏱ Time’s up — view only' : `⏱ ${remainingLabel}`}
              </span>
            )}
            {!expired && overallStatus && (
              <span className={`wb-save-indicator ${overallStatus}`}>
                {overallStatus === 'saving' ? 'Saving…' : overallStatus === 'error' ? 'Save failed' : 'All changes saved'}
              </span>
            )}
          </div>
        </section>

        {standalonePrep.length > 0 && (
          <section className="assessment-prep-panel">
            <h3 className="materials-list-title">🎯 Your assessment prep</h3>
            {standalonePrep.map(s => (
              <div key={s.id} className="participant-prep-callout">
                <span className="participant-prep-callout-label">{s.label}</span>
                {s.content}
              </div>
            ))}
          </section>
        )}

        {/* Any trainer pre-work callouts (formerly per-section) surface once at the top. */}
        {sections.map(sec => sectionPrep[sec.id]?.content && (
          <div key={sec.id} className="participant-prep-callout">
            <span className="participant-prep-callout-label">Pre-work from your trainer</span>
            {sectionPrep[sec.id].content}
          </div>
        ))}

        <div className="assessment-body">
          <AssessmentQuestionNav questions={qList} progress={qProgress} />
          <div className="assessment-questions">
            {qList.map(q => (
              <section key={q.section.id} className="wb-section wb-question" data-section-id={q.section.id}>
                <div className="question-number">
                  {q.heading}
                  {q.partCount > 1 && (
                    <span className="question-parts-count">{q.partCount} parts</span>
                  )}
                </div>
                {/* A withdrawn question arrives with none of its blocks — the read
                    policy withholds them. The question itself still comes through,
                    so rather than leave an unexplained gap between Question 3 and
                    Question 5, say what happened. The trainer's internal reason is
                    NOT shown here; only that it was withdrawn. */}
                {q.blocks.length === 0 && (
                  <p className="question-withdrawn-note">
                    Withdrawn by your trainer — you don't need to answer this one, and it
                    doesn't count towards your marks.
                  </p>
                )}
                {q.blocks.map(b => (
                  <div key={b.id} className="wb-question-block" data-block-id={b.id}>
                    {partLabelByBlockId[b.id] && (
                      <div className="wb-part-label">{partLabelByBlockId[b.id]}</div>
                    )}
                    <Block
                      block={b}
                      value={answers[b.id]}
                      onChange={v => saveAnswer(b.id, v)}
                      readOnly={expired}
                      recentlyUpdated={!!recentlyUpdated[b.id]}
                    />
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
