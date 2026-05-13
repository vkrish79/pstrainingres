import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

export const VENDOR_CODE_PATTERN = /^[A-Z0-9_]{2,12}$/;

export function useVendors() {
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [{ data: vendorRows, error: vErr }, { data: profileRows, error: pErr }, { data: sessionRows, error: sErr }] =
      await Promise.all([
        supabase.from('vendors').select('id, code, name, created_at').order('name', { ascending: true }),
        supabase.from('profiles').select('vendor_id, role').in('role', ['vendor_manager', 'vendor_trainer']),
        supabase.from('sessions').select('vendor_id'),
      ]);

    if (vErr || pErr || sErr) {
      setError((vErr || pErr || sErr).message);
      setLoading(false);
      return;
    }

    const trainerCount = new Map();
    for (const p of profileRows || []) {
      if (!p.vendor_id) continue;
      trainerCount.set(p.vendor_id, (trainerCount.get(p.vendor_id) || 0) + 1);
    }
    const sessionCount = new Map();
    for (const s of sessionRows || []) {
      if (!s.vendor_id) continue;
      sessionCount.set(s.vendor_id, (sessionCount.get(s.vendor_id) || 0) + 1);
    }

    setVendors(
      (vendorRows || []).map(v => ({
        ...v,
        trainer_count: trainerCount.get(v.id) || 0,
        session_count: sessionCount.get(v.id) || 0,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createVendor = useCallback(async ({ code, name }) => {
    if (!VENDOR_CODE_PATTERN.test(code)) {
      return { error: new Error('Code must be 2–12 chars, uppercase letters / digits / underscores.') };
    }
    if (!name?.trim()) return { error: new Error('Name is required.') };

    const { data, error: e } = await supabase
      .from('vendors')
      .insert({ code: code.trim(), name: name.trim() })
      .select()
      .single();
    if (e) {
      if (e.code === '23505') return { error: new Error(`A vendor with code "${code}" already exists.`) };
      return { error: new Error(e.message) };
    }
    await refresh();
    return { data };
  }, [refresh]);

  const renameVendor = useCallback(async (id, name) => {
    if (!name?.trim()) return { error: new Error('Name is required.') };
    const { error: e } = await supabase
      .from('vendors')
      .update({ name: name.trim() })
      .eq('id', id);
    if (e) return { error: new Error(e.message) };
    await refresh();
    return { data: true };
  }, [refresh]);

  const deleteVendor = useCallback(async (id) => {
    // Block when in use. Caller should pre-check via trainer_count/session_count,
    // but we also let the DB-side FK do its job as a last resort.
    const { error: e } = await supabase.from('vendors').delete().eq('id', id);
    if (e) return { error: new Error(e.message) };
    await refresh();
    return { data: true };
  }, [refresh]);

  return { loading, error, vendors, createVendor, renameVendor, deleteVendor, refresh };
}
