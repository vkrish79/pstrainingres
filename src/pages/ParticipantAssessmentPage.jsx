import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useParticipantAssessment } from '../hooks/useParticipantAssessment.js';
import { useParticipantAssessmentPrep } from '../hooks/useParticipantAssessmentPrep.js';
import { questionNumbers } from '../lib/blockHelpers.js';
import Block from '../components/blocks/Block.jsx';
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

  // Assessments are a flat list of numbered questions — no sections shown.
  // Flatten all blocks in document order and number the fillable ones.
  const orderedBlocks = useMemo(
    () => sections.flatMap(sec =>
      blocks.filter(b => b.section_id === sec.id).sort((a, b) => a.order_index - b.order_index)
    ),
    [sections, blocks]
  );
  const qNums = useMemo(() => questionNumbers(orderedBlocks), [orderedBlocks]);

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

        <div className="assessment-questions">
          {/* Any trainer pre-work callouts (formerly per-section) surface once at the top. */}
          {sections.map(sec => sectionPrep[sec.id]?.content && (
            <div key={sec.id} className="participant-prep-callout">
              <span className="participant-prep-callout-label">Pre-work from your trainer</span>
              {sectionPrep[sec.id].content}
            </div>
          ))}
          {orderedBlocks.map(b => (
            <section key={b.id} className="wb-section" data-block-id={b.id}>
              {qNums[b.id] != null && <div className="question-number">Question {qNums[b.id]}</div>}
              <Block
                block={b}
                value={answers[b.id]}
                onChange={v => saveAnswer(b.id, v)}
                readOnly={expired}
                recentlyUpdated={!!recentlyUpdated[b.id]}
              />
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
