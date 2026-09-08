import { useMemo, useState } from 'react';

// Question navigation for an assessment — the editor's counterpart to the
// participant workbook's exercise sidebar, and deliberately the same shape:
// a filter box, one row per question, click to jump.
//
// Takes the already-built question list from lib/assessmentStructure.js rather
// than raw sections/blocks, so the numbering here can never disagree with the
// numbering in the editor beside it.
export default function QuestionNav({ questions, onJump, activeSectionId = null }) {
  const [filter, setFilter] = useState('');

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return questions;
    return questions.filter(x =>
      x.heading.toLowerCase().includes(q)
      // Search the narration too — on a scenario question the heading is just
      // a number, so the words the author remembers are in the stem.
      || x.narration.some(b => (b.config?.html || '').replace(/<[^>]+>/g, '').toLowerCase().includes(q))
    );
  }, [questions, filter]);

  if (!questions.length) return null;

  return (
    <aside className="exresp-sidebar question-nav">
      <div className="exresp-sidebar-head">Questions</div>
      <input
        className="exresp-sidebar-filter"
        placeholder="Filter questions…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />
      <ul className="exresp-sidebar-list">
        {shown.length === 0 && (
          <li className="exresp-sidebar-empty">No questions match “{filter.trim()}”</li>
        )}
        {shown.map(q => (
          <li key={q.section.id}>
            <button
              type="button"
              className={`exresp-sidebar-item ${activeSectionId === q.section.id ? 'active' : ''}`}
              onClick={() => onJump(q.section.id)}
            >
              <div className="exresp-sidebar-row">
                <span className="exresp-sidebar-title">{q.heading}</span>
                {q.partCount > 1 && (
                  <span className="exresp-sidebar-pct">{q.partCount} parts</span>
                )}
              </div>
              {/* A question with nothing to answer is almost always half-written
                  — worth saying so here rather than only in the editor pane. */}
              {q.partCount === 0 && (
                <div className="exresp-sidebar-meta question-nav-empty">no answerable part</div>
              )}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
