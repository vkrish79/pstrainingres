import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useWorkbook } from '../hooks/useWorkbook.js';
import Block from '../components/blocks/Block.jsx';
import '../styles/workbook.css';

export default function ParticipantWorkbookPage() {
  const { profile, signOut, session: authSession } = useAuth();
  const { loading, error, workbook, sections, blocks, answers, savingMap, saveAnswer, recentlyUpdated } =
    useWorkbook(authSession?.user.id);

  const overallStatus = useMemo(() => {
    const statuses = Object.values(savingMap);
    if (statuses.includes('saving')) return 'saving';
    if (statuses.includes('error')) return 'error';
    if (statuses.length) return 'saved';
    return null;
  }, [savingMap]);

  if (loading) return <div className="loading">Loading workbook…</div>;
  if (error) {
    return (
      <div className="page">
        <header className="page-header">
          <h1>{profile?.full_name}</h1>
          <button onClick={signOut}>Sign out</button>
        </header>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="page workbook">
      <header className="page-header">
        <div>
          <h1>{workbook.title}</h1>
          {workbook.description && <p className="muted">{workbook.description}</p>}
        </div>
        <div>
          {overallStatus && (
            <span className={`wb-save-indicator ${overallStatus}`}>
              {overallStatus === 'saving' ? 'Saving…' : overallStatus === 'error' ? 'Save failed' : 'All changes saved'}
            </span>
          )}
          <span>{profile?.full_name}</span>
          <button onClick={signOut}>Sign out</button>
        </div>
      </header>

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
    </div>
  );
}
