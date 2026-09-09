import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.js';

// Generalized content-editor state for any parent-with-sections-with-blocks
// shape (workbooks today, assessments next). kindConfig pins the table names
// and the FK column so the same load/save/reorder logic serves both.
//
// kindConfig: { parentTable, sectionsTable, blocksTable, parentFK }
//   parentTable  — e.g. 'workbooks' | 'assessments'
//   sectionsTable — e.g. 'sections' | 'assessment_sections'
//   blocksTable   — e.g. 'blocks' | 'assessment_blocks'
//   parentFK      — section column referencing the parent (e.g. 'workbook_id')
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
      setError(msg);
      return { error: new Error(msg) };
    }
    setError(null);
    return {};
  }, [parentTable, parentId]);

  const createBlock = useCallback(async (sectionId, blockType, config = {}) => {
    const sectionBlocks = blocks.filter(b => b.section_id === sectionId);
    const maxIdx = sectionBlocks.reduce((m, b) => Math.max(m, b.order_index), -1);
    const { data, error: insErr } = await supabase
      .from(blocksTable)
      .insert({ section_id: sectionId, order_index: maxIdx + 1, block_type: blockType, config })
      .select()
      .single();
    if (insErr) return { error: insErr };
    setBlocks(prev => [...prev, data]);
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
    const { error: updErr } = await supabase
      .from(sectionsTable).update({ title }).eq('id', sectionId);
    return updErr ? { error: updErr } : {};
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

    await Promise.all([
      supabase.from(blocksTable).update({ order_index: other.order_index }).eq('id', block.id),
      supabase.from(blocksTable).update({ order_index: block.order_index }).eq('id', other.id),
    ]);
  }, [blocks, blocksTable]);

  return {
    loading, error,
    parent, sections, blocks,
    updateParentField,
    createBlock, updateBlock, deleteBlock, moveBlock, duplicateBlock,
    createSection, updateSectionTitle, deleteSection,
    deleteParent, reload: load,
  };
}
