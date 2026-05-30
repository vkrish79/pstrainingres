import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useParticipantAssessment } from '../hooks/useParticipantAssessment.js';
import { useParticipantAssessmentPrep } from '../hooks/useParticipantAssessmentPrep.js';
import { isFillableBlock, isAnswered } from '../lib/blockHelpers.js';
import Block from '../components/blocks/Block.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/workbook.css';

const ALL_KEY = '__all__';

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

  const [selectedSectionId, setSelectedSectionId] = useState(ALL_KEY);

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

  const sectionStats = useMemo(() => {
    return sections.map(sec => {
      const sBlocks = blocks.filter(b => b.section_id === sec.id);
      const fillable = sBlocks.filter(isFillableBlock);
      const answered = fillable.reduce((n, b) => n + (isAnswered(b, answers[b.id]) ? 1 : 0), 0);
      const pct = fillable.length ? Math.round((answered / fillable.length) * 100) : 0;
      return { id: sec.id, title: sec.title, kind: sec.kind || 'exercise', total: fillable.length, answered, pct };
    });
  }, [sections, blocks, answers]);

  useEffect(() => {
    if (selectedSectionId !== ALL_KEY && !sections.find(s => s.id === selectedSectionId)) {
      setSelectedSectionId(ALL_KEY);
    }
  }, [sections, selectedSectionId]);

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

  const visibleSections = selectedSectionId === ALL_KEY
    ? sections
    : sections.filter(s => s.id === selectedSectionId);

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

        <div className="exresp-layout">
          <div className="exresp-mobile-nav">
            <select
              className="form-input"
              value={selectedSectionId}
              onChange={e => setSelectedSectionId(e.target.value)}
            >
              <option value={ALL_KEY}>All questions</option>
              {sectionStats.map(s => (
                <option key={s.id} value={s.id} disabled={s.kind === 'group'}>
                  {s.kind === 'group' ? `— ${s.title} —` : `${s.title} — ${s.pct}%`}
                </option>
              ))}
            </select>
          </div>

          <aside className="exresp-sidebar">
            <div className="exresp-sidebar-head">Sections</div>
            <ul className="exresp-sidebar-list">
              <li>
                <button
                  className={`exresp-sidebar-item ${selectedSectionId === ALL_KEY ? 'active' : ''}`}
                  onClick={() => setSelectedSectionId(ALL_KEY)}
                >
                  <div className="exresp-sidebar-row">
                    <span className="exresp-sidebar-title">All questions</span>
                  </div>
                </button>
              </li>
              {sectionStats.map(s => {
                if (s.kind === 'group') {
                  return (
                    <li key={s.id} className="exresp-sidebar-group-li">
                      <button className="exresp-sidebar-group" onClick={() => setSelectedSectionId(ALL_KEY)}>
                        {s.title}
                      </button>
                    </li>
                  );
                }
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
            {visibleSections.map(sec => {
              const isGroup = sec.kind === 'group';
              return (
                <section
                  key={sec.id}
                  className={`wb-section${isGroup ? ' wb-section-group' : ''}`}
                  data-section-id={sec.id}
                >
                  {isGroup ? <h1 className="wb-section-group-title">{sec.title}</h1> : <h2>{sec.title}</h2>}
                  {sectionPrep[sec.id]?.content && (
                    <div className="participant-prep-callout">
                      <span className="participant-prep-callout-label">Pre-work from your trainer</span>
                      {sectionPrep[sec.id].content}
                    </div>
                  )}
                  {blocks.filter(b => b.section_id === sec.id).map(b => (
                    <Block
                      key={b.id}
                      block={b}
                      value={answers[b.id]}
                      onChange={v => saveAnswer(b.id, v)}
                      readOnly={expired}
                      recentlyUpdated={!!recentlyUpdated[b.id]}
                    />
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      </main>
    </>
  );
}
