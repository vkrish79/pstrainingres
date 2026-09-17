import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const BUCKET = 'program-materials';

// Single-programme state for the programme page: the programme, what a class
// gets from it (workbook, assessment, PDFs), the classes made from it, and the
// unattached masters that could be attached.
//
// EVERY WRITE READS ITS ROW BACK. An update that RLS refuses comes back as 200
// with no error and no rows; without .select() the page would say "Saved" over
// a write that never happened.
export function useProgram(programId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [program, setProgram] = useState(null);
  const [workbook, setWorkbook] = useState(null);     // attached master, if any
  const [sectionCount, setSectionCount] = useState(null);
  const [assessment, setAssessment] = useState(null); // attached master, if any
  const [materials, setMaterials] = useState([]);     // program_materials rows
  const [sessions, setSessions] = useState([]);       // classes made from it
  const [freeWorkbooks, setFreeWorkbooks] = useState([]);
  const [freeAssessments, setFreeAssessments] = useState([]);
  const materialsRef = useRef([]);
  useEffect(() => { materialsRef.current = materials; }, [materials]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!programId) return;
    if (!quiet) setLoading(true);
    setError(null);
    const results = await Promise.all([
      supabase
        .from('programs')
        .select('id, title, description, status, program_type_id, created_at, updated_at, program_type:program_types ( id, name )')
        .eq('id', programId)
        .single(),
      supabase.from('workbooks').select('id, title, updated_at').eq('program_id', programId).eq('is_template', true).limit(1),
      supabase.from('assessments').select('id, title, updated_at').eq('program_id', programId).eq('is_template', true).limit(1),
      supabase
        .from('program_materials')
        .select('*')
        .eq('program_id', programId)
        .order('kind', { ascending: true })
        .order('sort_order', { ascending: true }),
      supabase
        .from('sessions')
        .select('id, name, starts_at, ends_at, closed_at, created_at, assessment_id, session_participants ( count )')
        .eq('program_id', programId),
      supabase.from('workbooks').select('id, title, updated_at').eq('is_template', true).is('program_id', null).order('updated_at', { ascending: false }),
      supabase.from('assessments').select('id, title, updated_at').eq('is_template', true).is('program_id', null).order('updated_at', { ascending: false }),
    ]);
    const firstErr = results.find(r => r.error)?.error;
    if (firstErr) { setError(firstErr.message); setLoading(false); return; }
    const [p, wbs, ass, mats, sess, fw, fa] = results.map(r => r.data);
    const wb = wbs?.[0] || null;
    setProgram(p);
    setWorkbook(wb);
    setAssessment(ass?.[0] || null);
    setMaterials(mats || []);
    setSessions((sess || []).map(s => ({ ...s, people: s.session_participants?.[0]?.count ?? 0 })));
    setFreeWorkbooks(fw || []);
    setFreeAssessments(fa || []);
    setLoading(false);

    // The section count is a nicety for the workbook slot; it must not hold
    // the page up, so it arrives after.
    if (wb) {
      const { count } = await supabase.from('sections').select('id', { count: 'exact', head: true }).eq('workbook_id', wb.id);
      setSectionCount(typeof count === 'number' ? count : null);
    } else {
      setSectionCount(null);
    }
  }, [programId]);

  useEffect(() => { load(); }, [load]);

  const updateFields = useCallback(async (patch) => {
    const { data, error: e } = await supabase
      .from('programs')
      .update(patch)
      .eq('id', programId)
      .select('id, title, description, status, program_type_id, created_at, updated_at, program_type:program_types ( id, name )');
    if (e) return { error: new Error(e.message) };
    if (!data?.length) return { error: new Error('That change was not saved. You may not have permission to edit this programme.') };
    setProgram(data[0]);
    return { data: data[0] };
  }, [programId]);

  const setStatus = useCallback((status) => updateFields({ status }), [updateFields]);

  const deleteProgram = useCallback(async () => {
    const { data, error: e } = await supabase.from('programs').delete().eq('id', programId).select('id');
    if (e) return { error: new Error(e.message) };
    if (!data?.length) return { error: new Error('The programme was not deleted. You may not have permission.') };
    return { data: true };
  }, [programId]);

  // Attach/detach set program_id on the master. Detaching never deletes it.
  const setOwner = useCallback(async (table, rowId, owner, label) => {
    const q = supabase.from(table).update({ program_id: owner }).eq('id', rowId);
    const { data, error: e } = await (owner ? q.is('program_id', null) : q).select('id');
    if (e) {
      if (e.code === '23505') return { error: new Error(`That ${label} is already attached to another programme.`) };
      return { error: new Error(e.message) };
    }
    if (!data?.length) {
      return { error: new Error(owner
        ? `That ${label} was attached somewhere else in the meantime. Pick another.`
        : `The ${label} was not detached. You may not have permission.`) };
    }
    await load({ quiet: true });
    return { data: true };
  }, [load]);

  const attachWorkbook = useCallback(id => setOwner('workbooks', id, programId, 'workbook'), [setOwner, programId]);
  const detachWorkbook = useCallback(() => (workbook ? setOwner('workbooks', workbook.id, null, 'workbook') : { data: true }), [setOwner, workbook]);
  const attachAssessment = useCallback(id => setOwner('assessments', id, programId, 'assessment'), [setOwner, programId]);
  const detachAssessment = useCallback(() => (assessment ? setOwner('assessments', assessment.id, null, 'assessment') : { data: true }), [setOwner, assessment]);

  const uploadMaterial = useCallback(async ({ file, kind, title }) => {
    if (!file) return { error: new Error('Pick a file first.') };
    if (!['handout', 'quick_ref'].includes(kind)) return { error: new Error('Invalid kind.') };
    // Path: programs/<programId>/<kind>/<timestamp>-<safe-name>
    const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const path = `programs/${programId}/${kind}/${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || 'application/pdf',
      upsert: false,
    });
    if (upErr) return { error: new Error(upErr.message) };
    // Read from the ref, not from `materials`: several files upload in one go,
    // and each must land after the one before it.
    const nextOrder = materialsRef.current
      .filter(m => m.kind === kind)
      .reduce((m, r) => Math.max(m, r.sort_order || 0), 0) + 1;
    const { data: row, error: insErr } = await supabase
      .from('program_materials')
      .insert({ program_id: programId, kind, title: title.trim(), storage_path: path, sort_order: nextOrder })
      .select()
      .single();
    if (insErr) {
      // best-effort: don't leave an orphaned object behind a failed row
      await supabase.storage.from(BUCKET).remove([path]);
      return { error: new Error(insErr.message) };
    }
    materialsRef.current = [...materialsRef.current, row];
    setMaterials(prev => [...prev, row]);
    return { data: row };
  }, [programId]);

  const updateMaterial = useCallback(async (material, patch) => {
    const { data, error: e } = await supabase
      .from('program_materials')
      .update(patch)
      .eq('id', material.id)
      .select()
      .single();
    if (e) return { error: new Error(e.message) };
    setMaterials(prev => prev.map(m => (m.id === data.id ? data : m)));
    return { data };
  }, []);

  // Move one place up (-1) or down (+1) within its group, then renumber the
  // group 1..n. Renumbering rather than swapping two values is what copes with
  // older rows that share a sort_order.
  const moveMaterial = useCallback(async (material, dir) => {
    const group = materials.filter(m => m.kind === material.kind).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const i = group.findIndex(m => m.id === material.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= group.length) return { data: true };
    [group[i], group[j]] = [group[j], group[i]];
    for (let k = 0; k < group.length; k += 1) {
      if (group[k].sort_order === k + 1) continue;
      const r = await updateMaterial(group[k], { sort_order: k + 1 });
      if (r.error) return r;
    }
    return { data: true };
  }, [materials, updateMaterial]);

  const removeMaterial = useCallback(async (material) => {
    const { data, error: delErr } = await supabase
      .from('program_materials')
      .delete()
      .eq('id', material.id)
      .select('id');
    if (delErr) return { error: new Error(delErr.message) };
    if (!data?.length) return { error: new Error('The PDF was not removed. You may not have permission.') };
    // Best-effort storage cleanup; ignore failure (object may already be gone).
    await supabase.storage.from(BUCKET).remove([material.storage_path]);
    setMaterials(prev => prev.filter(m => m.id !== material.id));
    return { data: true };
  }, []);

  const signedUrlFor = useCallback(async (material) => {
    const { data, error: e } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(material.storage_path, 60 * 10); // 10 min
    if (e) return { error: new Error(e.message) };
    return { data: data.signedUrl };
  }, []);

  return {
    loading, error, program, workbook, sectionCount, assessment, materials, sessions,
    freeWorkbooks, freeAssessments,
    updateFields, setStatus, deleteProgram,
    attachWorkbook, detachWorkbook,
    attachAssessment, detachAssessment,
    uploadMaterial, updateMaterial, moveMaterial, removeMaterial, signedUrlFor,
    refresh: load,
  };
}
