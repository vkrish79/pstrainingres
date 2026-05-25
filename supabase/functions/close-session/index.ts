// Supabase Edge Function: close-session
// Builds a JSON snapshot of the session (metadata, workbook structure,
// participants with names + answers + their section notes, trainer
// notes/flags), persists it to sessions.closed_summary, sets
// closed_at + closed_by, then HARD DELETES every participant. The
// FK cascade chain (auth.users -> profiles -> session_participants
// -> answers -> participant_notes -> answer_notes) wipes their data.
//
// Auth: super-tier OR vendor_manager of the session's vendor OR the
// session's trainer.
//
// Body: { session_id }
// Returns: { id, closed_at, closed_summary } on success.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SNAPSHOT_SCHEMA_VERSION = 1;

function jsonRes(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ---- Analytics computation. Operates on the snapshot shape (block.type /
// block.config), so the identical logic can backfill from closed_summary.
// Mirrors src/lib/blockHelpers.js (isFillableBlock / isAnswered). ----
function isFillable(b: any): boolean {
  if (!b) return false;
  if (b.type === 'field') return true;
  if (b.type === 'table') return ((b.config?.rows || []) as any[]).some((row) => (row || []).some((cell: any) => cell?.kind === 'input'));
  return false;
}
function isAnswered(b: any, value: any): boolean {
  if (value == null) return false;
  if (b.type === 'field') {
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === 'string' && value.trim() !== '';
  }
  if (b.type === 'table') {
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value).some((v: any) => (Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== ''));
  }
  return false;
}
const round2 = (x: number) => Math.round(x * 100) / 100;

function computeAnalytics(snap: any) {
  const sess = snap.session || {};
  const wb = snap.workbook || {};
  const sections: any[] = wb.sections || [];
  const participants: any[] = snap.participants || [];
  const trainerNotes: any[] = snap.trainer_notes || [];
  const pc = participants.length;

  // block_id -> section_id over ALL blocks (a flag can sit on any block).
  const blockSection: Record<string, string> = {};
  for (const s of sections) for (const b of s.blocks || []) blockSection[b.id] = s.id;

  let flaggedCount = 0;
  let trainerNotedCount = 0;
  const flagsBySection: Record<string, number> = {};
  for (const n of trainerNotes) {
    if (n.flag) {
      flaggedCount += 1;
      const sid = blockSection[n.block_id];
      if (sid) flagsBySection[sid] = (flagsBySection[sid] || 0) + 1;
    }
    if (n.note && String(n.note).trim() !== '') trainerNotedCount += 1;
  }

  let blockCount = 0;
  let answeredTotal = 0;
  let firstAct: number | null = null;
  let lastAct: number | null = null;
  const answeredByP: Record<string, number> = {};
  const sectionRows: any[] = [];

  for (const s of sections) {
    const fb = (s.blocks || []).filter(isFillable);
    blockCount += fb.length;
    let secAnswered = 0;
    for (const p of participants) {
      for (const b of fb) {
        const entry = p.answers?.[b.id];
        if (entry && isAnswered(b, entry.value)) {
          secAnswered += 1;
          answeredByP[p.id] = (answeredByP[p.id] || 0) + 1;
        }
        const ts = entry?.updated_at ? new Date(entry.updated_at).getTime() : NaN;
        if (!Number.isNaN(ts)) {
          if (firstAct === null || ts < firstAct) firstAct = ts;
          if (lastAct === null || ts > lastAct) lastAct = ts;
        }
      }
    }
    const secTotal = fb.length * pc;
    answeredTotal += secAnswered;
    sectionRows.push({
      section_id: s.id,
      workbook_id: wb.id || null,
      title: s.title ?? null,
      order_index: s.order_index ?? null,
      block_count: fb.length,
      participant_count: pc,
      total_slots: secTotal,
      answered_slots: secAnswered,
      completion_pct: secTotal ? round2((secAnswered / secTotal) * 100) : 0,
      flagged_count: flagsBySection[s.id] || 0,
    });
  }

  // Both gated on blockCount > 0: with nothing fillable, neither "fully
  // completed" nor "not started" is meaningful, so both stay 0.
  let fullyCompleted = 0;
  let notStarted = 0;
  for (const p of participants) {
    const a = answeredByP[p.id] || 0;
    if (blockCount > 0 && a >= blockCount) fullyCompleted += 1;
    if (blockCount > 0 && a === 0) notStarted += 1;
  }

  let prepped = 0;
  let sectionNoteCount = 0;
  for (const p of participants) {
    const hasSecPrep = p.section_prep && Object.keys(p.section_prep).length > 0;
    const hasStandalone = Array.isArray(p.standalone_prep) && p.standalone_prep.length > 0;
    if (hasSecPrep || hasStandalone) prepped += 1;
    sectionNoteCount += Object.keys(p.section_notes || {}).length;
  }

  const totalSlots = blockCount * pc;
  const startsMs = sess.starts_at ? new Date(sess.starts_at).getTime() : NaN;
  const endsMs = sess.ends_at ? new Date(sess.ends_at).getTime() : NaN;
  const durationMin = !Number.isNaN(startsMs) && !Number.isNaN(endsMs) && endsMs >= startsMs
    ? Math.round((endsMs - startsMs) / 60000)
    : null;

  const sessionRow = {
    workbook_id: wb.id || null,
    vendor_id: sess.vendor?.id || null,
    trainer_id: sess.trainer?.id || null,
    session_type_id: sess.session_type?.id || null,
    starts_at: sess.starts_at || null,
    ends_at: sess.ends_at || null,
    closed_at: snap.closed_at,
    duration_minutes: durationMin,
    first_activity_at: firstAct !== null ? new Date(firstAct).toISOString() : null,
    last_activity_at: lastAct !== null ? new Date(lastAct).toISOString() : null,
    participant_count: pc,
    section_count: sections.length,
    block_count: blockCount,
    total_slots: totalSlots,
    answered_slots: answeredTotal,
    completion_pct: totalSlots ? round2((answeredTotal / totalSlots) * 100) : 0,
    fully_completed_count: fullyCompleted,
    not_started_count: notStarted,
    flagged_count: flaggedCount,
    trainer_noted_count: trainerNotedCount,
    section_note_count: sectionNoteCount,
    prepped_participant_count: prepped,
  };

  return { sessionRow, sectionRows };
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
    .from('profiles').select('id, full_name, role, vendor_id').eq('id', user.id).single();
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
    .select(`
      id, name, city_code, starts_at, ends_at, join_code,
      vendor_id, trainer_id, workbook_id, closed_at, session_type_id,
      vendors ( id, code, name ),
      session_type:session_types ( id, name ),
      trainer:profiles!sessions_trainer_id_fkey ( id, full_name, email )
    `)
    .eq('id', session_id)
    .maybeSingle();
  if (se) return jsonRes(500, { error: se.message });
  if (!sess) return jsonRes(404, { error: 'Session not found' });
  if (sess.closed_at) return jsonRes(409, { error: 'Session is already closed' });

  const SUPER_TIER = ['super_admin', 'super_trainer'];
  const canClose =
    SUPER_TIER.includes(caller.role) ||
    (caller.role === 'vendor_manager' && sess.vendor_id && caller.vendor_id === sess.vendor_id) ||
    ((caller.role === 'vendor_trainer' || caller.role === 'trainer') && sess.trainer_id === caller.id);
  if (!canClose) {
    return jsonRes(403, { error: 'You do not have permission to close this session' });
  }

  // ---- 2. Load workbook structure ----
  const [{ data: sections, error: secErr }, { data: blocks, error: blkErr }] = await Promise.all([
    admin.from('sections').select('id, title, order_index').eq('workbook_id', sess.workbook_id).order('order_index'),
    admin.from('blocks')
      .select('id, section_id, block_type, config, order_index')
      .in('section_id', (await admin.from('sections').select('id').eq('workbook_id', sess.workbook_id)).data?.map((s: any) => s.id) || [])
      .order('order_index'),
  ]);
  if (secErr) return jsonRes(500, { error: secErr.message });
  if (blkErr) return jsonRes(500, { error: blkErr.message });

  const { data: workbook } = await admin
    .from('workbooks').select('id, title, description').eq('id', sess.workbook_id).maybeSingle();

  // ---- 3. Load participants + their answers + their section notes ----
  const { data: spRows, error: spe } = await admin
    .from('session_participants')
    .select(`
      participant:profiles!session_participants_participant_id_fkey ( id, full_name, email )
    `)
    .eq('session_id', session_id);
  if (spe) return jsonRes(500, { error: spe.message });
  const participantProfiles = (spRows || []).map((r: any) => r.participant).filter(Boolean);
  const participantIds = participantProfiles.map((p: any) => p.id);

  const [
    { data: answersRows },
    { data: sectionNotesRows },
    { data: trainerNotesRows },
    { data: prepRows },
    { data: standaloneRows },
  ] = await Promise.all([
    participantIds.length
      ? admin.from('answers').select('participant_id, block_id, value, updated_at')
          .eq('session_id', session_id)
      : Promise.resolve({ data: [] as any[] }),
    participantIds.length
      ? admin.from('participant_notes').select('participant_id, section_id, note, updated_at')
          .eq('session_id', session_id)
      : Promise.resolve({ data: [] as any[] }),
    participantIds.length
      ? admin.from('answer_notes')
          .select('participant_id, block_id, note, flag, trainer_id, updated_at')
          .eq('session_id', session_id)
      : Promise.resolve({ data: [] as any[] }),
    participantIds.length
      ? admin.from('participant_prep').select('participant_id, section_id, content, updated_at')
          .eq('session_id', session_id)
      : Promise.resolve({ data: [] as any[] }),
    participantIds.length
      ? admin.from('participant_prep_standalone').select('participant_id, label, content, updated_at')
          .eq('session_id', session_id)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  // Group answers and notes by participant for the snapshot.
  const ansByP: Record<string, Record<string, any>> = {};
  for (const a of answersRows || []) {
    ansByP[a.participant_id] = ansByP[a.participant_id] || {};
    ansByP[a.participant_id][a.block_id] = { value: a.value, updated_at: a.updated_at };
  }
  const notesByP: Record<string, Record<string, any>> = {};
  for (const n of sectionNotesRows || []) {
    notesByP[n.participant_id] = notesByP[n.participant_id] || {};
    notesByP[n.participant_id][n.section_id] = { note: n.note, updated_at: n.updated_at };
  }
  const prepByP: Record<string, Record<string, any>> = {};
  for (const p of prepRows || []) {
    prepByP[p.participant_id] = prepByP[p.participant_id] || {};
    prepByP[p.participant_id][p.section_id] = { content: p.content, updated_at: p.updated_at };
  }
  const standaloneByP: Record<string, any[]> = {};
  for (const s of standaloneRows || []) {
    standaloneByP[s.participant_id] = standaloneByP[s.participant_id] || [];
    standaloneByP[s.participant_id].push({ label: s.label, content: s.content, updated_at: s.updated_at });
  }

  // ---- 4. Resolve "username" for the synthesized-email path so the
  // snapshot has something readable even after auth deletion. ----
  function usernameFromEmail(email: string | null): string | null {
    if (!email) return null;
    const m = email.match(/^([^@]+)@([^.]+)\.pstrainingres\.local$/);
    return m ? m[1] : email; // real-email path: just show the email
  }

  const participants = participantProfiles.map((p: any) => ({
    id: p.id,
    full_name: p.full_name,
    username: usernameFromEmail(p.email),
    answers: ansByP[p.id] || {},
    section_notes: notesByP[p.id] || {},
    section_prep: prepByP[p.id] || {},
    standalone_prep: standaloneByP[p.id] || [],
  }));

  // ---- 5. Build the snapshot ----
  const closed_at = new Date().toISOString();
  const snapshot = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    closed_at,
    closed_by: { id: caller.id, full_name: caller.full_name },
    session: {
      id: sess.id,
      name: sess.name,
      city_code: sess.city_code,
      starts_at: sess.starts_at,
      ends_at: sess.ends_at,
      join_code: sess.join_code,
      vendor: sess.vendors || null,
      session_type: sess.session_type || null,
      trainer: sess.trainer || null,
    },
    workbook: workbook ? {
      id: workbook.id,
      title: workbook.title,
      description: workbook.description,
      sections: (sections || []).map((s: any) => ({
        id: s.id,
        title: s.title,
        order_index: s.order_index,
        blocks: (blocks || [])
          .filter((b: any) => b.section_id === s.id)
          .map((b: any) => ({
            id: b.id,
            type: b.block_type,
            config: b.config,
            order_index: b.order_index,
          })),
      })),
    } : null,
    participants,
    trainer_notes: (trainerNotesRows || []).map((n: any) => ({
      participant_id: n.participant_id,
      block_id: n.block_id,
      note: n.note,
      flag: n.flag,
      trainer_id: n.trainer_id,
      updated_at: n.updated_at,
    })),
  };

  // ---- 6. Persist snapshot + closed_at + closed_by ----
  const { data: updated, error: upErr } = await admin
    .from('sessions')
    .update({
      closed_at,
      closed_by: caller.id,
      closed_summary: snapshot,
    })
    .eq('id', session_id)
    .select('id, closed_at, closed_by, closed_summary')
    .single();
  if (upErr) return jsonRes(500, { error: `Snapshot save failed: ${upErr.message}` });

  // Mark this session's prep kits permanently used (closed sessions never
  // return kits to the pool). The snapshot above already captured prep content.
  const { error: prepMarkErr } = await admin.rpc('mark_prep_kits_used', { p_session_id: session_id });

  // ---- 6.5 Lightweight analytics rows (non-fatal — the snapshot is the
  // record of truth; analytics is a derived reporting layer). Upserted so a
  // re-run is idempotent. ----
  let analyticsError: string | null = null;
  try {
    const { sessionRow, sectionRows } = computeAnalytics(snapshot);
    const { error: aErr } = await admin
      .from('session_analytics')
      .upsert({ session_id, ...sessionRow }, { onConflict: 'session_id' });
    if (aErr) throw aErr;
    if (sectionRows.length) {
      const { error: sErr } = await admin
        .from('session_section_analytics')
        .upsert(sectionRows.map((r) => ({ session_id, ...r })), { onConflict: 'session_id,section_id' });
      if (sErr) throw sErr;
    }
  } catch (e) {
    analyticsError = (e as { message?: string })?.message || String(e);
  }

  // ---- 7. HARD DELETE participants. Per-row errors are logged but
  // don't fail the close — the snapshot is already saved. ----
  const deleteErrors: Array<{ id: string; error: string }> = [];
  for (const pid of participantIds) {
    const { error: de } = await admin.auth.admin.deleteUser(pid);
    if (de) deleteErrors.push({ id: pid, error: de.message });
  }

  return jsonRes(200, {
    id: updated.id,
    closed_at: updated.closed_at,
    closed_summary: updated.closed_summary,
    participants_deleted: participantIds.length - deleteErrors.length,
    delete_errors: deleteErrors,
    prep_mark_used_error: prepMarkErr?.message || null,
    analytics_error: analyticsError,
  });
});
