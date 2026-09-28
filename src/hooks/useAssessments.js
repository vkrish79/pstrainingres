import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { isFillableBlock } from '../lib/blockHelpers.js';
import { isInactiveBlock } from '../lib/assessmentScoring.js';
import { classSummary } from '../lib/programReadiness.js';

// Template-only list of assessments visible to the caller. RLS scopes to
// super-tier in PR2a; vendor + participant access lands in PR4. The embed
// surfaces program-attachment so the list page can flag orphan templates.
//
// `kind` picks which library this is. A question bank is an assessments row
// with kind='bank' — one model, not two, the same way a quiz template and a
// session's quiz share one table. Both libraries therefore share this hook, and
// the filter is not optional: without it banks would surface in the assessments
// list and, worse, in the pickers that attach an assessment to a programme.
// `detail` — also load what each paper contains and the classes run from it.
// Off by default: the question bank uses this hook too, and none of it applies
// there.
export function useAssessments({ kind = 'assessment', detail = false } = {}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [assessments, setAssessments] = useState([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('assessments')
      .select(`
        id, title, description, program_id, updated_at, pass_mark,
        program:programs ( id, title )
      `)
      .eq('is_template', true)
      .eq('kind', kind)
      .order('updated_at', { ascending: false });
    if (e) { setError(e.message); setLoading(false); return; }

    const rows = data || [];
    if (!detail) { setAssessments(rows); setLoading(false); return; }

    // WHAT EACH PAPER IS AND WHETHER IT IS FINISHED, not just its title. An
    // assessment with no pass mark prints a blank Result on every report it
    // ever appears on, and a question with no answer key cannot be marked at
    // all — neither is visible from a list of names and dates.
    //
    // OPT-IN, because the question bank shares this hook and none of it means
    // anything there: a bank is not attached to a programme and no class is
    // ever run from one.
    //
    // FLAT QUERIES past the embed above: several tables point back at
    // assessments, and an un-hinted embed across a table with more than one
    // path has taken a live page down here before.
    const ids = rows.map(a => a.id);
    const programIds = [...new Set(rows.map(a => a.program_id).filter(Boolean))];

    const [secs, sess] = await Promise.all([
      ids.length
        ? supabase.from('assessment_sections').select('id, assessment_id').in('assessment_id', ids)
        : Promise.resolve({ data: [] }),
      programIds.length
        ? supabase.from('sessions')
          .select('id, name, program_id, starts_at, ends_at, closed_at, created_at')
          .in('program_id', programIds)
        : Promise.resolve({ data: [] }),
    ]);

    const sectionIds = (secs.data || []).map(x => x.id);
    const { data: blks } = sectionIds.length
      ? await supabase.from('assessment_blocks').select('*').in('section_id', sectionIds)
      : { data: [] };
    const blockIds = (blks || []).map(b => b.id);
    const { data: keys } = blockIds.length
      ? await supabase.from('assessment_answer_keys')
        .select('assessment_block_id, points').in('assessment_block_id', blockIds)
      : { data: [] };

    const asmtOfSection = new Map((secs.data || []).map(x => [x.id, x.assessment_id]));
    const pointsOf = new Map((keys || []).map(k => [k.assessment_block_id, Number(k.points) || 0]));
    const sessByProgram = new Map();
    for (const s of sess.data || []) {
      if (!sessByProgram.has(s.program_id)) sessByProgram.set(s.program_id, []);
      sessByProgram.get(s.program_id).push(s);
    }

    const paper = new Map(ids.map(id => [id, { questions: 0, marks: 0, unkeyed: 0 }]));
    for (const b of blks || []) {
      // A withdrawn question is out of the paper entirely — the same filter
      // every total on the marking side applies.
      if (!isFillableBlock(b) || isInactiveBlock(b)) continue;
      const row = paper.get(asmtOfSection.get(b.section_id));
      if (!row) continue;
      row.questions += 1;
      if (pointsOf.has(b.id)) row.marks += pointsOf.get(b.id);
      else row.unkeyed += 1;
    }

    setAssessments(rows.map(a => ({
      ...a,
      paper: paper.get(a.id) || { questions: 0, marks: 0, unkeyed: 0 },
      // classSummary rather than counting here, so this page and Programmes
      // cannot disagree about what "running" means.
      classes: classSummary(sessByProgram.get(a.program_id) || []),
    })));
    setLoading(false);
  }, [kind, detail]);

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
