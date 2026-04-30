// Supabase Edge Function: create-participant
// Verifies caller is a trainer, then creates an auth user + profile row.
// Body: { email, full_name?, temp_password }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonRes(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonRes(405, { error: 'Method not allowed' });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonRes(401, { error: 'Missing Authorization header' });

  // Verify caller is a trainer (uses their JWT against RLS)
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: ue } = await userClient.auth.getUser();
  if (ue || !user) return jsonRes(401, { error: 'Invalid token' });

  const { data: caller, error: pe } = await userClient
    .from('profiles').select('role').eq('id', user.id).single();
  if (pe || caller?.role !== 'trainer') return jsonRes(403, { error: 'Not a trainer' });

  let body: { email?: string; full_name?: string; temp_password?: string };
  try { body = await req.json(); } catch { return jsonRes(400, { error: 'Invalid JSON body' }); }
  const { email, full_name, temp_password } = body;
  if (!email || !temp_password) return jsonRes(400, { error: 'email and temp_password are required' });
  if (temp_password.length < 8) return jsonRes(400, { error: 'temp_password must be at least 8 characters' });

  // Admin client
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: created, error: ce } = await admin.auth.admin.createUser({
    email,
    password: temp_password,
    email_confirm: true,
  });
  if (ce || !created.user) return jsonRes(400, { error: ce?.message || 'Failed to create auth user' });

  const { error: ie } = await admin.from('profiles').insert({
    id: created.user.id,
    full_name: full_name || email,
    email,
    role: 'participant',
    must_change_password: true,
  });
  if (ie) {
    // rollback auth user
    await admin.auth.admin.deleteUser(created.user.id);
    return jsonRes(500, { error: ie.message });
  }

  return jsonRes(200, {
    id: created.user.id,
    email,
    full_name: full_name || email,
  });
});
