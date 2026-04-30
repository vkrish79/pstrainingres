import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';

export function useWorkbookEditor(workbookId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [workbook, setWorkbook] = useState(null);
  const [sections, setSections] = useState([]);
  const [blocks, setBlocks] = useState([]);

  useEffect(() => {
    if (!workbookId) return;
    let cancelled = false;
    (async () => {
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

        if (cancelled) return;
        setWorkbook(wb);
        setSections(secs || []);
        setBlocks(blks || []);
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setError(err.message); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [workbookId]);

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
  };
}
