import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useWorkbook } from '../hooks/useWorkbook.js';
import { isFillableBlock, isAnswered } from '../lib/blockHelpers.js';
import Block from '../components/blocks/Block.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/workbook.css';

const ALL_KEY = '__all__';

export default function ParticipantWorkbookPage() {
  const { session: authSession } = useAuth();
  const { loading, error, session, workbook, sections, blocks, answers, savingMap, saveAnswer, recentlyUpdated } =
    useWorkbook(authSession?.user.id);

  const [selectedSectionId, setSelectedSectionId] = useState(ALL_KEY);

  const overallStatus = useMemo(() => {
    const statuses = Object.values(savingMap);
    if (statuses.includes('saving')) return 'saving';
    if (statuses.includes('error')) return 'error';
    if (statuses.length) return 'saved';
    return null;
  }, [savingMap]);

  // Per-section progress for the sidebar
  const sectionStats = useMemo(() => {
    return sections.map(sec => {
      const sBlocks = blocks.filter(b => b.section_id === sec.id);
      const fillable = sBlocks.filter(isFillableBlock);
      const answered = fillable.reduce((n, b) => n + (isAnswered(b, answers[b.id]) ? 1 : 0), 0);
      const pct = fillable.length ? Math.round((answered / fillable.length) * 100) : 0;
      return { id: sec.id, title: sec.title, total: fillable.length, answered, pct };
    });
  }, [sections, blocks, answers]);

  // If a section is deleted while we're viewing it, fall back to "All".
  useEffect(() => {
    if (selectedSectionId !== ALL_KEY && !sections.find(s => s.id === selectedSectionId)) {
      setSelectedSectionId(ALL_KEY);
    }
  }, [sections, selectedSectionId]);

  if (loading) return <><TopBar /><div className="loading">Loading workbook…</div></>;
  if (error) {
    return (
      <>
        <TopBar />
        <main className="page">
          <section className="page-hero compact">
            <div className="page-hero-text">
              <h1>Welcome</h1>
              <p>{error}</p>
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
            <h1>
              {workbook.title}
              {session?.city_code && <span className="city-tag inline">{session.city_code}</span>}
            </h1>
            <p>
              {session?.name}
              {(session?.starts_at || session?.ends_at) && (
                <span className="session-dates"> · {formatDateRange(session.starts_at, session.ends_at)}</span>
              )}
            </p>
            {workbook.description && <p className="muted">{workbook.description}</p>}
          </div>
          <div className="page-hero-actions">
            {overallStatus && (
              <span className={`wb-save-indicator ${overallStatus}`}>
                {overallStatus === 'saving' ? 'Saving…' : overallStatus === 'error' ? 'Save failed' : 'All changes saved'}
              </span>
            )}
          </div>
        </section>

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
                {blocks.filter(b => b.section_id === sec.id).map(b => (
                  <Block
                    key={b.id}
                    block={b}
                    value={answers[b.id]}
                    onChange={v => saveAnswer(b.id, v)}
                    recentlyUpdated={!!recentlyUpdated[b.id]}
                  />
                ))}
              </section>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}

function formatDateRange(start, end) {
  const fmt = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (start && end) return `${fmt(start)} → ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  if (end) return `Until ${fmt(end)}`;
  return '';
}
