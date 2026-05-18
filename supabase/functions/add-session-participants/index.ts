// Supabase Edge Function: add-session-participants
// Adds one or more participants to a session in a single call.
//
// Identity model (D9–D11): participants are identified by a *username* that is
// unique per session, not globally. The server synthesizes an auth email of the
// form `${username}@${join_code}.pstrainingres.local` so the same username in
// two different sessions yields two independent auth accounts. If the trainer
// supplies a value containing `@`, it is treated as a real email instead.
//
// For each row, the function will:
//   - create a new auth user + profile if the synthesized email doesn't exist
//   - enrol an existing profile (same vendor) if it does
//   - mark already-enrolled rows so the UI can show "no-op"
//   - refuse rows whose email belongs to a different vendor
// The temp password is always server-generated (D8) and returned per row.
//
// Body: { session_id, participants: [{ username, full_name? }] }
// Returns: { results: [{ username, status, reason?, temp_password? }] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SENTINEL_DOMAIN = 'pstrainingres.local';
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$|^[a-z0-9]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function synthesizeEmail(username: string, joinCode: string) {
  return `${username}@${joinCode.toLowerCase()}.${SENTINEL_DOMAIN}`;
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
  const TRAINER_TIER = ['super_admin', 'super_trainer', 'vendor_manager', 'vendor_trainer', 'trainer'];
  if (pe || !caller || !TRAINER_TIER.includes(caller.role)) {
    return jsonRes(403, { error: 'Trainer-tier access required' });
  }

  let body: { session_id?: string; participants?: Array<{ username?: string; full_name?: string }> };
  try { body = await req.json(); } catch { return jsonRes(400, { error: 'Invalid JSON body' }); }
  const { session_id, participants } = body;
  if (!session_id) return jsonRes(400, { error: 'session_id is required' });
  if (!Array.isArray(participants) || participants.length === 0) {
    return jsonRes(400, { error: 'participants must be a non-empty array' });
  }
  if (participants.length > 200) return jsonRes(400, { error: 'Max 200 participants per upload' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: sess, error: se } = await admin
    .from('sessions').select('id, vendor_id, trainer_id, join_code').eq('id', session_id).maybeSingle();
  if (se) return jsonRes(500, { error: se.message });
  if (!sess) return jsonRes(404, { error: 'Session not found' });
  if (!sess.join_code) return jsonRes(500, { error: 'Session is missing a join_code — run the join_code migration' });

  const SUPER_TIER = ['super_admin', 'super_trainer'];
  const canWriteSession =
    SUPER_TIER.includes(caller.role) ||
    (caller.role === 'vendor_manager' && sess.vendor_id && caller.vendor_id === sess.vendor_id) ||
    ((caller.role === 'vendor_trainer' || caller.role === 'trainer') && sess.trainer_id === caller.id);
  if (!canWriteSession) {
    return jsonRes(403, { error: 'You do not have permission to enrol participants in this session' });
  }

  const targetVendorId = sess.vendor_id || caller.vendor_id || null;

  const results: Array<{ username: string; status: string; reason?: string; temp_password?: string }> = [];
  const seen = new Set<string>();

  for (const raw of participants) {
    const usernameInput = (raw.username || '').trim();
    if (!usernameInput) {
      results.push({ username: '(blank)', status: 'error', reason: 'missing username' });
      continue;
    }

    const isEmailForm = usernameInput.includes('@');
    const normalized = usernameInput.toLowerCase();

    if (isEmailForm) {
      if (!EMAIL_RE.test(normalized)) {
        results.push({ username: usernameInput, status: 'error', reason: 'invalid email format' });
        continue;
      }
    } else {
      if (!USERNAME_RE.test(normalized)) {
        results.push({ username: usernameInput, status: 'error', reason: 'username must be 1–64 chars of a–z, 0–9, dot, underscore, hyphen (no leading/trailing punctuation)' });
        continue;
      }
    }

    const authEmail = isEmailForm ? normalized : synthesizeEmail(normalized, sess.join_code);

    if (seen.has(authEmail)) {
      results.push({ username: usernameInput, status: 'error', reason: 'duplicate in upload' });
      continue;
    }
    seen.add(authEmail);

    const tempPassword = generateTempPassword();
    const fullName = (raw.full_name || '').trim() || usernameInput;

    const { data: existing, error: le } = await admin
      .from('profiles').select('id, role, vendor_id').eq('email', authEmail).maybeSingle();
    if (le) { results.push({ username: usernameInput, status: 'error', reason: le.message }); continue; }

    if (existing) {
      if (existing.role !== 'participant') {
        results.push({ username: usernameInput, status: 'error', reason: 'username is used by a staff/super account' });
        continue;
      }
      if (existing.vendor_id && targetVendorId && existing.vendor_id !== targetVendorId) {
        results.push({ username: usernameInput, status: 'error', reason: 'username belongs to another vendor — create a separate row per vendor' });
        continue;
      }

      const { data: enrolment } = await admin
        .from('session_participants')
        .select('participant_id')
        .eq('session_id', session_id)
        .eq('participant_id', existing.id)
        .maybeSingle();
      if (enrolment) {
        results.push({ username: usernameInput, status: 'already_enrolled' });
        continue;
      }

      const { error: ee } = await admin
        .from('session_participants')
        .insert({ session_id, participant_id: existing.id });
      if (ee) { results.push({ username: usernameInput, status: 'error', reason: ee.message }); continue; }
      results.push({ username: usernameInput, status: 'enrolled_existing' });
      continue;
    }

    const { data: created, error: ce } = await admin.auth.admin.createUser({
      email: authEmail, password: tempPassword, email_confirm: true,
    });
    if (ce || !created.user) {
      results.push({ username: usernameInput, status: 'error', reason: ce?.message || 'failed to create auth user' });
      continue;
    }

    const { error: ie } = await admin.from('profiles').insert({
      id: created.user.id,
      full_name: fullName,
      email: authEmail,
      role: 'participant',
      vendor_id: targetVendorId,
      must_change_password: true,
    });
    if (ie) {
      await admin.auth.admin.deleteUser(created.user.id);
      results.push({ username: usernameInput, status: 'error', reason: ie.message });
      continue;
    }

    const { error: ee } = await admin
      .from('session_participants')
      .insert({ session_id, participant_id: created.user.id });
    if (ee) {
      results.push({ username: usernameInput, status: 'error', reason: `created but not enrolled: ${ee.message}` });
      continue;
    }
    results.push({ username: usernameInput, status: 'created', temp_password: tempPassword });
  }

  return jsonRes(200, { results });
});
