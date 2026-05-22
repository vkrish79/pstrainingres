// Supabase Edge Function: delete-participant
// HARD DELETES a participant: removes the auth.users row, which cascades
// through profiles → session_participants → answers via the schema's
// ON DELETE CASCADE chain.
//
// Body: { session_id, participant_id }
// Auth gate (mirrors add-session-participants): super-tier OR
// vendor_manager of the session's vendor OR the session's trainer.
//
// Assumption: under the plain-username identity policy every participant
// account is single-session by design (the synthesized email embeds the
// join code, so each session yields a distinct auth account). If real-email
// participants enrolled across multiple sessions are ever supported, this
// function will need to switch to "un-enrol only when other enrolments
// exist, hard-delete otherwise."

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
  if (!participant_id) return jsonRes(400, { error: 'participant_id is required' });
  if (participant_id === user.id) return jsonRes(400, { error: 'Cannot delete your own account' });

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
    return jsonRes(403, { error: 'You do not have permission to delete participants in this session' });
  }

  const { data: target, error: te } = await admin
    .from('profiles').select('id, role').eq('id', participant_id).maybeSingle();
  if (te) return jsonRes(500, { error: te.message });
  if (!target) return jsonRes(404, { error: 'Participant not found' });
  if (target.role !== 'participant') {
    return jsonRes(403, { error: 'This endpoint only deletes participant accounts' });
  }

  // Return any prep kit this participant held back to the pool before deleting
  // them (individual delete frees the kit; session-close keeps it consumed).
  await admin.rpc('release_prep_kit', { p_session_id: session_id, p_participant_id: participant_id });

  // auth.users delete cascades to profiles → session_participants → answers.
  const { error: ae } = await admin.auth.admin.deleteUser(participant_id);
  if (ae) return jsonRes(500, { error: ae.message });

  return jsonRes(200, { id: participant_id, deleted: true });
});
