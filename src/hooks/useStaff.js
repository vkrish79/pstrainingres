import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

export function useStaff() {
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, vendor_id, must_change_password, created_at, vendors(code, name)')
      .in('role', ['vendor_manager', 'vendor_trainer', 'trainer'])
      .order('created_at', { ascending: false });
    if (e) {
      setError(e.message);
      setLoading(false);
      return;
    }
    setStaff(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createStaff = useCallback(async ({ email, full_name, temp_password, role, vendor_id }) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { error: new Error('Not authenticated') };

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-staff`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, full_name, temp_password, role, vendor_id }),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      return { error: new Error(msg) };
    }
    const data = await res.json();
    await refresh();
    return { data };
  }, [refresh]);

  const updateStaffVendor = useCallback(async (id, vendor_id) => {
    const { error: e } = await supabase
      .from('profiles')
      .update({ vendor_id })
      .eq('id', id);
    if (e) return { error: new Error(e.message) };
    await refresh();
    return { data: true };
  }, [refresh]);

  const resetStaffPassword = useCallback(async (id, temp_password) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { error: new Error('Not authenticated') };

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-staff-password`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ user_id: id, temp_password }),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      return { error: new Error(msg) };
    }
    const data = await res.json();
    await refresh();
    return { data };
  }, [refresh]);

  const deleteStaff = useCallback(async (id) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { error: new Error('Not authenticated') };

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-staff`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ user_id: id }),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      return { error: new Error(msg) };
    }
    await refresh();
    return { data: true };
  }, [refresh]);

  return { loading, error, staff, createStaff, updateStaffVendor, resetStaffPassword, deleteStaff, refresh };
}
