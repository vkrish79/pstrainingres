import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// List of programs visible to the caller. RLS scopes to super-tier in PR1
// (vendor + participant access lands in PR3/PR4). The list page does not need
// the materials or workbook embed — those load in the editor.
export function usePrograms() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [programs, setPrograms] = useState([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('programs')
      .select(`
        id, title, description, status, updated_at,
        program_type:program_types ( id, name )
      `)
      .order('updated_at', { ascending: false });
    if (e) { setError(e.message); setLoading(false); return; }
    setPrograms(data || []);
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
    await refresh();
    return { data };
  }, [refresh]);

  const deleteProgram = useCallback(async (id) => {
    const { error: e } = await supabase.from('programs').delete().eq('id', id);
    if (e) return { error: new Error(e.message) };
    await refresh();
    return { data: true };
  }, [refresh]);

  return { loading, error, programs, createProgram, deleteProgram, refresh };
}
