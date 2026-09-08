// What saving a draft would do to the database — computed, not performed.
//
// Pulled out of useAssessmentDraft so the risky half can be reasoned about and
// tested without React or a database. This is the code that DELETES rows, and a
// wrong answer here loses an author's work, so it earns being a pure function
// with cases written down.
//
// THE ORDER IS PART OF THE ANSWER. The returned plan must be executed exactly
// as ordered:
//
//   1. insertSections — new questions, so their real ids exist
//   2. insertBlocks   — needs those ids
//   3. updateSections / updateBlocks — reassign anything that moved
//   4. deleteBlocks   — explicit removals
//   5. deleteSections — last
//
// 5 is last because deleting a question CASCADES to whatever blocks still point
// at it. A block that merely MOVED OUT of a deleted question must already have
// been reassigned by step 3, or the cascade takes it too. That is the single
// sequencing rule the whole plan exists to respect.

export function isDraftId(id) {
  return typeof id === 'string' && id.startsWith('tmp_');
}

// base  — { sections, blocks } as last loaded from the database
// draft — { sections, blocks } as currently held in the editor
//
// Returns the plan. `resolveSectionId` is applied by the caller once the
// inserts come back with real ids; here, new sections are still referred to by
// their temporary ids.
export function planSave(base, draft) {
  const baseSections = new Map(base.sections.map(s => [s.id, s]));
  const baseBlocks = new Map(base.blocks.map(b => [b.id, b]));

  const insertSections = draft.sections
    .filter(s => isDraftId(s.id))
    .map(s => ({ tmpId: s.id, title: s.title, order_index: s.order_index }));

  const insertBlocks = draft.blocks
    .filter(b => isDraftId(b.id))
    .map(b => ({
      tmpId: b.id,
      section_id: b.section_id,      // may be a tmp id; caller resolves
      order_index: b.order_index,
      block_type: b.block_type,
      config: b.config,
    }));

  const updateSections = draft.sections
    .filter(s => !isDraftId(s.id))
    .filter(s => {
      const was = baseSections.get(s.id);
      return was && (was.title !== s.title || was.order_index !== s.order_index);
    })
    .map(s => ({ id: s.id, title: s.title, order_index: s.order_index }));

  const updateBlocks = draft.blocks
    .filter(b => !isDraftId(b.id))
    .filter(b => {
      const was = baseBlocks.get(b.id);
      return was && (was.section_id !== b.section_id || was.order_index !== b.order_index);
    })
    .map(b => ({ id: b.id, section_id: b.section_id, order_index: b.order_index }));

  // Anything present in the database but absent from the draft is a removal.
  const keptBlocks = new Set(draft.blocks.map(b => b.id));
  const deleteBlocks = base.blocks.filter(b => !keptBlocks.has(b.id)).map(b => b.id);

  const keptSections = new Set(draft.sections.map(s => s.id));
  const deleteSections = base.sections.filter(s => !keptSections.has(s.id)).map(s => s.id);

  return { insertSections, insertBlocks, updateSections, updateBlocks, deleteBlocks, deleteSections };
}

// A safety check on the plan, run before any of it is executed.
//
// It answers one question: after this plan runs, would any block that the draft
// still holds have been destroyed by a cascade? That happens when a surviving
// block is not moved out of a section that is about to be deleted — the exact
// failure the step ordering is designed to prevent, asserted rather than
// assumed. Returns [] when the plan is safe.
export function cascadeRisks(base, draft, plan) {
  const doomed = new Set(plan.deleteSections);
  if (!doomed.size) return [];

  const moved = new Map(plan.updateBlocks.map(b => [b.id, b.section_id]));
  const risks = [];

  for (const b of draft.blocks) {
    if (isDraftId(b.id)) continue;           // not in the database yet
    const landsIn = moved.has(b.id) ? moved.get(b.id) : b.section_id;
    if (doomed.has(landsIn)) {
      risks.push({ blockId: b.id, sectionId: landsIn });
    }
  }
  return risks;
}
