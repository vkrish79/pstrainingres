import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) loadProfile(data.session.user.id);
      else setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) loadProfile(s.user.id);
      else { setProfile(null); setLoading(false); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    setProfile(data);
    setLoading(false);
  }

  async function signIn(email, password) {
    return supabase.auth.signInWithPassword({ email, password });
  }
  async function signOut() {
    await supabase.auth.signOut();
  }
  async function changePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error };
    await supabase.from('profiles').update({ must_change_password: false }).eq('id', session.user.id);
    await loadProfile(session.user.id);
    return {};
  }
  // Routes the recovery email through our edge function → Power Automate, since
  // Supabase's built-in sender isn't used in prod. Generic result (the function
  // never reveals whether the address has an account).
  async function sendPasswordReset(email) {
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/request-password-reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ email, redirectTo: `${window.location.origin}/reset-password` }),
      });
      if (!res.ok) {
        let msg = 'Could not send the reset email. Please try again.';
        try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
        return { error: new Error(msg) };
      }
      return {};
    } catch (e) {
      return { error: e instanceof Error ? e : new Error('Network error') };
    }
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signIn, signOut, changePassword, sendPasswordReset }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
