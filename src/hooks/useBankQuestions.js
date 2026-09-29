import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// One question bank's questions, for READING — browsing the bank before you
// edit it, or picking out of it.
//
// A question is a SECTION holding one or more blocks, so this returns the
// sections in order, the blocks grouped under them, and the answer keys by
// block id. That last part is why the hook exists rather than a query at the
// call site: the key is what a trainer is actually judging when they skim a
// bank, and reading it takes three round trips that are easy to get subtly
// wrong (group sections are banners and hold nothing; blocks must come back in
// order_index or the question reads scrambled).
//
// SAFE HERE AND NOWHERE NEAR A CANDIDATE. assessment_answer_keys has no
// participant policy at all, and every caller of this hook is behind the
// super-trainer gate. Nothing on an answering path may use it.
export function useBankQuestions(bankId) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sections, setSections] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [keys, setKeys] = useState({});     // { [blockId]: correct answer }
  const [usage, setUsage] = useState({});   // { [sectionId]: how many papers took it }

  const load = useCallback(async () => {
    if (!bankId) { setSections([]); setBlocks([]); setKeys({}); setUsage({}); setError(''); return; }
    setLoading(true);
    setError('');
    try {
      const { data: secsAll, error: e1 } = await supabase
        .from('assessment_sections')
        .select('id, title, order_index, kind, tags')
        .eq('assessment_id', bankId)
        .order('order_index');
      if (e1) throw e1;
      // Group sections are Word-H1 banners: they hold no question.
      const secs = (secsAll || []).filter(s => s.kind !== 'group');
      const ids = secs.map(s => s.id);

      const { data: blks, error: e2 } = ids.length
        ? await supabase
          .from('assessment_blocks')
          .select('id, section_id, block_type, config, order_index')
          .in('section_id', ids)
          .order('order_index')
        : { data: [], error: null };
      if (e2) throw e2;

      const blockIds = (blks || []).map(b => b.id);
      const { data: keyRows, error: e3 } = blockIds.length
        ? await supabase
          .from('assessment_answer_keys')
          .select('assessment_block_id, key')
          .in('assessment_block_id', blockIds)
        : { data: [], error: null };
      if (e3) throw e3;

      // How many papers took each question. The picker blocks a second copy of
      // the same question in one paper, so a copy is a paper.
      const { data: copies } = ids.length
        ? await supabase
          .from('assessment_sections')
          .select('source_bank_section_id')
          .in('source_bank_section_id', ids)
        : { data: [] };
      const used = {};
      for (const c of copies || []) {
        if (!c.source_bank_section_id) continue;
        used[c.source_bank_section_id] = (used[c.source_bank_section_id] || 0) + 1;
      }

      setSections(secs);
      setBlocks(blks || []);
      setUsage(used);
      setKeys(Object.fromEntries((keyRows || []).map(k => [k.assessment_block_id, k.key])));
    } catch (e) {
      setError(e.message || String(e));
      setSections([]); setBlocks([]); setKeys({}); setUsage({});
    } finally {
      setLoading(false);
    }
  }, [bankId]);

  useEffect(() => { load(); }, [load]);

  return { loading, error, sections, blocks, keys, usage, reload: load };
}
