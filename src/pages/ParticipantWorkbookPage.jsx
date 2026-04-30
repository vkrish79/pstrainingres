import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useWorkbook } from '../hooks/useWorkbook.js';
import Block from '../components/blocks/Block.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/workbook.css';

export default function ParticipantWorkbookPage() {
  const { session: authSession } = useAuth();
  const { loading, error, workbook, sections, blocks, answers, savingMap, saveAnswer, recentlyUpdated } =
    useWorkbook(authSession?.user.id);

  const overallStatus = useMemo(() => {
    const statuses = Object.values(savingMap);
    if (statuses.includes('saving')) return 'saving';
    if (statuses.includes('error')) return 'error';
    if (statuses.length) return 'saved';
    return null;
  }, [savingMap]);

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

  return (
    <>
      <TopBar />
      <main className="page workbook">
        <section className="page-hero">
          <div className="page-hero-text">
            <h1>{workbook.title}</h1>
            {workbook.description && <p>{workbook.description}</p>}
          </div>
          <div className="page-hero-actions">
            {overallStatus && (
              <span className={`wb-save-indicator ${overallStatus}`}>
                {overallStatus === 'saving' ? 'Saving…' : overallStatus === 'error' ? 'Save failed' : 'All changes saved'}
              </span>
            )}
          </div>
        </section>

        {sections.map(sec => (
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
      </main>
    </>
  );
}
