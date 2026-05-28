// Shared slide-deck chrome used by the participant workbook and the trainer
// "My copy" practice view. Provides:
//   - sticky top progress strip (filling bar + N/total counter + section dots)
//   - desktop edge arrows ‹ ›
//   - sticky Prev/Next footer (with the section title between them)
//   - slide-in animation (CSS in workbook.css)
//
// The caller supplies the section body via `renderSection(section)` so each
// view can render its own block flow (participant uses <Block>, trainer
// toggles between <Block> and <EditableBlock>).

export default function SlidesDeck({
  sections, sectionStats, slideIdx, slideDir, animKey,
  jumpSlide, goSlide, onTouchStart, onTouchEnd,
  currentSection, renderSection, rightHint = null,
}) {
  if (!currentSection) return null;
  const isFirst = slideIdx === 0;
  const isLast = slideIdx >= sections.length - 1;
  const stats = sectionStats[slideIdx];

  return (
    <div
      className="slides-deck"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="slides-progress">
        <div className="slides-progress-bar">
          <div
            className="slides-progress-fill"
            style={{ width: `${((slideIdx + 1) / sections.length) * 100}%` }}
          />
        </div>
        <div className="slides-progress-meta">
          <span className="slides-progress-count">
            {slideIdx + 1} <span className="muted">/ {sections.length}</span>
          </span>
          {stats && stats.kind !== 'group' && stats.total > 0 && (
            <span className="slides-progress-pct">{stats.pct}% {rightHint || 'answered'}</span>
          )}
        </div>
        <div className="slides-progress-dots" role="tablist" aria-label="Section navigator">
          {sections.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === slideIdx}
              aria-label={s.title}
              title={s.title}
              className={`slides-dot ${s.kind === 'group' ? 'group' : ''} ${i === slideIdx ? 'active' : ''} ${i < slideIdx ? 'past' : ''}`}
              onClick={() => jumpSlide(i)}
            />
          ))}
        </div>
      </div>

      <div className="slides-stage">
        <button
          type="button"
          className="slides-edge slides-edge-prev"
          onClick={() => goSlide(-1)}
          disabled={isFirst}
          aria-label="Previous exercise"
        >
          ‹
        </button>

        <div className={`slides-card-wrap dir-${slideDir}`} key={animKey}>
          {renderSection(currentSection)}
        </div>

        <button
          type="button"
          className="slides-edge slides-edge-next"
          onClick={() => goSlide(1)}
          disabled={isLast}
          aria-label="Next exercise"
        >
          ›
        </button>
      </div>

      <div className="slides-foot">
        <button
          type="button"
          className="slides-foot-btn"
          onClick={() => goSlide(-1)}
          disabled={isFirst}
        >
          ‹ Previous
        </button>
        <div className="slides-foot-title">{currentSection.title}</div>
        <button
          type="button"
          className="slides-foot-btn primary"
          onClick={() => goSlide(1)}
          disabled={isLast}
        >
          Next ›
        </button>
      </div>
    </div>
  );
}
