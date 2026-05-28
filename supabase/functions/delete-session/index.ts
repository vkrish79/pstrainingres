// Supabase Edge Function: delete-session
// HARD DELETES a session and everything tied to it:
//   1. Deletes the session row. The ON DELETE CASCADE chain wipes
//      session_participants, answers, participant_notes, answer_notes,
//      participant_cursor, session_focus, participant_prep,
//      participant_prep_standalone, trainer_practice, trainer_prep,
//      session_analytics, session_section_analytics.
//   2. Deletes the per-session clone workbook (is_template=false). Its
//      sections + blocks cascade.
//   3. Deletes every participant's auth account so they can no longer
//      log in (mirrors close-session — under the synthesized-email
//      identity policy each participant account is single-session).
//
// Unlike close-session this does NOT save a snapshot — the trainer
// is throwing the session away (e.g. accidental creation, scrap-and-redo).
//
// Body: { session_id }
// Auth gate (same rules as close-session): super-tier, OR vendor_manager
// of the session's vendor, OR the session's own trainer/vendor_trainer.
// Participants cannot reach this endpoint.

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

  let body: { session_id?: string };
  try { body = await req.json(); } catch { return jsonRes(400, { error: 'Invalid JSON body' }); }
  const { session_id } = body;
  if (!session_id) return jsonRes(400, { error: 'session_id is required' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ---- 1. Load session + permission check ----
  const { data: sess, error: se } = await admin
    .from('sessions')
    .select('id, vendor_id, trainer_id, workbook_id')
    .eq('id', session_id)
    .maybeSingle();
  if (se) return jsonRes(500, { error: se.message });
  if (!sess) return jsonRes(404, { error: 'Session not found' });

  const SUPER_TIER = ['super_admin', 'super_trainer'];
  const canDelete =
    SUPER_TIER.includes(caller.role) ||
    (caller.role === 'vendor_manager' && sess.vendor_id && caller.vendor_id === sess.vendor_id) ||
    ((caller.role === 'vendor_trainer' || caller.role === 'trainer') && sess.trainer_id === caller.id);
  if (!canDelete) {
    return jsonRes(403, { error: 'You do not have permission to delete this session' });
  }

  // ---- 2. Collect participant ids before the cascade removes the join rows.
  // For a closed session these are already gone (close-session deleted them),
  // so the list will simply be empty. ----
  const { data: spRows, error: spe } = await admin
    .from('session_participants').select('participant_id').eq('session_id', session_id);
  if (spe) return jsonRes(500, { error: spe.message });
  const participantIds = (spRows || []).map((r: any) => r.participant_id);

  // ---- 3. Delete the session. FK cascades wipe every session-scoped row. ----
  const { error: de } = await admin.from('sessions').delete().eq('id', session_id);
  if (de) return jsonRes(500, { error: `Session delete failed: ${de.message}` });

  // ---- 4. Delete the per-session workbook clone (sections + blocks cascade).
  // Guard: never touch the master template. ----
  let cloneDeleted = false;
  if (sess.workbook_id) {
    const { data: wb } = await admin
      .from('workbooks').select('id, is_template').eq('id', sess.workbook_id).maybeSingle();
    if (wb && wb.is_template === false) {
      const { error: wbe } = await admin.from('workbooks').delete().eq('id', wb.id);
      if (!wbe) cloneDeleted = true;
    }
  }

  // ---- 5. Delete participant auth accounts (single-session by design).
  // Per-row failures are non-fatal: the session is already gone. ----
  const deleteErrors: Array<{ id: string; error: string }> = [];
  for (const pid of participantIds) {
    const { error: ae } = await admin.auth.admin.deleteUser(pid);
    if (ae) deleteErrors.push({ id: pid, error: ae.message });
  }

  return jsonRes(200, {
    id: session_id,
    deleted: true,
    participants_deleted: participantIds.length - deleteErrors.length,
    clone_workbook_deleted: cloneDeleted,
    delete_errors: deleteErrors,
  });
});
