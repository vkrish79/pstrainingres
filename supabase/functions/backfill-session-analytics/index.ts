// Supabase Edge Function: backfill-session-analytics
// One-time / idempotent maintenance: for every already-closed session that has
// a closed_summary, recompute the lightweight analytics from that snapshot and
// upsert session_analytics + session_section_analytics. Forward closes write
// these rows directly (see close-session); this fills the gap for sessions
// closed before that shipped.
//
// computeAnalytics below MIRRORS close-session/index.ts (kept identical on
// purpose — this function can be deleted once the backfill has been run).
//
// Auth: super-tier only (global maintenance across all vendors).
// Body: {}  Returns: { processed, skipped, errors: [{ session_id, error }] }

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

// ---- analytics computation (mirrors close-session/index.ts) ----
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
    .from('profiles').select('id, role').eq('id', user.id).single();
  const SUPER_TIER = ['super_admin', 'super_trainer'];
  if (pe || !caller || !SUPER_TIER.includes(caller.role)) {
    return jsonRes(403, { error: 'Super-tier access required' });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: rows, error: se } = await admin
    .from('sessions')
    .select('id, closed_summary')
    .not('closed_at', 'is', null)
    .not('closed_summary', 'is', null);
  if (se) return jsonRes(500, { error: se.message });

  let processed = 0;
  let skipped = 0;
  const errors: Array<{ session_id: string; error: string }> = [];

  for (const row of rows || []) {
    const snap = row.closed_summary;
    if (!snap || typeof snap !== 'object') { skipped += 1; continue; }
    try {
      const { sessionRow, sectionRows } = computeAnalytics(snap);
      const { error: aErr } = await admin
        .from('session_analytics')
        .upsert({ session_id: row.id, ...sessionRow }, { onConflict: 'session_id' });
      if (aErr) throw aErr;
      if (sectionRows.length) {
        const { error: sErr } = await admin
          .from('session_section_analytics')
          .upsert(sectionRows.map((r) => ({ session_id: row.id, ...r })), { onConflict: 'session_id,section_id' });
        if (sErr) throw sErr;
      }
      processed += 1;
    } catch (e) {
      errors.push({ session_id: row.id, error: (e as { message?: string })?.message || String(e) });
    }
  }

  return jsonRes(200, { processed, skipped, errors });
});
