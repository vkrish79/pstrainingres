import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Template-only list of assessments visible to the caller. RLS scopes to
// super-tier in PR2a; vendor + participant access lands in PR4. The embed
// surfaces program-attachment so the list page can flag orphan templates.
//
// `kind` picks which library this is. A question bank is an assessments row
// with kind='bank' — one model, not two, the same way a quiz template and a
// session's quiz share one table. Both libraries therefore share this hook, and
// the filter is not optional: without it banks would surface in the assessments
// list and, worse, in the pickers that attach an assessment to a programme.
export function useAssessments({ kind = 'assessment' } = {}) {
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
      .eq('kind', kind)
      .order('updated_at', { ascending: false });
    if (e) { setError(e.message); setLoading(false); return; }
    setAssessments(data || []);
    setLoading(false);
  }, [kind]);

  useEffect(() => { refresh(); }, [refresh]);

  const createAssessment = useCallback(async ({ title, description, created_by }) => {
    if (!title?.trim()) return { error: new Error('Title is required.') };
    const { data, error: e } = await supabase
      .from('assessments')
      .insert({
        title: title.trim(),
        description: description?.trim() || null,
        created_by: created_by || null,
        // Explicit rather than leaning on the column default, so the call site
        // reads as "this creates a bank" / "this creates an assessment".
        kind,
      })
      .select()
      .single();
    if (e) return { error: new Error(e.message) };
    await refresh();
    return { data };
  }, [refresh, kind]);

  const deleteAssessment = useCallback(async (id) => {
    const { error: e } = await supabase.from('assessments').delete().eq('id', id);
    if (e) return { error: new Error(e.message) };
    await refresh();
    return { data: true };
  }, [refresh]);

  return { loading, error, assessments, createAssessment, deleteAssessment, refresh };
}
