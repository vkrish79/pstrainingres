// Supabase Edge Function: reset-staff-password
// Verifies caller is super-tier, then resets the password on a staff
// account (vendor_manager or vendor_trainer) and re-arms must_change_password.
// Body: { user_id, temp_password }
//
// Refuses to reset super-tier accounts (those remain SQL/dashboard-only).

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

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: ue } = await userClient.auth.getUser();
  if (ue || !user) return jsonRes(401, { error: 'Invalid token' });

  const { data: caller, error: pe } = await userClient
    .from('profiles').select('role').eq('id', user.id).single();
  const SUPER_TIER = ['super_admin', 'super_trainer'];
  if (pe || !caller || !SUPER_TIER.includes(caller.role)) {
    return jsonRes(403, { error: 'Super-tier access required' });
  }

  let body: { user_id?: string; temp_password?: string };
  try { body = await req.json(); } catch { return jsonRes(400, { error: 'Invalid JSON body' }); }
  const { user_id, temp_password } = body;
  if (!user_id || !temp_password) return jsonRes(400, { error: 'user_id and temp_password are required' });
  if (temp_password.length < 8) return jsonRes(400, { error: 'temp_password must be at least 8 characters' });
  if (user_id === user.id) return jsonRes(400, { error: 'Use Change password for your own account' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: target, error: te } = await admin
    .from('profiles').select('id, email, full_name, role').eq('id', user_id).maybeSingle();
  if (te) return jsonRes(500, { error: te.message });
  if (!target) return jsonRes(404, { error: 'Profile not found' });

  const STAFF_ROLES = ['vendor_manager', 'vendor_trainer', 'trainer'];
  if (!STAFF_ROLES.includes(target.role)) {
    return jsonRes(403, { error: 'This endpoint only resets passwords for vendor managers / vendor trainers' });
  }

  const { error: upe } = await admin.auth.admin.updateUserById(user_id, { password: temp_password });
  if (upe) return jsonRes(500, { error: upe.message });

  const { error: mpe } = await admin
    .from('profiles')
    .update({ must_change_password: true })
    .eq('id', user_id);
  if (mpe) return jsonRes(500, { error: `Password updated but flag failed: ${mpe.message}` });

  return jsonRes(200, {
    id: target.id,
    email: target.email,
    full_name: target.full_name,
  });
});
