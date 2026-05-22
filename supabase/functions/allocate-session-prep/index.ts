// Supabase Edge Function: allocate-session-prep
// Retroactively draws prep kits from the workbook pool for already-enrolled
// participants who have none yet. Prep is normally claimed once, at enrolment
// (add-session-participants → claim_prep_kit); if the pool was empty then, the
// participant has no prep. This lets a trainer allocate after the pool is
// filled, without re-enrolling.
//
// Body: { session_id, participant_id? }
//   - participant_id present → allocate for just that participant
//   - omitted → allocate for every enrolled participant with no prep yet
//
// Auth gate mirrors add-session-participants: super-tier OR vendor_manager of
// the session's vendor OR the session's trainer.
//
// Skips participants who already have participant_prep rows OR an allocated kit
// in this session, so it never double-consumes a kit or clobbers manual prep.
//
// Returns: { results: [{ participant_id, status, prepped? }], allocated,
//            exhausted, skipped }
// where status is 'allocated' | 'exhausted' | 'none' | 'skipped' | 'error'.

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
    .from('profiles').select('id, role, vendor_id').eq('id', user.id).single();
  const TRAINER_TIER = ['super_admin', 'super_trainer', 'vendor_manager', 'vendor_trainer', 'trainer'];
  if (pe || !caller || !TRAINER_TIER.includes(caller.role)) {
    return jsonRes(403, { error: 'Trainer-tier access required' });
  }

  let body: { session_id?: string; participant_id?: string };
  try { body = await req.json(); } catch { return jsonRes(400, { error: 'Invalid JSON body' }); }
  const { session_id, participant_id } = body;
  if (!session_id) return jsonRes(400, { error: 'session_id is required' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: sess, error: se } = await admin
    .from('sessions').select('id, vendor_id, trainer_id').eq('id', session_id).maybeSingle();
  if (se) return jsonRes(500, { error: se.message });
  if (!sess) return jsonRes(404, { error: 'Session not found' });

  const SUPER_TIER = ['super_admin', 'super_trainer'];
  const canWriteSession =
    SUPER_TIER.includes(caller.role) ||
    (caller.role === 'vendor_manager' && sess.vendor_id && caller.vendor_id === sess.vendor_id) ||
    ((caller.role === 'vendor_trainer' || caller.role === 'trainer') && sess.trainer_id === caller.id);
  if (!canWriteSession) {
    return jsonRes(403, { error: 'You do not have permission to allocate prep in this session' });
  }

  // Enrolled participants.
  const { data: enrol, error: enErr } = await admin
    .from('session_participants').select('participant_id').eq('session_id', session_id);
  if (enErr) return jsonRes(500, { error: enErr.message });
  const enrolled = new Set((enrol || []).map(r => r.participant_id as string));

  if (participant_id && !enrolled.has(participant_id)) {
    return jsonRes(404, { error: 'Participant is not enrolled in this session' });
  }

  // Who already has prep (manual or a prior kit) or an allocated kit — skip
  // them so we never double-consume or overwrite hand-entered prep.
  const [{ data: prepRows }, { data: allocatedKits }] = await Promise.all([
    admin.from('participant_prep').select('participant_id').eq('session_id', session_id),
    admin.from('workbook_prep_kits').select('consumed_participant_id')
      .eq('consumed_session_id', session_id).eq('status', 'allocated'),
  ]);
  const prepped = new Set<string>();
  (prepRows || []).forEach(r => prepped.add(r.participant_id as string));
  (allocatedKits || []).forEach(k => { if (k.consumed_participant_id) prepped.add(k.consumed_participant_id as string); });

  const candidates = participant_id ? [participant_id] : [...enrolled];

  const results: Array<{ participant_id: string; status: string; prepped?: number; reason?: string }> = [];
  let allocated = 0, exhausted = 0, skipped = 0;

  for (const pid of candidates) {
    if (prepped.has(pid)) {
      results.push({ participant_id: pid, status: 'skipped' });
      skipped++;
      continue;
    }
    const { data, error } = await admin.rpc('claim_prep_kit', {
      p_session_id: session_id, p_participant_id: pid,
    });
    if (error) {
      results.push({ participant_id: pid, status: 'error', reason: error.message });
      continue;
    }
    const status = (data as { status?: string; prepped?: number } | null)?.status || 'none';
    const prepCount = (data as { prepped?: number } | null)?.prepped;
    results.push({ participant_id: pid, status, prepped: prepCount });
    if (status === 'allocated') allocated++;
    else if (status === 'exhausted') exhausted++;
  }

  return jsonRes(200, { results, allocated, exhausted, skipped });
});
