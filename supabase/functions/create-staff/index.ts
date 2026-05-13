// Supabase Edge Function: create-staff
// Verifies caller is super-tier (super_admin or super_trainer), then creates
// an auth user + profile row for a vendor_manager or vendor_trainer.
// Body: { email, full_name?, temp_password, role, vendor_id }

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

  let body: {
    email?: string;
    full_name?: string;
    temp_password?: string;
    role?: string;
    vendor_id?: string;
  };
  try { body = await req.json(); } catch { return jsonRes(400, { error: 'Invalid JSON body' }); }
  const { email, full_name, temp_password, role, vendor_id } = body;

  if (!email || !temp_password) return jsonRes(400, { error: 'email and temp_password are required' });
  if (temp_password.length < 8) return jsonRes(400, { error: 'temp_password must be at least 8 characters' });
  const STAFF_ROLES = ['vendor_manager', 'vendor_trainer'];
  if (!role || !STAFF_ROLES.includes(role)) {
    return jsonRes(400, { error: 'role must be vendor_manager or vendor_trainer' });
  }
  if (!vendor_id) return jsonRes(400, { error: 'vendor_id is required for staff' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Verify the vendor exists before creating the auth user (avoids orphaned
  // auth rows if the caller submits a bad vendor_id).
  const { data: vendor, error: ve } = await admin
    .from('vendors').select('id').eq('id', vendor_id).maybeSingle();
  if (ve) return jsonRes(500, { error: ve.message });
  if (!vendor) return jsonRes(400, { error: 'Vendor not found' });

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
    role,
    vendor_id,
    must_change_password: true,
  });
  if (ie) {
    await admin.auth.admin.deleteUser(created.user.id);
    return jsonRes(500, { error: ie.message });
  }

  return jsonRes(200, {
    id: created.user.id,
    email,
    full_name: full_name || email,
    role,
    vendor_id,
  });
});
