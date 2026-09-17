import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Every programme the caller can see, with what each one holds and the classes
// made from it — enough for the list's tiles, gauges and "Needs you" without a
// query per programme.
//
// FIVE FLAT QUERIES, NOT EMBEDS. workbooks, assessments and sessions all point
// at programs, and an embed across a table with more than one path back is the
// shape that has already taken a page down once (see the profiles FK note).
// Joining by program_id here costs nothing at this size.
export function usePrograms() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [programs, setPrograms] = useState([]);
  // Master workbooks not attached to any programme. A draft can only be made
  // ready by attaching one, so "none free" is worth saying out loud.
  const [freeWorkbooks, setFreeWorkbooks] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [p, wb, as, mats, sess] = await Promise.all([
      supabase
        .from('programs')
        .select('id, title, description, status, created_at, updated_at, program_type:program_types ( id, name )')
        .order('updated_at', { ascending: false }),
      supabase.from('workbooks').select('id, title, program_id').eq('is_template', true),
      supabase.from('assessments').select('id, title, program_id').eq('is_template', true).not('program_id', 'is', null),
      supabase.from('program_materials').select('id, program_id, kind'),
      supabase
        .from('sessions')
        .select('id, name, program_id, starts_at, ends_at, closed_at, created_at')
        .not('program_id', 'is', null),
    ]);
    const firstErr = [p, wb, as, mats, sess].find(r => r.error)?.error;
    if (firstErr) { setError(firstErr.message); setLoading(false); return; }

    const by = (rows, key = 'program_id') => {
      const m = new Map();
      for (const r of rows || []) {
        if (!r[key]) continue;
        if (!m.has(r[key])) m.set(r[key], []);
        m.get(r[key]).push(r);
      }
      return m;
    };
    const wbBy = by(wb.data), asBy = by(as.data), matBy = by(mats.data), sessBy = by(sess.data);

    setPrograms((p.data || []).map(x => {
      const m = matBy.get(x.id) || [];
      return {
        ...x,
        workbook: wbBy.get(x.id)?.[0] || null,
        assessment: asBy.get(x.id)?.[0] || null,
        handouts: m.filter(r => r.kind === 'handout').length,
        quickRefs: m.filter(r => r.kind === 'quick_ref').length,
        sessions: sessBy.get(x.id) || [],
      };
    }));
    setFreeWorkbooks((wb.data || []).filter(w => !w.program_id).length);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createProgram = useCallback(async ({ title, description, program_type_id, created_by }) => {
    if (!title?.trim()) return { error: new Error('Title is required.') };
    const { data, error: e } = await supabase
      .from('programs')
      .insert({
        title: title.trim(),
        description: description?.trim() || null,
        program_type_id: program_type_id || null,
        created_by: created_by || null,
      })
      .select()
      .single();
    if (e) return { error: new Error(e.message) };
    return { data };
  }, []);

  return { loading, error, programs, freeWorkbooks, createProgram, refresh };
}
