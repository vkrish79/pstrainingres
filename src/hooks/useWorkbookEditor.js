import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';

export function useWorkbookEditor(workbookId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [workbook, setWorkbook] = useState(null);
  const [sections, setSections] = useState([]);
  const [blocks, setBlocks] = useState([]);

  const load = useCallback(async () => {
    if (!workbookId) return;
    try {
      const { data: wb, error: e1 } = await supabase
        .from('workbooks').select('*').eq('id', workbookId).single();
      if (e1) throw e1;

      const { data: secs, error: e2 } = await supabase
        .from('sections').select('*').eq('workbook_id', workbookId).order('order_index');
      if (e2) throw e2;

      const sectionIds = (secs || []).map(s => s.id);
      const { data: blks, error: e3 } = sectionIds.length
        ? await supabase.from('blocks').select('*').in('section_id', sectionIds).order('order_index')
        : { data: [], error: null };
      if (e3) throw e3;

      setWorkbook(wb);
      setSections(secs || []);
      setBlocks(blks || []);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [workbookId]);

  useEffect(() => { load(); }, [load]);

  const updateWorkbookTitle = useCallback(async (title) => {
    setWorkbook(w => ({ ...w, title }));
    await supabase.from('workbooks').update({ title }).eq('id', workbookId);
  }, [workbookId]);

  const createBlock = useCallback(async (sectionId, blockType, config = {}) => {
    const sectionBlocks = blocks.filter(b => b.section_id === sectionId);
    const maxIdx = sectionBlocks.reduce((m, b) => Math.max(m, b.order_index), -1);
    const { data, error: insErr } = await supabase
      .from('blocks')
      .insert({ section_id: sectionId, order_index: maxIdx + 1, block_type: blockType, config })
      .select()
      .single();
    if (insErr) return { error: insErr };
    setBlocks(prev => [...prev, data]);
    return { data };
  }, [blocks]);

  const updateBlock = useCallback(async (blockId, patch) => {
    const { data, error: updErr } = await supabase
      .from('blocks')
      .update(patch)
      .eq('id', blockId)
      .select()
      .single();
    if (updErr) return { error: updErr };
    setBlocks(prev => prev.map(b => b.id === blockId ? data : b));
    return { data };
  }, []);

  const deleteBlock = useCallback(async (blockId) => {
    const { error: delErr } = await supabase.from('blocks').delete().eq('id', blockId);
    if (delErr) return { error: delErr };
    setBlocks(prev => prev.filter(b => b.id !== blockId));
    return {};
  }, []);

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
      supabase.from('blocks').update({ order_index: b.order_index + 1 }).eq('id', b.id)
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
      .from('blocks')
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
  }, [blocks]);

  const createSection = useCallback(async (title = 'New section') => {
    const maxIdx = sections.reduce((m, s) => Math.max(m, s.order_index), -1);
    const { data, error: insErr } = await supabase
      .from('sections')
      .insert({ workbook_id: workbookId, title, order_index: maxIdx + 1 })
      .select()
      .single();
    if (insErr) return { error: insErr };
    setSections(prev => [...prev, data]);
    return { data };
  }, [sections, workbookId]);

  const updateSectionTitle = useCallback(async (sectionId, title) => {
    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, title } : s));
    const { error: updErr } = await supabase
      .from('sections').update({ title }).eq('id', sectionId);
    return updErr ? { error: updErr } : {};
  }, []);

  const deleteSection = useCallback(async (sectionId) => {
    const { error: delErr } = await supabase.from('sections').delete().eq('id', sectionId);
    if (delErr) return { error: delErr };
    setSections(prev => prev.filter(s => s.id !== sectionId));
    setBlocks(prev => prev.filter(b => b.section_id !== sectionId));
    return {};
  }, []);

  const deleteWorkbook = useCallback(async () => {
    const { error: delErr } = await supabase.from('workbooks').delete().eq('id', workbookId);
    if (delErr) return { error: delErr };
    return {};
  }, [workbookId]);

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
      supabase.from('blocks').update({ order_index: other.order_index }).eq('id', block.id),
      supabase.from('blocks').update({ order_index: block.order_index }).eq('id', other.id),
    ]);
  }, [blocks]);

  return {
    loading, error,
    workbook, sections, blocks,
    updateWorkbookTitle, createBlock, updateBlock, deleteBlock, moveBlock,
    duplicateBlock, createSection, updateSectionTitle, deleteSection,
    deleteWorkbook, reload: load,
  };
}
