import Block from '../blocks/Block.jsx';

// The read-only participant preview beside ContentEditorScaffold's editor
// pane. Moved out of the scaffold, unchanged: the scaffold still owns the
// scroll-sync, so it passes in the refs it measures and the highlight state.
//
// Question mode (assessments) draws questions with their part letters; the
// section path draws `visibleSections` (one exercise, or all of them).
export default function ScaffoldPreview({
  paneRef,
  sectionRefs,
  blockRefs,
  title,
  questions,
  qList,
  partLabelByBlockId,
  sections,
  visibleSections,
  blocks,
  activeSectionId,
  focusMode,
  selectedBlockId,
  pulseBlockId,
}) {
  const wrapClass = id => `preview-block-wrap ${selectedBlockId === id ? 'selected' : ''} ${pulseBlockId === id ? 'pulse' : ''}`;
  return (
    <aside className="preview-pane" ref={paneRef}>
      <div className="preview-pane-head">
        Participant preview
        <span className="preview-pane-hint">read-only</span>
      </div>
      <div className="preview-pane-body">
        <h1 className="preview-workbook-title">{title || 'Untitled'}</h1>
        {questions ? (
          qList.map(q => (
            <section
              key={q.section.id}
              className={`wb-section wb-question ${activeSectionId === q.section.id ? 'active' : ''}`}
              ref={el => { sectionRefs.current[q.section.id] = el; }}
            >
              <div className="question-number">{q.heading}</div>
              {q.blocks.map(b => (
                <div key={b.id} className={wrapClass(b.id)} ref={el => { blockRefs.current[b.id] = el; }}>
                  {partLabelByBlockId[b.id] && (
                    <div className="wb-part-label">{partLabelByBlockId[b.id]}</div>
                  )}
                  <Block block={b} value={undefined} onChange={() => {}} />
                </div>
              ))}
            </section>
          ))
        ) : (
          <>
            {sections.length === 0 && <p className="muted">No sections yet.</p>}
            {visibleSections.map(sec => {
              const secBlocks = blocks
                .filter(b => b.section_id === sec.id)
                .sort((a, b) => a.order_index - b.order_index);
              const isGroup = sec.kind === 'group';
              return (
                <section
                  key={sec.id}
                  className={`wb-section ${isGroup ? 'wb-section-group ' : ''}${!focusMode && activeSectionId === sec.id ? 'active' : ''}`}
                  ref={el => { sectionRefs.current[sec.id] = el; }}
                >
                  {isGroup ? <h1 className="wb-section-group-title">{sec.title}</h1> : <h2>{sec.title}</h2>}
                  {secBlocks.map(b => (
                    <div key={b.id} className={wrapClass(b.id)} ref={el => { blockRefs.current[b.id] = el; }}>
                      <Block block={b} value={undefined} onChange={() => {}} />
                    </div>
                  ))}
                </section>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}
