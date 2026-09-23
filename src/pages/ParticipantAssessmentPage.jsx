import { useEffect, useMemo, useRef, useState } from 'react';
import { SkeletonPage } from '../components/Skeleton.jsx';
import { useCountdown } from '../lib/assessmentTimer.js';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useParticipantAssessment } from '../hooks/useParticipantAssessment.js';
import { useHelpRequests } from '../hooks/useHelpRequests.js';
import { useParticipantAssessmentPrep } from '../hooks/useParticipantAssessmentPrep.js';
import { isAnswered } from '../lib/blockHelpers.js';
import { buildQuestions } from '../lib/assessmentStructure.js';
import { buildPaper, paperProgress } from '../lib/assessmentPaper.js';
import { isInactiveBlock } from '../lib/assessmentScoring.js';
import Block from '../components/blocks/Block.jsx';
import AssessmentQuestionNav from '../components/participant/AssessmentQuestionNav.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/workbook.css';
import '../styles/workbook-rail.css';
import '../styles/assessment-exam.css';

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
  // unlocked untimed. Once the deadline passes, inputs go read-only (RLS also
  // rejects late writes) but answers stay visible.
  //
  // The countdown comes from the SHARED hook, which measures the offset between
  // this browser's clock and the server's. That matters most here: the deadline
  // is stamped by the database, so a participant whose machine runs fast used to
  // see the assessment expire while the server was still accepting answers, and
  // one running slow saw time remaining after it had stopped.
  const { label: remainingLabel, expired, urgent } = useCountdown(session?.assessment_deadline_at);

  const overallStatus = useMemo(() => {
    const statuses = Object.values(savingMap);
    if (statuses.includes('saving')) return 'saving';
    if (statuses.includes('error')) return 'error';
    if (statuses.length) return 'saved';
    return null;
  }, [savingMap]);

  // Exam mode: a start screen, one question per page, a review. See
  // lib/assessmentPaper.js for what counts as a question.
  const paper = useMemo(() => buildPaper(qList), [qList]);
  const overall = useMemo(() => paperProgress(paper.pages, qProgress), [paper, qProgress]);
  const unfinished = useMemo(
    () => paper.pages.filter(p => !p.withdrawn && qProgress[p.id] && qProgress[p.id].answered < qProgress[p.id].total),
    [paper, qProgress],
  );

  // Where to open: someone who has started goes to their first unfinished
  // question; someone who has not sees the start screen (if the paper has one).
  const [current, setCurrent] = useState(null);
  useEffect(() => {
    if (current !== null || loading || !assessment) return;
    const started = Object.values(qProgress).some(p => p.answered > 0);
    if (!started) { setCurrent(paper.start.length || !paper.pages.length ? 'start' : 0); return; }
    const first = paper.pages.find(p => !p.withdrawn && qProgress[p.id]?.answered < qProgress[p.id]?.total);
    setCurrent(first ? first.index : 'review');
  }, [current, loading, assessment, paper, qProgress]);

  const mainRef = useRef(null);
  function goTo(where) {
    setCurrent(where);
    // Bring the top of the new page into view, below the sticky bars.
    requestAnimationFrame(() => {
      const el = mainRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - 140;
      if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    });
  }
  const page = typeof current === 'number' ? paper.pages[current] || null : null;

  // Calling the trainer during the paper.
  //
  // Same table and same RPCs as the workbook's "Ask for help" — section_id has
  // no foreign key and both of help_raise's location arguments are optional, so
  // an assessment question's id goes in the same field with no schema change.
  //
  // Two rules differ from the workbook, and both are deliberate:
  //   • the wording. "Ask for help" invites a conversation that cannot happen
  //     mid-paper; "Call the trainer" asks someone to come without promising an
  //     answer to the question being marked.
  //   • it NEVER lowers itself. The workbook drops a hand when someone moves to
  //     a later exercise, a fair guess they sorted it out. Moving to question 4
  //     says nothing about the problem with question 3.
  const help = useHelpRequests(session?.id, { mine: true, selfId: authSession?.user.id });
  const handUp = help.mineOpen;
  const [helpBusy, setHelpBusy] = useState(false);
  const [helpError, setHelpError] = useState('');

  async function toggleHelp() {
    setHelpBusy(true);
    setHelpError('');
    // Where they are, in the trainer's words. A hand raised on the start or
    // review screen has no question to name, so it says so rather than
    // inventing one.
    const where = typeof current === 'number'
      ? `Assessment · Q${current + 1}`
      : 'Assessment';
    const { error: e } = handUp
      ? await help.lower('cancelled')
      : await help.raise(page?.id || null, where);
    setHelpBusy(false);
    if (e) setHelpError(e.message);
  }

  if (loading) return <><TopBar /><SkeletonPage body="lines" rows={6} label="Loading assessment…" /></>;
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

  const timerTone = expired ? 'is-expired' : urgent ? 'is-urgent' : '';

  return (
    <>
      <TopBar />
      <main className="page workbook exam">
        {/* The exam bar: always in view, so the clock and "saved" never scroll away. */}
        <section className="exam-bar" aria-label="Assessment">
          <div className="exam-bar-text">
            <Link to="/workbook" className="exam-bar-back">← Workbook</Link>
            <h1>
              {assessment.title}
              {session?.city_code && <span className="city-tag inline">{session.city_code}</span>}
            </h1>
            <p className="exam-bar-meta">
              <span>{overall.answered} of {overall.total} answered</span>
              {!expired && overallStatus && (
                <span className={`exam-bar-save is-${overallStatus}`}>
                  {overallStatus === 'saving' ? 'Saving…' : overallStatus === 'error' ? 'Save failed — check your connection' : '✓ Saved'}
                </span>
              )}
            </p>
          </div>
          {/* Only once the paper is open: before that the assessment is locked
              and this page never renders the exam bar at all. */}
          <button
            type="button"
            className={`exam-hand${handUp ? ' is-up' : ''}`}
            onClick={toggleHelp}
            disabled={helpBusy || !session?.id}
            aria-pressed={!!handUp}
            data-tip={handUp
              ? 'Put your hand down'
              : 'Ask your trainer to come over — only they will see it'}
          >
            {handUp ? '✋ Hand up · Cancel' : '✋ Call the trainer'}
          </button>

          <div className={`exam-bar-clock ${timerTone}`} role="timer" aria-live="off">
            {remainingLabel == null ? (
              <span className="exam-bar-clock-note">No time limit</span>
            ) : expired ? (
              <span className="exam-bar-clock-note">Time’s up — view only</span>
            ) : (
              <>
                <span className="exam-bar-clock-time">{remainingLabel}</span>
                <span className="exam-bar-clock-note">left</span>
              </>
            )}
          </div>
        </section>

        {helpError && <p className="exam-hand-error" role="alert">{helpError}</p>}
        {handUp?.acknowledged_at && (
          <p className="exam-hand-banner">
            👋 {handUp.acknowledged_by_name || 'Your trainer'} is coming over.
            {/* The clock is deliberately not touched. If waiting cost them
                time, the trainer extends the deadline themselves — a hand
                quietly adding minutes to one person's exam is not something
                that should happen without the trainer deciding it. */}
          </p>
        )}

        <div className="assessment-body">
          <AssessmentQuestionNav
            paper={paper}
            progress={qProgress}
            overall={overall}
            current={current}
            onGo={goTo}
          />
          <div className="assessment-questions" ref={mainRef}>
            {current === 'start' && (
              <section className="wb-section exam-page exam-start">
                <div className="exam-eyebrow">Before you start</div>
                <h2 className="exam-title">{assessment.title}</h2>
                {assessment.description && <p className="muted">{assessment.description}</p>}
                <p className="exam-lede">
                  {paper.pages.length} question{paper.pages.length === 1 ? '' : 's'}
                  {remainingLabel != null && !expired ? ` · ${remainingLabel} left` : ''}.
                  Your answers save as you type — there is nothing to submit.
                </p>
                <PrepCallouts sections={sections} sectionPrep={sectionPrep} standalonePrep={standalonePrep} />
                {paper.start.map(q => <ReadingSection key={q.section.id} q={q} />)}
                <div className="exam-pager">
                  <span />
                  {paper.pages.length > 0 && (
                    <button type="button" className="exam-next" onClick={() => goTo(0)}>
                      Start · {paper.pages[0].question.heading} ›
                    </button>
                  )}
                </div>
              </section>
            )}

            {page && (
              <section className="wb-section exam-page wb-question" data-section-id={page.id}>
                {page.chapter && <div className="exam-eyebrow">{page.chapter}</div>}
                <div className="exam-count">Question {page.index + 1} of {paper.pages.length}</div>
                {page.index === 0 && paper.start.length === 0 && (
                  <PrepCallouts sections={sections} sectionPrep={sectionPrep} standalonePrep={standalonePrep} />
                )}
                {page.reading.map(q => <ReadingSection key={q.section.id} q={q} />)}
                <div className="question-number">
                  {page.question.heading}
                  {page.question.partCount > 1 && (
                    <span className="question-parts-count">{page.question.partCount} parts</span>
                  )}
                </div>
                {/* A withdrawn question arrives with none of its blocks — the read
                    policy withholds them. The trainer's internal reason is NOT
                    shown here; only that it was withdrawn. */}
                {page.withdrawn && (
                  <p className="question-withdrawn-note">
                    Withdrawn by your trainer — you don't need to answer this one, and it
                    doesn't count towards your marks.
                  </p>
                )}
                {page.question.blocks.map(b => (
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
                {(page.after || []).map(q => <ReadingSection key={q.section.id} q={q} />)}
                <div className="exam-pager">
                  {page.index > 0 ? (
                    <button type="button" className="exam-prev" onClick={() => goTo(page.index - 1)}>
                      ‹ {paper.pages[page.index - 1].question.heading}
                    </button>
                  ) : paper.start.length > 0 ? (
                    <button type="button" className="exam-prev" onClick={() => goTo('start')}>‹ Before you start</button>
                  ) : <span />}
                  {page.index < paper.pages.length - 1 ? (
                    <button type="button" className="exam-next" onClick={() => goTo(page.index + 1)}>
                      {paper.pages[page.index + 1].question.heading} ›
                    </button>
                  ) : (
                    <button type="button" className="exam-next" onClick={() => goTo('review')}>Review your answers ›</button>
                  )}
                </div>
              </section>
            )}

            {current === 'review' && (
              <section className="wb-section exam-page exam-review">
                <div className="exam-eyebrow">Review</div>
                <h2 className="exam-title">
                  {unfinished.length
                    ? `${unfinished.length} question${unfinished.length === 1 ? '' : 's'} not finished`
                    : 'Every question answered'}
                </h2>
                <p className="exam-lede">
                  {overall.answered} of {overall.total} answered.
                  {expired
                    ? ' Time is up, so answers can no longer change.'
                    : ' Your answers are already saved; you can keep changing them until the time runs out.'}
                </p>
                {unfinished.length > 0 && (
                  <ul className="exam-review-list">
                    {unfinished.map(p => {
                      const pr = qProgress[p.id];
                      return (
                        <li key={p.id}>
                          <button type="button" onClick={() => goTo(p.index)}>
                            <span className="exam-review-name">{p.question.heading}</span>
                            <span className="exam-review-state">
                              {pr.answered === 0 ? 'not started' : `${pr.answered} of ${pr.total} parts`}
                            </span>
                            <span aria-hidden="true">›</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="exam-pager">
                  {paper.pages.length > 0 ? (
                    <button type="button" className="exam-prev" onClick={() => goTo(paper.pages.length - 1)}>
                      ‹ {paper.pages[paper.pages.length - 1].question.heading}
                    </button>
                  ) : <span />}
                  <Link to="/workbook" className="exam-next">Back to the workbook</Link>
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

// Content with nothing to answer — a Cover, instructions, a scenario to read.
function ReadingSection({ q }) {
  return (
    <div className="exam-reading">
      <div className="exam-reading-title">{q.heading}</div>
      {q.blocks.map(b => <Block key={b.id} block={b} readOnly />)}
    </div>
  );
}

// Trainer pre-work, shown once on the first screen.
function PrepCallouts({ sections, sectionPrep, standalonePrep }) {
  return (
    <>
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
      {sections.map(sec => sectionPrep[sec.id]?.content && (
        <div key={sec.id} className="participant-prep-callout">
          <span className="participant-prep-callout-label">Pre-work from your trainer</span>
          {sectionPrep[sec.id].content}
        </div>
      ))}
    </>
  );
}
