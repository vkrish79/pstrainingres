import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

export const CITY_CODE_PATTERN = /^[A-Z0-9]{2,6}$/;

// The city/venue controlled vocabulary, mirroring useProgramTypes. Writes are
// RLS-gated to super-tier; reads are open to any signed-in user (the creation
// dropdown and analytics labels need them). The `code` is the value stored on
// sessions.city_code, so it's immutable after creation (only name/active/order
// are editable) — changing it would orphan sessions holding the old code.
export function useCities({ includeInactive = false } = {}) {
  const [loading, setLoading] = useState(true);
  const [cities, setCities] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase
      .from('cities')
      .select('id, code, name, is_active, display_order, created_at')
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error: e } = await q;
    if (e) { setError(e.message); setLoading(false); return; }
    setCities(data || []);
    setLoading(false);
  }, [includeInactive]);

  useEffect(() => { refresh(); }, [refresh]);

  const createCity = useCallback(async (code, name) => {
    const c = (code || '').trim().toUpperCase();
    if (!CITY_CODE_PATTERN.test(c)) {
      return { error: new Error('Code must be 2–6 chars, uppercase letters / digits.') };
    }
    if (!name?.trim()) return { error: new Error('Name is required.') };
    const nextOrder = cities.reduce((m, t) => Math.max(m, t.display_order || 0), 0) + 1;
    const { data, error: e } = await supabase
      .from('cities')
      .insert({ code: c, name: name.trim(), display_order: nextOrder })
      .select()
      .single();
    if (e) {
      if (e.code === '23505') return { error: new Error(`A city with code "${c}" already exists.`) };
      return { error: new Error(e.message) };
    }
    await refresh();
    return { data };
  }, [refresh, cities]);

  const renameCity = useCallback(async (id, name) => {
    if (!name?.trim()) return { error: new Error('Name is required.') };
    const { error: e } = await supabase.from('cities').update({ name: name.trim() }).eq('id', id);
    if (e) return { error: new Error(e.message) };
    await refresh();
    return { data: true };
  }, [refresh]);

  const setActive = useCallback(async (id, is_active) => {
    const { error: e } = await supabase.from('cities').update({ is_active }).eq('id', id);
    if (e) return { error: new Error(e.message) };
    await refresh();
    return { data: true };
  }, [refresh]);

  const moveCity = useCallback(async (id, dir) => {
    const idx = cities.findIndex(t => t.id === id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= cities.length) return { data: false };
    const a = cities[idx];
    const b = cities[swapIdx];
    const { error: e1 } = await supabase.from('cities').update({ display_order: b.display_order }).eq('id', a.id);
    const { error: e2 } = await supabase.from('cities').update({ display_order: a.display_order }).eq('id', b.id);
    if (e1 || e2) return { error: new Error((e1 || e2).message) };
    await refresh();
    return { data: true };
  }, [refresh, cities]);

  return { loading, error, cities, createCity, renameCity, setActive, moveCity, refresh };
}
