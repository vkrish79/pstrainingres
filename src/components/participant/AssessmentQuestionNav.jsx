// Question navigation on the participant's assessment, in exam mode: questions
// only (reading and chapter headings are not questions), each with a tick, its
// parts answered and a progress bar underneath — the same look as the workbook's
// exercise rail — plus the whole paper's bar at the top and a way to review
// what is still unanswered.
//
// `current` is 'start' | 'review' | a page index.
export default function AssessmentQuestionNav({ paper, progress, overall, current, onGo }) {
  const { start, pages } = paper;
  const unanswered = pages.filter(p => !p.withdrawn && (progress[p.id]?.answered || 0) < (progress[p.id]?.total || 0)).length;
  let lastChapter = null;

  return (
    <aside className="exresp-sidebar wb-rail question-nav exam-nav" aria-label="Questions">
      <div className="exresp-sidebar-head exam-nav-head">
        <div className="exam-nav-cap">
          <span>Questions</span>
          <span className="question-nav-total">{overall.answered} / {overall.total} answered</span>
        </div>
        <span className={`wb-rail-bar${overall.total && overall.answered === overall.total ? ' is-done' : ''}`}>
          <i style={{ width: `${overall.pct}%` }} />
        </span>
      </div>

      <ul className="exresp-sidebar-list exam-nav-list">
        {start.length > 0 && (
          <li>
            <button
              type="button"
              className={`exam-nav-start${current === 'start' ? ' active' : ''}`}
              aria-current={current === 'start' ? 'page' : undefined}
              onClick={() => onGo('start')}
            >
              Before you start
            </button>
          </li>
        )}
        {pages.map(p => {
          const pr = progress[p.id] || { answered: 0, total: 0, pct: 0 };
          const state = p.withdrawn ? 'withdrawn' : pr.total && pr.answered === pr.total ? 'done' : pr.answered > 0 ? 'part' : 'none';
          const chapterLabel = p.chapter && p.chapter !== lastChapter ? p.chapter : null;
          lastChapter = p.chapter;
          const active = current === p.index;
          return (
            <li key={p.id}>
              {chapterLabel && <div className="exam-nav-chapter">{chapterLabel}</div>}
              <button
                type="button"
                className={`exresp-sidebar-item wb-rail-row exam-nav-row${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => onGo(p.index)}
              >
                <span
                  className={`wb-rail-tick is-${state === 'withdrawn' ? 'read' : state}`}
                  style={state === 'part' ? { '--p': `${pr.pct}%` } : undefined}
                  role={state === 'withdrawn' ? undefined : 'img'}
                  aria-label={state === 'done' ? 'Answered' : state === 'part' ? `${pr.pct}% answered` : state === 'none' ? 'Not answered' : undefined}
                >
                  {state === 'done' ? '✓' : ''}
                </span>
                <span className="exresp-sidebar-title wb-rail-name">{p.question.heading}</span>
                {state === 'withdrawn'
                  ? <span className="wb-rail-count">withdrawn</span>
                  : <span className={`wb-rail-count is-${state}`}>{pr.answered}/{pr.total}</span>}
                {state !== 'withdrawn' && (
                  <span className={`wb-rail-bar is-thin${state === 'done' ? ' is-done' : ''}`}>
                    <i style={{ width: `${pr.pct}%` }} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className={`exam-nav-review${current === 'review' ? ' active' : ''}${unanswered ? '' : ' is-clear'}`}
        onClick={() => onGo('review')}
      >
        {unanswered
          ? `${unanswered} question${unanswered === 1 ? '' : 's'} not finished → review`
          : 'Every question answered → review'}
      </button>
    </aside>
  );
}
