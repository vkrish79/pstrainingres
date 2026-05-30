import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const BUCKET = 'program-materials';

// Single-program editor state: load + save core fields, attach/detach the
// master workbook, upload/remove handouts and quick-ref PDFs, toggle status.
// Workbook attachment uses workbooks.program_id (unique only on non-NULL).
export function useProgram(programId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [program, setProgram] = useState(null);
  const [workbook, setWorkbook] = useState(null);   // attached master template, if any
  const [assessment, setAssessment] = useState(null); // attached assessment template, if any
  const [materials, setMaterials] = useState([]);    // program_materials rows

  const load = useCallback(async () => {
    if (!programId) return;
    setLoading(true);
    setError(null);
    const [
      { data: p, error: e1 },
      { data: wbs, error: e2 },
      { data: ass, error: e3 },
      { data: mats, error: e4 },
    ] = await Promise.all([
      supabase
        .from('programs')
        .select(`id, title, description, status, program_type_id, created_at, updated_at`)
        .eq('id', programId)
        .single(),
      supabase
        .from('workbooks')
        .select('id, title, description, updated_at')
        .eq('program_id', programId)
        .eq('is_template', true)
        .limit(1),
      supabase
        .from('assessments')
        .select('id, title, description, updated_at')
        .eq('program_id', programId)
        .eq('is_template', true)
        .limit(1),
      supabase
        .from('program_materials')
        .select('*')
        .eq('program_id', programId)
        .order('kind', { ascending: true })
        .order('sort_order', { ascending: true }),
    ]);
    if (e1 || e2 || e3 || e4) {
      setError((e1 || e2 || e3 || e4).message);
      setLoading(false);
      return;
    }
    setProgram(p);
    setWorkbook(wbs?.[0] || null);
    setAssessment(ass?.[0] || null);
    setMaterials(mats || []);
    setLoading(false);
  }, [programId]);

  useEffect(() => { load(); }, [load]);

  const updateFields = useCallback(async (patch) => {
    const { error: e } = await supabase
      .from('programs')
      .update(patch)
      .eq('id', programId);
    if (e) return { error: new Error(e.message) };
    setProgram(prev => prev ? { ...prev, ...patch } : prev);
    return { data: true };
  }, [programId]);

  const setStatus = useCallback((status) => updateFields({ status }), [updateFields]);

  const deleteProgram = useCallback(async () => {
    const { error: e } = await supabase.from('programs').delete().eq('id', programId);
    if (e) return { error: new Error(e.message) };
    return { data: true };
  }, [programId]);

  const attachWorkbook = useCallback(async (workbookId) => {
    const { error: e } = await supabase
      .from('workbooks')
      .update({ program_id: programId })
      .eq('id', workbookId);
    if (e) {
      // Unique violation = workbook already attached to a program (shouldn't
      // surface from the picker, which filters to unattached only — but
      // guarded for race conditions).
      if (e.code === '23505') return { error: new Error('That workbook is already attached to another program.') };
      return { error: new Error(e.message) };
    }
    await load();
    return { data: true };
  }, [programId, load]);

  const detachWorkbook = useCallback(async () => {
    if (!workbook) return { data: true };
    const { error: e } = await supabase
      .from('workbooks')
      .update({ program_id: null })
      .eq('id', workbook.id);
    if (e) return { error: new Error(e.message) };
    setWorkbook(null);
    return { data: true };
  }, [workbook]);

  const attachAssessment = useCallback(async (assessmentId) => {
    const { error: e } = await supabase
      .from('assessments')
      .update({ program_id: programId })
      .eq('id', assessmentId);
    if (e) {
      if (e.code === '23505') return { error: new Error('That assessment is already attached to another program.') };
      return { error: new Error(e.message) };
    }
    await load();
    return { data: true };
  }, [programId, load]);

  const detachAssessment = useCallback(async () => {
    if (!assessment) return { data: true };
    const { error: e } = await supabase
      .from('assessments')
      .update({ program_id: null })
      .eq('id', assessment.id);
    if (e) return { error: new Error(e.message) };
    setAssessment(null);
    return { data: true };
  }, [assessment]);

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
    const nextOrder = materials
      .filter(m => m.kind === kind)
      .reduce((m, r) => Math.max(m, r.sort_order || 0), 0) + 1;
    const { data: row, error: insErr } = await supabase
      .from('program_materials')
      .insert({
        program_id: programId,
        kind,
        title: (title || file.name).trim(),
        storage_path: path,
        sort_order: nextOrder,
      })
      .select()
      .single();
    if (insErr) {
      // best-effort: orphan the storage object if the row insert failed
      await supabase.storage.from(BUCKET).remove([path]);
      return { error: new Error(insErr.message) };
    }
    setMaterials(prev => [...prev, row]);
    return { data: row };
  }, [programId, materials]);

  const removeMaterial = useCallback(async (material) => {
    const { error: delErr } = await supabase
      .from('program_materials')
      .delete()
      .eq('id', material.id);
    if (delErr) return { error: new Error(delErr.message) };
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
    loading, error, program, workbook, assessment, materials,
    updateFields, setStatus, deleteProgram,
    attachWorkbook, detachWorkbook,
    attachAssessment, detachAssessment,
    uploadMaterial, removeMaterial, signedUrlFor,
    refresh: load,
  };
}
