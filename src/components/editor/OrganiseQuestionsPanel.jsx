import { useEffect, useMemo, useState } from 'react';
import {
  orderedBlocksOf,
  currentBoundaries,
  oneQuestionPerPartBoundaries,
  groupsFromBoundaries,
  isAutoQuestionTitle,
} from '../../lib/assessmentStructure.js';
import { labelOf, isFillableBlock } from '../../lib/blockHelpers.js';

// Decide which blocks belong to which question.
//
// This replaces an automatic "split into one question per part" action, which
// could only ever guess. A scenario with three sub-questions and three separate
// questions look identical in the data; only the author knows which it is.
//
// The model is one flat list plus boundaries — "this block starts a new
// question". Merge and split are then the same operation, and the panel opens
// on the CURRENT grouping, so opening it and applying changes nothing.
//
// Regrouping is non-destructive: blocks are moved between questions keeping
// their ids, so answer keys, marks and participant answers stay attached. That
// is what makes this safe to reach for whenever the shape is wrong.
export default function OrganiseQuestionsPanel({ sections, blocks, onApply }) {
  const [open, setOpen] = useState(false);
  const [boundaries, setBoundaries] = useState(() => currentBoundaries(sections, blocks));

  const ordered = useMemo(() => orderedBlocksOf(sections, blocks), [sections, blocks]);

  // Re-seed whenever the assessment changes underneath (a block added, or a
  // grouping just applied), so the panel never shows a stale arrangement.
  useEffect(() => {
    setBoundaries(currentBoundaries(sections, blocks));
  }, [sections, blocks]);

  // Author-written headings survive a regroup when the question still starts
  // with the same block. Auto numbers are regenerated from position.
  const titleByFirstBlockId = useMemo(() => {
    const out = {};
    for (const sec of sections) {
      if (isAutoQuestionTitle(sec.title)) continue;
      const first = blocks
        .filter(b => b.section_id === sec.id)
        .sort((a, b) => a.order_index - b.order_index)[0];
      if (first) out[first.id] = sec.title;
    }
    return out;
  }, [sections, blocks]);

  const groups = useMemo(
    () => groupsFromBoundaries(ordered, boundaries, (g, i) =>
      titleByFirstBlockId[g.firstBlockId] || `Question ${i + 1}`),
    [ordered, boundaries, titleByFirstBlockId]
  );

  if (!ordered.length) return null;

  const currentCount = currentBoundaries(sections, blocks).size;
  const dirty =
    groups.length !== currentCount
    || [...boundaries].some(id => !currentBoundaries(sections, blocks).has(id));

  function splitAt(blockId) {
    setBoundaries(prev => new Set(prev).add(blockId));
  }
  function mergeAt(blockId) {
    setBoundaries(prev => {
      const next = new Set(prev);
      next.delete(blockId);
      return next;
    });
  }

  // Purely local. This hands the new grouping to the editor's draft; nothing
  // reaches the database until the editor's Save. That is why there is no error
  // path here any more — there is no write to fail.
  function apply() {
    onApply(groups);
    setOpen(false);
  }

  return (
    <section className="editor-card organise-panel">
      <div className="organise-head">
        <div>
          <h2 className="section-title" style={{ marginTop: 0, marginBottom: '.15rem' }}>
            🧩 Organise questions
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            {currentCount} question{currentCount === 1 ? '' : 's'} from {ordered.length} block
            {ordered.length === 1 ? '' : 's'}. Change which blocks sit together — a stem with its
            sub-questions, or a question on its own.
          </p>
        </div>
        <button className="ghost" onClick={() => setOpen(o => !o)}>
          {open ? 'Close' : 'Organise'}
        </button>
      </div>

      {open && (
        <>
          <div className="organise-presets">
            <span className="muted">Start from:</span>
            <button className="ghost" onClick={() => setBoundaries(currentBoundaries(sections, blocks))}>
              How it is now
            </button>
            <button className="ghost" onClick={() => setBoundaries(oneQuestionPerPartBoundaries(sections, blocks))}>
              One question per part
            </button>
            <button className="ghost" onClick={() => setBoundaries(new Set([ordered[0].id]))}>
              All in one question
            </button>
          </div>

          <div className="organise-groups">
            {groups.map((g, gi) => {
              const groupBlocks = g.blockIds.map(id => ordered.find(b => b.id === id));
              const parts = groupBlocks.filter(isFillableBlock).length;
              return (
                <div key={g.firstBlockId} className="organise-group">
                  <div className="organise-group-head">
                    <strong>{g.title}</strong>
                    <span className="muted">
                      {parts === 0
                        ? 'no answerable part'
                        : `${parts} part${parts === 1 ? '' : 's'}`}
                    </span>
                    {gi > 0 && (
                      <button
                        className="ghost organise-merge"
                        onClick={() => mergeAt(g.firstBlockId)}
                        title="Join this question onto the one above"
                      >
                        ⌃ Join to previous
                      </button>
                    )}
                  </div>
                  {groupBlocks.map((b, bi) => (
                    <div key={b.id} className="organise-block">
                      {bi > 0 && (
                        <button
                          className="ghost organise-split"
                          onClick={() => splitAt(b.id)}
                          title="Start a new question at this block"
                        >
                          ✂ Start a new question here
                        </button>
                      )}
                      <div className="organise-block-row">
                        <span className={`block-type-tag tag-${b.block_type}`}>{b.block_type}</span>
                        <span className="block-preview">{labelOf(b)}</span>
                        {!isFillableBlock(b) && <span className="organise-narration">narration</span>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="organise-note">
            This only sets up the grouping — <strong>nothing is written until you press Save
            changes</strong> at the top of the editor, and Cancel there puts everything back.
            On save, blocks are <strong>moved</strong>, never copied, so answer keys, marks and
            any answers already given stay attached. Headings you wrote yourself are kept when the
            question still starts with the same block; automatic numbers are regenerated.
          </div>

          <div className="form-actions">
            <button onClick={apply} disabled={!dirty}>
              {dirty ? `Use this grouping — ${groups.length} question${groups.length === 1 ? '' : 's'}` : 'No changes'}
            </button>
            <button className="ghost" onClick={() => { setBoundaries(currentBoundaries(sections, blocks)); setOpen(false); }}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}
