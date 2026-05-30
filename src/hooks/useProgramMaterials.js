import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const BUCKET = 'program-materials';

// Read-only materials list for a session-bound caller (trainer or participant).
// RLS on program_materials gates access: super, vendor-on-session, trainer-on-
// session, or enrolled participant. Storage signed URLs use the same chain.
export function useProgramMaterials(sessionId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [materials, setMaterials] = useState([]);

  useEffect(() => {
    if (!sessionId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: s, error: e1 } = await supabase
        .from('sessions')
        .select('program_id')
        .eq('id', sessionId)
        .single();
      if (e1) {
        if (!cancelled) { setError(e1.message); setLoading(false); }
        return;
      }
      if (!s?.program_id) {
        if (!cancelled) { setMaterials([]); setLoading(false); }
        return;
      }
      const { data: mats, error: e2 } = await supabase
        .from('program_materials')
        .select('id, program_id, kind, title, storage_path, sort_order')
        .eq('program_id', s.program_id)
        .order('kind', { ascending: true })
        .order('sort_order', { ascending: true });
      if (cancelled) return;
      if (e2) { setError(e2.message); setLoading(false); return; }
      setMaterials(mats || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const signedUrlFor = useCallback(async (material) => {
    const { data, error: e } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(material.storage_path, 60 * 10);
    if (e) return { error: new Error(e.message) };
    return { data: data.signedUrl };
  }, []);

  return { loading, error, materials, signedUrlFor };
}
