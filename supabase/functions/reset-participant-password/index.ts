// Supabase Edge Function: reset-participant-password
// Resets the password on a session participant's auth account, scoped to
// callers who can manage that session. Server-generates the temp password
// (consistent with add-session-participants) and re-arms must_change_password.
//
// Body: { session_id, participant_id }
// Returns: { id, username, full_name, temp_password }

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

function generateTempPassword(len = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out;
}

const SENTINEL_DOMAIN = 'pstrainingres.local';

function usernameFromEmail(email: string, joinCode: string | null): string {
  if (!email) return '';
  const suffix = joinCode ? `@${joinCode.toLowerCase()}.${SENTINEL_DOMAIN}` : '';
  if (suffix && email.toLowerCase().endsWith(suffix)) {
    return email.slice(0, email.length - suffix.length);
  }
  return email;
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
    .from('profiles').select('id, role, vendor_id').eq('id', user.id).single();
  const TRAINER_TIER = ['super_admin', 'super_trainer', 'vendor_trainer', 'trainer'];
  if (pe || !caller || !TRAINER_TIER.includes(caller.role)) {
    return jsonRes(403, { error: 'Trainer-tier access required' });
  }

  let body: { session_id?: string; participant_id?: string };
  try { body = await req.json(); } catch { return jsonRes(400, { error: 'Invalid JSON body' }); }
  const { session_id, participant_id } = body;
  if (!session_id || !participant_id) return jsonRes(400, { error: 'session_id and participant_id are required' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: sess, error: se } = await admin
    .from('sessions').select('id, vendor_id, trainer_id, join_code').eq('id', session_id).maybeSingle();
  if (se) return jsonRes(500, { error: se.message });
  if (!sess) return jsonRes(404, { error: 'Session not found' });

  const SUPER_TIER = ['super_admin', 'super_trainer'];
  const canWriteSession =
    SUPER_TIER.includes(caller.role) ||
    ((caller.role === 'vendor_trainer' || caller.role === 'trainer') && sess.trainer_id === caller.id);
  if (!canWriteSession) {
    return jsonRes(403, { error: 'You do not have permission to reset passwords in this session' });
  }

  const { data: enrolment } = await admin
    .from('session_participants')
    .select('participant_id')
    .eq('session_id', session_id)
    .eq('participant_id', participant_id)
    .maybeSingle();
  if (!enrolment) return jsonRes(404, { error: 'Participant is not enrolled in this session' });

  const { data: target, error: te } = await admin
    .from('profiles').select('id, email, full_name, role').eq('id', participant_id).maybeSingle();
  if (te) return jsonRes(500, { error: te.message });
  if (!target) return jsonRes(404, { error: 'Profile not found' });
  if (target.role !== 'participant') {
    return jsonRes(403, { error: 'This endpoint only resets passwords for participants' });
  }

  const tempPassword = generateTempPassword();

  const { error: upe } = await admin.auth.admin.updateUserById(participant_id, { password: tempPassword });
  if (upe) return jsonRes(500, { error: upe.message });

  const { error: mpe } = await admin
    .from('profiles')
    .update({ must_change_password: true })
    .eq('id', participant_id);
  if (mpe) return jsonRes(500, { error: `Password updated but flag failed: ${mpe.message}` });

  return jsonRes(200, {
    id: target.id,
    username: usernameFromEmail(target.email || '', sess.join_code || null),
    full_name: target.full_name,
    temp_password: tempPassword,
  });
});
