import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

export function useParticipants() {
  const [loading, setLoading] = useState(true);
  const [participants, setParticipants] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('profiles')
      .select('id, full_name, email, must_change_password, created_at')
      .eq('role', 'participant')
      .order('created_at', { ascending: false });
    if (e) setError(e.message);
    setParticipants(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createParticipant = useCallback(async ({ email, full_name, temp_password }) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { error: new Error('Not authenticated') };

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-participant`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, full_name, temp_password }),
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

  return { loading, error, participants, createParticipant, refresh };
}

export function generateTempPassword(len = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out;
}
