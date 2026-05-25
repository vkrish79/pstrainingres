import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// The session-type controlled vocabulary. Writes are RLS-gated to super-tier
// (see the session_types_write policy); reads are open to any signed-in user
// because both the creation dropdown and the analytics embed need them.
//
// includeInactive: the Settings page manages the full list (active + retired);
// the creation dropdown passes false so retired types disappear from the picker
// but stay attached to past sessions for analytics.
export function useSessionTypes({ includeInactive = false } = {}) {
  const [loading, setLoading] = useState(true);
  const [types, setTypes] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from('session_types')
      .select('id, name, is_active, display_order, created_at')
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error: e } = await q;
    if (e) { setError(e.message); setLoading(false); return; }
    setTypes(data || []);
    setLoading(false);
  }, [includeInactive]);

  useEffect(() => { refresh(); }, [refresh]);

  const createType = useCallback(async (name) => {
    if (!name?.trim()) return { error: new Error('Name is required.') };
    const nextOrder = types.reduce((m, t) => Math.max(m, t.display_order || 0), 0) + 1;
    const { data, error: e } = await supabase
      .from('session_types')
      .insert({ name: name.trim(), display_order: nextOrder })
      .select()
      .single();
    if (e) {
      if (e.code === '23505') return { error: new Error(`A session type named "${name.trim()}" already exists.`) };
      return { error: new Error(e.message) };
    }
    await refresh();
    return { data };
  }, [refresh, types]);

  const renameType = useCallback(async (id, name) => {
    if (!name?.trim()) return { error: new Error('Name is required.') };
    const { error: e } = await supabase
      .from('session_types')
      .update({ name: name.trim() })
      .eq('id', id);
    if (e) {
      if (e.code === '23505') return { error: new Error(`A session type named "${name.trim()}" already exists.`) };
      return { error: new Error(e.message) };
    }
    await refresh();
    return { data: true };
  }, [refresh]);

  const setActive = useCallback(async (id, is_active) => {
    const { error: e } = await supabase
      .from('session_types')
      .update({ is_active })
      .eq('id', id);
    if (e) return { error: new Error(e.message) };
    await refresh();
    return { data: true };
  }, [refresh]);

  // Swap display_order with the adjacent row in the current sort. Seeded and
  // newly-created rows always have distinct orders, so the swap is meaningful.
  const moveType = useCallback(async (id, dir) => {
    const idx = types.findIndex(t => t.id === id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= types.length) return { data: false };
    const a = types[idx];
    const b = types[swapIdx];
    const { error: e1 } = await supabase.from('session_types').update({ display_order: b.display_order }).eq('id', a.id);
    const { error: e2 } = await supabase.from('session_types').update({ display_order: a.display_order }).eq('id', b.id);
    if (e1 || e2) return { error: new Error((e1 || e2).message) };
    await refresh();
    return { data: true };
  }, [refresh, types]);

  return { loading, error, types, createType, renameType, setActive, moveType, refresh };
}
