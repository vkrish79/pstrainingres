// Supabase Edge Function: delete-staff
// Verifies caller is super-tier, then HARD DELETES both the profiles row
// and the auth.users row for a vendor_manager or vendor_trainer.
// Body: { user_id }
//
// Refuses to delete super-tier accounts (super_admin / super_trainer) — those
// remain SQL-only per the locked decision in docs/vendor-trainer-model.md.

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

  let body: { user_id?: string };
  try { body = await req.json(); } catch { return jsonRes(400, { error: 'Invalid JSON body' }); }
  const { user_id } = body;
  if (!user_id) return jsonRes(400, { error: 'user_id is required' });
  if (user_id === user.id) return jsonRes(400, { error: 'Cannot delete your own account' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: target, error: te } = await admin
    .from('profiles').select('id, role').eq('id', user_id).maybeSingle();
  if (te) return jsonRes(500, { error: te.message });
  if (!target) return jsonRes(404, { error: 'Profile not found' });

  const STAFF_ROLES = ['vendor_manager', 'vendor_trainer', 'trainer'];
  if (!STAFF_ROLES.includes(target.role)) {
    return jsonRes(403, { error: 'This endpoint only deletes vendor managers / vendor trainers' });
  }

  const { error: de } = await admin.from('profiles').delete().eq('id', user_id);
  if (de) return jsonRes(500, { error: de.message });

  const { error: ae } = await admin.auth.admin.deleteUser(user_id);
  if (ae) {
    return jsonRes(500, {
      error: `Profile deleted but auth user remains: ${ae.message}. Clean up via Supabase Dashboard.`,
    });
  }

  return jsonRes(200, { id: user_id, deleted: true });
});
