import { useCallback, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { planSave, cascadeRisks, isDraftId } from '../lib/assessmentDraftPlan.js';

// A working copy of an assessment's STRUCTURE, held in memory until Save.
//
// WHAT IS STAGED, AND WHAT IS NOT
//   staged   — adding, deleting, renaming, moving and regrouping questions;
//              adding, deleting, moving and duplicating blocks
//   immediate— a block's CONTENT (BlockForm's own Save), the assessment title
//              and description, answer keys and marks
//
// The split is not arbitrary. Answer keys and marks are stored against a
// block's database id, so a block that exists only in this draft has nothing
// for them to attach to. Keeping content and keys immediate means they only
// ever address rows that really exist; the price is that a newly added question
// must be saved before it can be keyed, which the editor says out loud.
//
// IDS. A block or question created here gets a temporary id (`tmp_…`) until
// Save turns it into a real row. Anything reading ids — the answer-key panel
// above all — must ignore temporary ones. `isDraftId` is exported for that.
//
// SAVE REUSES ROWS RATHER THAN REPLACING THEM. Regrouping five blocks from two
// questions into three does not delete two sections and create three; it
// renames and reassigns in place, creating or deleting only the difference.
// That matters for more than tidiness: deleting a section CASCADES to its
// blocks, so every avoided delete is an avoided way to lose work.

let tmpSeq = 0;
const nextTmpId = (kind) => `tmp_${kind}_${Date.now()}_${tmpSeq++}`;

// Re-exported so the editor can filter draft-only rows out of the answer-key
// panel without reaching past this hook.
export { isDraftId };

// Deep-ish clone of the loaded rows into a draft. config is copied by
// reference: content is not staged, so the draft never mutates it.
function seed(sections, blocks) {
  return {
    sections: [...sections]
      .sort((a, b) => a.order_index - b.order_index)
      .map((s, i) => ({ ...s, order_index: i })),
    blocks: [...blocks]
      .sort((a, b) => a.order_index - b.order_index)
      .map(b => ({ ...b })),
  };
}

// Renumber a section's blocks 0..n-1 so order_index never develops gaps or
// duplicates as things move around.
function compactBlocks(blocks) {
  const bySection = new Map();
  for (const b of blocks) {
    if (!bySection.has(b.section_id)) bySection.set(b.section_id, []);
    bySection.get(b.section_id).push(b);
  }
  const out = [];
  for (const list of bySection.values()) {
    list
      .sort((a, b) => a.order_index - b.order_index)
      .forEach((b, i) => out.push({ ...b, order_index: i }));
  }
  return out;
}

export function useAssessmentDraft({ sections, blocks, reload }) {
  const [draft, setDraft] = useState(() => seed(sections, blocks));
  // The rows the draft was seeded from — what Save diffs against.
  const [base, setBase] = useState(() => ({ sections, blocks }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Re-seed when the underlying data changes identity (first load, or a reload
  // after Save). Deliberately keyed on ids+order, NOT on content: a block's
  // config changing (immediate content edit) must not throw away staged
  // structural work.
  const shape = useMemo(
    () => JSON.stringify([
      [...sections].sort((a, b) => a.order_index - b.order_index).map(s => [s.id, s.title, s.order_index]),
      [...blocks].sort((a, b) => a.order_index - b.order_index).map(b => [b.id, b.section_id, b.order_index]),
    ]),
    [sections, blocks]
  );
  // Re-seeded DURING RENDER, not in an effect.
  //
  // An effect would leave the draft one commit behind the data: on the render
  // where loading flips false the draft would still hold its initial empty
  // arrays, and anything reading it in that window sees an assessment with no
  // questions. That is not hypothetical — it added a phantom "Question 1" to
  // every assessment and reported unsaved changes on a page nobody had touched.
  //
  // Setting state during render is React's documented way to derive state from
  // props: the guard makes it run once per real change, and React re-renders
  // immediately with the new value rather than painting the stale one first.
  const [seededShape, setSeededShape] = useState(shape);
  if (seededShape !== shape) {
    setSeededShape(shape);
    setDraft(seed(sections, blocks));
    setBase({ sections, blocks });
  }

  // ── Structural edits (local only) ────────────────────────────────────────

  const createSection = useCallback((title) => {
    setDraft(d => ({
      ...d,
      sections: [...d.sections, {
        id: nextTmpId('sec'),
        title: title || `Question ${d.sections.length + 1}`,
        order_index: d.sections.length,
        kind: 'exercise',
      }],
    }));
  }, []);

  const updateSectionTitle = useCallback((sectionId, title) => {
    setDraft(d => ({
      ...d,
      sections: d.sections.map(s => s.id === sectionId ? { ...s, title } : s),
    }));
  }, []);

  const deleteSection = useCallback((sectionId) => {
    setDraft(d => ({
      sections: d.sections
        .filter(s => s.id !== sectionId)
        .map((s, i) => ({ ...s, order_index: i })),
      blocks: d.blocks.filter(b => b.section_id !== sectionId),
    }));
  }, []);

  const moveSection = useCallback((sectionId, direction) => {
    setDraft(d => {
      const ordered = [...d.sections].sort((a, b) => a.order_index - b.order_index);
      const i = ordered.findIndex(s => s.id === sectionId);
      const j = direction === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= ordered.length) return d;
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      return { ...d, sections: ordered.map((s, k) => ({ ...s, order_index: k })) };
    });
  }, []);

  const createBlock = useCallback((sectionId, blockType, config = {}) => {
    setDraft(d => {
      const n = d.blocks.filter(b => b.section_id === sectionId).length;
      return {
        ...d,
        blocks: [...d.blocks, {
          id: nextTmpId('blk'),
          section_id: sectionId,
          order_index: n,
          block_type: blockType,
          config,
        }],
      };
    });
    return Promise.resolve({});
  }, []);

  const deleteBlock = useCallback((blockId) => {
    setDraft(d => ({ ...d, blocks: compactBlocks(d.blocks.filter(b => b.id !== blockId)) }));
    return Promise.resolve({});
  }, []);

  const moveBlock = useCallback((blockId, direction) => {
    setDraft(d => {
      const self = d.blocks.find(b => b.id === blockId);
      if (!self) return d;
      const sib = d.blocks
        .filter(b => b.section_id === self.section_id)
        .sort((a, b) => a.order_index - b.order_index);
      const i = sib.findIndex(b => b.id === blockId);
      const j = direction === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= sib.length) return d;
      const other = sib[j];
      return {
        ...d,
        blocks: d.blocks.map(b =>
          b.id === self.id ? { ...b, order_index: other.order_index } :
          b.id === other.id ? { ...b, order_index: self.order_index } : b),
      };
    });
    return Promise.resolve({});
  }, []);

  const duplicateBlock = useCallback((blockId) => {
    setDraft(d => {
      const src = d.blocks.find(b => b.id === blockId);
      if (!src) return d;
      const cfg = JSON.parse(JSON.stringify(src.config || {}));
      // Table input cells carry ids that answers are stored against; a copy
      // must not reuse them or the two blocks would share answers.
      if (src.block_type === 'table' && Array.isArray(cfg.rows)) {
        let n = 0;
        cfg.rows = cfg.rows.map((row, ri) => row.map(cell =>
          cell?.kind === 'input' ? { ...cell, id: `dup${ri}c${n++}_${Date.now()}` } : cell));
      }
      const copy = {
        id: nextTmpId('blk'),
        section_id: src.section_id,
        order_index: src.order_index + 1,
        block_type: src.block_type,
        config: cfg,
      };
      const bumped = d.blocks.map(b =>
        b.section_id === src.section_id && b.order_index > src.order_index
          ? { ...b, order_index: b.order_index + 1 } : b);
      return { ...d, blocks: [...bumped, copy] };
    });
    return Promise.resolve({});
  }, []);

  // Regrouping, from the organiser. `groups` is [{ title, blockIds }].
  // Existing questions are REUSED position by position; only the surplus is
  // created or removed.
  const applyGrouping = useCallback((groups) => {
    setDraft(d => {
      const existing = [...d.sections].sort((a, b) => a.order_index - b.order_index);
      const sections = [];
      const blocks = [];

      groups.forEach((g, i) => {
        const reuse = existing[i];
        const sectionId = reuse ? reuse.id : nextTmpId('sec');
        sections.push(reuse
          ? { ...reuse, title: g.title, order_index: i }
          : { id: sectionId, title: g.title, order_index: i, kind: 'exercise' });
        g.blockIds.forEach((blockId, j) => {
          const b = d.blocks.find(x => x.id === blockId);
          if (b) blocks.push({ ...b, section_id: sectionId, order_index: j });
        });
      });

      return { sections, blocks };
    });
  }, []);

  // A block's CONTENT. Existing blocks write straight through — content is not
  // staged. A draft block has no row yet, so it stays local until Save.
  const updateBlock = useCallback(async (blockId, patch) => {
    setDraft(d => ({ ...d, blocks: d.blocks.map(b => b.id === blockId ? { ...b, ...patch } : b) }));
    if (isDraftId(blockId)) return {};
    const { error } = await supabase.from('assessment_blocks').update(patch).eq('id', blockId);
    return error ? { error } : {};
  }, []);

  // ── Is there anything to save? ───────────────────────────────────────────

  // Structure only: which questions exist, what they are called, what order
  // they are in, and which question each block sits in at which position.
  // A block's config is deliberately absent — content saves itself, so an edit
  // to a paragraph must not light up the Save button for structure.
  const dirty = useMemo(() => {
    const sig = ({ sections: secs, blocks: blks }) => JSON.stringify([
      [...secs]
        .sort((a, b) => a.order_index - b.order_index)
        .map(s => [s.id, s.title, s.order_index]),
      [...blks]
        .map(b => [b.id, b.section_id, b.order_index])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ]);
    return sig(draft) !== sig(seed(base.sections, base.blocks));
  }, [draft, base]);

  const discard = useCallback(() => {
    setSaveError(null);
    setDraft(seed(base.sections, base.blocks));
  }, [base]);

  // ── Save ─────────────────────────────────────────────────────────────────
  //
  // Order is chosen so nothing is ever referenced before it exists or deleted
  // while still in use:
  //   1. insert new questions      (draft ids -> real ids)
  //   2. insert new blocks         (needs those real section ids)
  //   3. update moved/renamed rows
  //   4. delete removed blocks, THEN removed questions
  // Deleting a question cascades to its blocks, so blocks that merely MOVED out
  // of a deleted question must already have been reassigned by step 3.
  const save = useCallback(async (assessmentId) => {
    setSaving(true);
    setSaveError(null);
    try {
      const plan = planSave(base, draft);

      // Assert the sequencing rule rather than trust it. If any surviving block
      // would still point at a question this plan deletes, the cascade would
      // take it — so refuse before writing anything at all.
      const risks = cascadeRisks(base, draft, plan);
      if (risks.length) {
        throw Object.assign(
          new Error(
            `refusing to save: ${risks.length} block(s) would be destroyed by deleting their question `
            + `(${risks.map(r => r.blockId).join(', ')}). This is a bug — nothing was written.`
          ),
          { stage: 'safety check' }
        );
      }

      const idMap = new Map();

      // 1. New questions, so their real ids exist for step 2.
      if (plan.insertSections.length) {
        const { data, error } = await supabase
          .from('assessment_sections')
          .insert(plan.insertSections.map(s => ({
            assessment_id: assessmentId,
            title: s.title,
            order_index: s.order_index,
          })))
          .select('id, order_index');
        if (error) throw Object.assign(error, { stage: 'create questions' });
        // Match back by order_index — a column we set ourselves and which is
        // unique within this batch. Relying on insert() returning rows in input
        // order would be an assumption; this is a fact we control.
        const byOrder = new Map(data.map(r => [r.order_index, r.id]));
        for (const s of plan.insertSections) idMap.set(s.tmpId, byOrder.get(s.order_index));
      }

      const realSectionId = id => (isDraftId(id) ? idMap.get(id) : id);

      // 2. New blocks.
      if (plan.insertBlocks.length) {
        const { error } = await supabase.from('assessment_blocks').insert(
          plan.insertBlocks.map(b => ({
            section_id: realSectionId(b.section_id),
            order_index: b.order_index,
            block_type: b.block_type,
            config: b.config,
          }))
        );
        if (error) throw Object.assign(error, { stage: 'create blocks' });
      }

      // 3. Renames and moves. Sequential, not parallel: this project has a
      // documented RLS-planning cost on the assessment tables, and a burst of
      // concurrent writes against those policies is how a timeout is produced.
      for (const s of plan.updateSections) {
        const { error } = await supabase.from('assessment_sections')
          .update({ title: s.title, order_index: s.order_index }).eq('id', s.id);
        if (error) throw Object.assign(error, { stage: 'update questions' });
      }
      for (const b of plan.updateBlocks) {
        const { error } = await supabase.from('assessment_blocks')
          .update({ section_id: realSectionId(b.section_id), order_index: b.order_index })
          .eq('id', b.id);
        if (error) throw Object.assign(error, { stage: 'move blocks' });
      }

      // 4/5. Removals — blocks first, then the questions. Never the other way.
      if (plan.deleteBlocks.length) {
        const { error } = await supabase.from('assessment_blocks').delete().in('id', plan.deleteBlocks);
        if (error) throw Object.assign(error, { stage: 'delete blocks' });
      }
      if (plan.deleteSections.length) {
        const { error } = await supabase.from('assessment_sections').delete().in('id', plan.deleteSections);
        if (error) throw Object.assign(error, { stage: 'delete questions' });
      }

      await reload();
      return {};
    } catch (err) {
      setSaveError({
        stage: err.stage || 'save',
        code: err.code || '(none)',
        message: err.message || String(err),
        details: err.details || '(none)',
        hint: err.hint || '(none)',
      });
      return { error: err };
    } finally {
      setSaving(false);
    }
  }, [draft, base, reload]);

  return {
    sections: draft.sections,
    blocks: draft.blocks,
    dirty,
    saving,
    saveError,
    clearSaveError: () => setSaveError(null),
    save,
    discard,
    createSection, updateSectionTitle, deleteSection, moveSection,
    createBlock, updateBlock, deleteBlock, moveBlock, duplicateBlock,
    applyGrouping,
  };
}
