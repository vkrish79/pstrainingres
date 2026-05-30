import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Template-only list of assessments visible to the caller. RLS scopes to
// super-tier in PR2a; vendor + participant access lands in PR4. The embed
// surfaces program-attachment so the list page can flag orphan templates.
export function useAssessments() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [assessments, setAssessments] = useState([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('assessments')
      .select(`
        id, title, description, program_id, updated_at,
        program:programs ( id, title )
      `)
      .eq('is_template', true)
      .order('updated_at', { ascending: false });
    if (e) { setError(e.message); setLoading(false); return; }
    setAssessments(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createAssessment = useCallback(async ({ title, description, created_by }) => {
    if (!title?.trim()) return { error: new Error('Title is required.') };
    const { data, error: e } = await supabase
      .from('assessments')
      .insert({
        title: title.trim(),
        description: description?.trim() || null,
        created_by: created_by || null,
      })
      .select()
      .single();
    if (e) return { error: new Error(e.message) };
    await refresh();
    return { data };
  }, [refresh]);

  const deleteAssessment = useCallback(async (id) => {
    const { error: e } = await supabase.from('assessments').delete().eq('id', id);
    if (e) return { error: new Error(e.message) };
    await refresh();
    return { data: true };
  }, [refresh]);

  return { loading, error, assessments, createAssessment, deleteAssessment, refresh };
}
