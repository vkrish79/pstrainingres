import { useEffect, useMemo, useState } from 'react';

// Question navigation on the participant's assessment — the same sidebar the
// workbook gives for exercises: filter, one row per question, progress bar,
// answered/total, click to jump.
//
// Scroll-spy marks the question currently in view, so the sidebar tracks the
// participant down the paper rather than only responding to clicks.
export default function AssessmentQuestionNav({ questions, progress }) {
  const [filter, setFilter] = useState('');
  const [activeId, setActiveId] = useState(null);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return questions;
    return questions.filter(x => x.heading.toLowerCase().includes(q));
  }, [questions, filter]);

  useEffect(() => {
    if (!questions.length) return undefined;
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .map(e => ({ id: e.target.dataset.sectionId, top: e.boundingClientRect.top }))
          .sort((a, b) => a.top - b.top);
        if (visible.length && visible[0].id) setActiveId(visible[0].id);
      },
      { rootMargin: '-80px 0px -65% 0px', threshold: [0, 0.25, 1] }
    );
    questions.forEach(q => {
      const el = document.querySelector(`[data-section-id="${q.section.id}"]`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [questions]);

  if (!questions.length) return null;

  const totals = questions.reduce(
    (acc, q) => {
      const p = progress[q.section.id] || { answered: 0, total: 0 };
      return { answered: acc.answered + p.answered, total: acc.total + p.total };
    },
    { answered: 0, total: 0 }
  );

  function jump(sectionId) {
    document.querySelector(`[data-section-id="${sectionId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <aside className="exresp-sidebar question-nav">
      <div className="exresp-sidebar-head">
        Questions
        <span className="question-nav-total">{totals.answered}/{totals.total}</span>
      </div>
      <input
        className="exresp-sidebar-filter"
        placeholder="Jump to a question…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />
      <ul className="exresp-sidebar-list">
        {shown.length === 0 && (
          <li className="exresp-sidebar-empty">No questions match “{filter.trim()}”</li>
        )}
        {shown.map(q => {
          const p = progress[q.section.id] || { answered: 0, total: 0, pct: 0 };
          const barClass = p.pct === 100 ? 'full' : p.pct > 0 ? 'partial' : '';
          return (
            <li key={q.section.id}>
              <button
                type="button"
                className={`exresp-sidebar-item ${activeId === q.section.id ? 'active' : ''}`}
                onClick={() => jump(q.section.id)}
              >
                <div className="exresp-sidebar-row">
                  <span className="exresp-sidebar-title">{q.heading}</span>
                  <span className="exresp-sidebar-pct">{p.pct}%</span>
                </div>
                <div className={`exresp-sidebar-bar ${barClass}`}>
                  <div className="exresp-sidebar-bar-fill" style={{ width: `${p.pct}%` }} />
                </div>
                <div className="exresp-sidebar-meta">
                  {p.total === 0 ? 'nothing to answer' : `${p.answered}/${p.total} answered`}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
