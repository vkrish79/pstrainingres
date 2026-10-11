import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { useSaveTracker } from './useSaveTracker.js';

// Generalized content-editor state for any parent-with-sections-with-blocks
// shape (workbooks today, assessments next). kindConfig pins the table names
// and the FK column so the same load/save/reorder logic serves both.
//
// kindConfig: { parentTable, sectionsTable, blocksTable, parentFK }
//   parentTable  — e.g. 'workbooks' | 'assessments'
//   sectionsTable — e.g. 'sections' | 'assessment_sections'
//   blocksTable   — e.g. 'blocks' | 'assessment_blocks'
//   parentFK      — section column referencing the parent (e.g. 'workbook_id')
// How the save chip names a change to the parent row's own fields.
const FIELD_LABELS = {
  title: 'the title',
  description: 'the description',
  pass_mark: 'the pass mark',
  vendor_visible: '"Vendors can use it"',
};
function fieldLabel(patch) {
  const keys = Object.keys(patch);
  return keys.length === 1 && FIELD_LABELS[keys[0]] ? FIELD_LABELS[keys[0]] : 'that change';
}

export function useContentEditor(kindConfig, parentId) {
  const { parentTable, sectionsTable, blocksTable, parentFK } = kindConfig;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [parent, setParent] = useState(null);
  const [sections, setSections] = useState([]);
  const [blocks, setBlocks] = useState([]);

  const load = useCallback(async () => {
    if (!parentId) return;
    try {
      const { data: p, error: e1 } = await supabase
        .from(parentTable).select('*').eq('id', parentId).single();
      if (e1) throw e1;

      const { data: secs, error: e2 } = await supabase
        .from(sectionsTable).select('*').eq(parentFK, parentId).order('order_index');
      if (e2) throw e2;

      const sectionIds = (secs || []).map(s => s.id);
      const { data: blks, error: e3 } = sectionIds.length
        ? await supabase.from(blocksTable).select('*').in('section_id', sectionIds).order('order_index')
        : { data: [], error: null };
      if (e3) throw e3;

      setParent(p);
      setSections(secs || []);
      setBlocks(blks || []);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [parentId, parentTable, sectionsTable, blocksTable, parentFK]);

  useEffect(() => { load(); }, [load]);

  // Mirrors `parent` so updateParentField can roll back to the last known
  // saved row without taking `parent` as a dependency.
  const parentRef = useRef(null);
  useEffect(() => { parentRef.current = parent; }, [parent]);

  const updateParentField = useCallback(async (patch) => {
    const before = parentRef.current;
    setParent(p => p ? { ...p, ...patch } : p);

    // .select() is not decoration. A blocked update returns 200 with no error
    // and zero rows, so without reading the row back a refusal is
    // indistinguishable from a success — the field shows the new value, and
    // the old one comes back on the next reload with nothing explaining why.
    const { data, error: saveErr } = await supabase
      .from(parentTable).update(patch).eq('id', parentId).select('id');

    if (saveErr || !data || data.length === 0) {
      // Put back what was actually stored rather than leaving the optimistic
      // value on screen claiming to be saved.
      if (before) setParent(before);
      const msg = saveErr?.message
        || 'That change was not saved — you may not have permission to edit this.';
      // Returned, NOT put in `error`. `error` is the load error, and every
      // editor page swaps itself for a bare error line when it is set — so a
      // refused rename used to throw the whole editor away. The save chip
      // (SaveStatus) reports this one, with a Retry.
      return { error: new Error(msg) };
    }
    return {};
  }, [parentTable, parentId]);

  // afterIndex null appends (what this always did). A number inserts directly
  // after the block at that position within the section, which is what the
  // insertion points between blocks need: a new block used to land at the
  // bottom and be walked up one ↑ click at a time.
  //
  // The push-down-then-insert below is lifted from duplicateBlock, which has
  // done exactly this in production since it shipped.
  const createBlock = useCallback(async (sectionId, blockType, config = {}, afterIndex = null) => {
    const sectionBlocks = blocks
      .filter(b => b.section_id === sectionId)
      .sort((a, b) => a.order_index - b.order_index);

    if (afterIndex == null || afterIndex >= sectionBlocks.length - 1) {
      const maxIdx = sectionBlocks.reduce((m, b) => Math.max(m, b.order_index), -1);
      const { data, error: insErr } = await supabase
        .from(blocksTable)
        .insert({ section_id: sectionId, order_index: maxIdx + 1, block_type: blockType, config })
        .select()
        .single();
      if (insErr) return { error: insErr };
      setBlocks(prev => [...prev, data]);
      return { data };
    }

    const anchor = sectionBlocks[afterIndex];
    const newIdx = anchor.order_index + 1;
    // Everything at or after the new position moves down one.
    await Promise.all(
      sectionBlocks
        .filter(b => b.order_index >= newIdx)
        .map(b => supabase.from(blocksTable).update({ order_index: b.order_index + 1 }).eq('id', b.id))
    );

    const { data, error: insErr } = await supabase
      .from(blocksTable)
      .insert({ section_id: sectionId, order_index: newIdx, block_type: blockType, config })
      .select()
      .single();
    if (insErr) return { error: insErr };

    setBlocks(prev => [
      ...prev.map(b =>
        b.section_id === sectionId && b.order_index >= newIdx
          ? { ...b, order_index: b.order_index + 1 }
          : b),
      data,
    ]);
    return { data };
  }, [blocks, blocksTable]);

  const updateBlock = useCallback(async (blockId, patch) => {
    const { data, error: updErr } = await supabase
      .from(blocksTable)
      .update(patch)
      .eq('id', blockId)
      .select()
      .single();
    if (updErr) return { error: updErr };
    setBlocks(prev => prev.map(b => b.id === blockId ? data : b));
    return { data };
  }, [blocksTable]);

  const deleteBlock = useCallback(async (blockId) => {
    const { error: delErr } = await supabase.from(blocksTable).delete().eq('id', blockId);
    if (delErr) return { error: delErr };
    setBlocks(prev => prev.filter(b => b.id !== blockId));
    return {};
  }, [blocksTable]);

  const duplicateBlock = useCallback(async (blockId) => {
    const src = blocks.find(b => b.id === blockId);
    if (!src) return {};
    const sectionBlocks = blocks
      .filter(b => b.section_id === src.section_id)
      .sort((a, b) => a.order_index - b.order_index);
    const srcIdx = sectionBlocks.findIndex(b => b.id === blockId);
    const after = sectionBlocks.slice(srcIdx + 1);

    // Push everything after src down by one, then insert at src.order_index + 1.
    await Promise.all(after.map(b =>
      supabase.from(blocksTable).update({ order_index: b.order_index + 1 }).eq('id', b.id)
    ));

    const cfg = JSON.parse(JSON.stringify(src.config || {}));
    // Reassign table input cell IDs so they don't collide with the source.
    if (src.block_type === 'table' && Array.isArray(cfg.rows)) {
      let n = 0;
      cfg.rows = cfg.rows.map((row, ri) => row.map(cell => {
        if (cell?.kind === 'input') {
          n += 1;
          return { ...cell, id: `dup${ri}c${n}_${Date.now()}` };
        }
        if (cell?.kind === 'mixed') {
          return { ...cell, parts: (cell.parts || []).map(p => {
            if (p?.kind !== 'box') return p;
            n += 1;
            return { ...p, id: `dup${ri}c${n}_${Date.now()}` };
          }) };
        }
        return cell;
      }));
    }

    const { data, error: insErr } = await supabase
      .from(blocksTable)
      .insert({
        section_id: src.section_id,
        order_index: src.order_index + 1,
        block_type: src.block_type,
        config: cfg,
      })
      .select()
      .single();
    if (insErr) return { error: insErr };

    setBlocks(prev => {
      const bumped = prev.map(b =>
        b.section_id === src.section_id && b.order_index > src.order_index
          ? { ...b, order_index: b.order_index + 1 }
          : b
      );
      return [...bumped, data];
    });
    return { data };
  }, [blocks, blocksTable]);

  const createSection = useCallback(async (title = 'New section') => {
    const maxIdx = sections.reduce((m, s) => Math.max(m, s.order_index), -1);
    const { data, error: insErr } = await supabase
      .from(sectionsTable)
      .insert({ [parentFK]: parentId, title, order_index: maxIdx + 1 })
      .select()
      .single();
    if (insErr) return { error: insErr };
    setSections(prev => [...prev, data]);
    return { data };
  }, [sections, parentId, sectionsTable, parentFK]);

  const updateSectionTitle = useCallback(async (sectionId, title) => {
    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, title } : s));
    // Read back for the same reason as updateParentField: a refused rename
    // returns no error and zero rows, and would otherwise show as saved.
    const { data, error: updErr } = await supabase
      .from(sectionsTable).update({ title }).eq('id', sectionId).select('id');
    if (updErr) return { error: updErr };
    if (!data || data.length === 0) {
      return { error: new Error('That rename was not saved — you may not have permission to edit this.') };
    }
    return {};
  }, [sectionsTable]);

  const deleteSection = useCallback(async (sectionId) => {
    const { error: delErr } = await supabase.from(sectionsTable).delete().eq('id', sectionId);
    if (delErr) return { error: delErr };
    setSections(prev => prev.filter(s => s.id !== sectionId));
    setBlocks(prev => prev.filter(b => b.section_id !== sectionId));
    return {};
  }, [sectionsTable]);

  const deleteParent = useCallback(async () => {
    const { error: delErr } = await supabase.from(parentTable).delete().eq('id', parentId);
    if (delErr) return { error: delErr };
    return {};
  }, [parentId, parentTable]);

  // No moveSection here. Workbooks never needed one — exercises stay in the
  // order they were created — and assessments reorder questions inside their
  // own draft (hooks/useAssessmentDraft.js), where the move is staged with
  // everything else rather than written immediately. Adding a second
  // implementation of the same operation here would only invite the two to
  // disagree.

  const moveBlock = useCallback(async (blockId, direction) => {
    const block = blocks.find(b => b.id === blockId);
    if (!block) return;
    const sectionBlocks = blocks
      .filter(b => b.section_id === block.section_id)
      .sort((a, b) => a.order_index - b.order_index);
    const idx = sectionBlocks.findIndex(b => b.id === blockId);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sectionBlocks.length) return;
    const other = sectionBlocks[swapIdx];

    setBlocks(prev => prev.map(b =>
      b.id === block.id ? { ...b, order_index: other.order_index } :
      b.id === other.id ? { ...b, order_index: block.order_index } : b
    ));

    const results = await Promise.all([
      supabase.from(blocksTable).update({ order_index: other.order_index }).eq('id', block.id),
      supabase.from(blocksTable).update({ order_index: block.order_index }).eq('id', other.id),
    ]);
    const failed = results.find(r => r?.error);
    return failed ? { error: failed.error } : {};
  }, [blocks, blocksTable]);

  // Jump a block to the top or bottom of its section. The cheap two thirds of
  // drag-and-drop: these are the moves that cost a dozen ↑ clicks today, and
  // they need no pointer handling, no drop targets and no touch story.
  const moveBlockTo = useCallback(async (blockId, position) => {
    const block = blocks.find(b => b.id === blockId);
    if (!block) return {};
    const sectionBlocks = blocks
      .filter(b => b.section_id === block.section_id)
      .sort((a, b) => a.order_index - b.order_index);
    const from = sectionBlocks.findIndex(b => b.id === blockId);
    const to = position === 'top' ? 0 : sectionBlocks.length - 1;
    if (from === to) return {};

    // Rebuild the whole section's order rather than computing deltas — a
    // section is a handful of blocks, and a full renumber cannot leave a gap
    // or a collision behind the way an arithmetic shuffle can.
    const reordered = [...sectionBlocks];
    reordered.splice(to, 0, reordered.splice(from, 1)[0]);

    setBlocks(prev => prev.map(b => {
      const i = reordered.findIndex(r => r.id === b.id);
      return i === -1 ? b : { ...b, order_index: i };
    }));

    // Only the rows whose position actually changed are written.
    const writes = reordered
      .map((blk, i) => ({ blk, i }))
      .filter(({ blk, i }) => blk.order_index !== i)
      .map(({ blk, i }) => supabase.from(blocksTable).update({ order_index: i }).eq('id', blk.id));
    const results = await Promise.all(writes);
    const failed = results.find(r => r?.error);
    return failed ? { error: failed.error } : {};
  }, [blocks, blocksTable]);

  // ── Save tracking ─────────────────────────────────────────────────────
  // Every write below goes through `saves.track`, so the editor's one save
  // chip (SaveStatus) reflects all of them. The raw functions above are left
  // as they were; these wrappers only add the bookkeeping and the label.
  const saves = useSaveTracker();
  const { track } = saves;
  // Labels name the exercise a block sits in, read at save time.
  const namesRef = useRef({ sections: [], blocks: [] });
  namesRef.current = { sections, blocks };
  const sectionName = useCallback(id => {
    const t = namesRef.current.sections.find(s => s.id === id)?.title;
    return t ? `"${t}"` : 'a section';
  }, []);
  const inSection = useCallback(blockId => {
    const b = namesRef.current.blocks.find(x => x.id === blockId);
    return b ? ` in ${sectionName(b.section_id)}` : '';
  }, [sectionName]);

  const tracked = {
    updateParentField: useCallback(
      patch => track(`parent:${Object.keys(patch).sort().join(',')}`,
        fieldLabel(patch), () => updateParentField(patch)),
      [track, updateParentField]),
    createBlock: useCallback(
      (sectionId, ...rest) => track(`new-block:${sectionId}`, `a new block in ${sectionName(sectionId)}`,
        () => createBlock(sectionId, ...rest), { retry: false }),
      [track, createBlock, sectionName]),
    updateBlock: useCallback(
      (blockId, patch) => track(`block:${blockId}`, `a block${inSection(blockId)}`, () => updateBlock(blockId, patch)),
      [track, updateBlock, inSection]),
    deleteBlock: useCallback(
      blockId => track(`block:${blockId}`, `a deletion${inSection(blockId)}`, () => deleteBlock(blockId)),
      [track, deleteBlock, inSection]),
    moveBlock: useCallback(
      (blockId, dir) => track('order', `the block order${inSection(blockId)}`, () => moveBlock(blockId, dir), { retry: false }),
      [track, moveBlock, inSection]),
    moveBlockTo: useCallback(
      (blockId, pos) => track('order', `the block order${inSection(blockId)}`, () => moveBlockTo(blockId, pos), { retry: false }),
      [track, moveBlockTo, inSection]),
    duplicateBlock: useCallback(
      blockId => track(`dup:${blockId}`, `a copy of a block${inSection(blockId)}`, () => duplicateBlock(blockId), { retry: false }),
      [track, duplicateBlock, inSection]),
    createSection: useCallback(
      title => track('new-section', 'a new section', () => createSection(title), { retry: false }),
      [track, createSection]),
    updateSectionTitle: useCallback(
      (sectionId, title) => track(`section:${sectionId}`, `the name "${title}"`, () => updateSectionTitle(sectionId, title)),
      [track, updateSectionTitle]),
    deleteSection: useCallback(
      sectionId => track(`section:${sectionId}`, `the deletion of ${sectionName(sectionId)}`, () => deleteSection(sectionId)),
      [track, deleteSection, sectionName]),
  };

  return {
    loading, error,
    parent, sections, blocks,
    ...tracked,
    deleteParent, reload: load,
    // The page's own writes (renumbering, prep links…) can report here too.
    saves,
  };
}
