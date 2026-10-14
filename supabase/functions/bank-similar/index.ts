// bank-similar — "Already in the bank" (T2).
//
// Embeds question-bank questions with Supabase's built-in gte-small model
// (Supabase.ai, inside the edge runtime: no outside AI provider, no key) and
// searches them by meaning. Trainer tier only.
//
// Body:
//   { action: 'refresh', bank_id }
//       Re-embeds every question in the bank whose text changed since it was
//       last embedded, and drops vectors of questions that no longer exist.
//       Returns { embedded, unchanged, total }.
//   { action: 'search', bank_id, text, limit? }
//       Embeds `text` and returns the closest questions: { results: [{ section_id, similarity }] }.
//
// Vectors live in bank_question_embeddings (no direct access for anyone);
// similar pairs are read by the browser through bank_similar_pairs().

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// deno-lint-ignore no-explicit-any
declare const Supabase: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const TRAINER_TIER = ['super_admin', 'super_trainer', 'vendor_manager', 'vendor_trainer', 'trainer'];
// gte-small reads at most 512 tokens; ~1,800 characters keeps well inside it.
const MAX_CHARS = 1800;

function jsonRes(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Every piece of wording in a block's settings: labels, prompts, options,
// table cells. Ids, sizes and flags are left out.
const SKIP_KEYS = /(^id$|Id$|_id$|^kind$|^type$|width|height|align|color|colour|grid|span|order|index)/i;
function collectText(v: unknown, out: string[], key = '') {
  if (v == null || SKIP_KEYS.test(key)) return;
  if (typeof v === 'string') {
    const s = v.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (s.length > 1 && !/^[0-9a-f-]{36}$/i.test(s)) out.push(s);
  } else if (Array.isArray(v)) {
    for (const x of v) collectText(x, out, key);
  } else if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) collectText(x, out, k);
  }
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

let session: any = null;
async function embed(text: string): Promise<number[]> {
  session ||= new Supabase.ai.Session('gte-small');
  const out = await session.run(text.slice(0, MAX_CHARS), { mean_pool: true, normalize: true });
  return Array.from(out as ArrayLike<number>);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonRes(405, { error: 'Method not allowed' });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonRes(401, { error: 'Missing Authorization header' });
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: ue } = await userClient.auth.getUser();
  if (ue || !user) return jsonRes(401, { error: 'Invalid token' });
  const { data: caller } = await userClient.from('profiles').select('role').eq('id', user.id).single();
  if (!caller || !TRAINER_TIER.includes(caller.role)) return jsonRes(403, { error: 'Trainer-tier access required' });

  let body: { action?: string; bank_id?: string; text?: string; limit?: number };
  try { body = await req.json(); } catch { return jsonRes(400, { error: 'Body must be JSON' }); }
  const bankId = body.bank_id;
  if (!bankId) return jsonRes(400, { error: 'bank_id is required' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: bank } = await admin.from('assessments').select('id, kind').eq('id', bankId).maybeSingle();
  if (!bank || bank.kind !== 'bank') return jsonRes(404, { error: 'No such question bank' });

  try {
    if (body.action === 'search') {
      const text = String(body.text || '').trim();
      if (text.length < 2) return jsonRes(200, { results: [] });
      const vec = await embed(text);
      // The caller's own client: bank_search checks the CALLER is trainer tier.
      const { data, error } = await userClient.rpc('bank_search', {
        p_bank_id: bankId, p_embedding: JSON.stringify(vec), p_limit: Math.min(Math.max(body.limit || 20, 1), 50),
      });
      if (error) return jsonRes(500, { error: error.message });
      return jsonRes(200, { results: data || [] });
    }

    if (body.action === 'refresh') {
      const { data: secs, error: sErr } = await admin.from('assessment_sections')
        .select('id, title, tags').eq('assessment_id', bankId);
      if (sErr) return jsonRes(500, { error: sErr.message });
      const ids = (secs || []).map(s => s.id);
      const { data: blocks, error: bErr } = ids.length
        ? await admin.from('assessment_blocks').select('section_id, order_index, config').in('section_id', ids).order('order_index')
        : { data: [], error: null };
      if (bErr) return jsonRes(500, { error: bErr.message });
      const { data: have } = ids.length
        ? await admin.from('bank_question_embeddings').select('section_id, text_hash').eq('bank_id', bankId)
        : { data: [] };
      const hashOf = Object.fromEntries((have || []).map(h => [h.section_id, h.text_hash]));

      let embedded = 0; let unchanged = 0;
      for (const s of secs || []) {
        const parts: string[] = [];
        // The title is usually "Question 4" and says nothing; topics do.
        if (s.title && !/^\s*question\s*\d+\s*$/i.test(s.title)) parts.push(s.title);
        if (Array.isArray(s.tags) && s.tags.length) parts.push(s.tags.join(', '));
        for (const b of (blocks || []).filter(x => x.section_id === s.id)) collectText(b.config, parts);
        const text = parts.join('\n').slice(0, MAX_CHARS);
        if (!text.trim()) continue;
        const h = await sha256(text);
        if (hashOf[s.id] === h) { unchanged++; continue; }
        const vec = await embed(text);
        const { error: wErr } = await admin.from('bank_question_embeddings').upsert({
          section_id: s.id, bank_id: bankId, text_hash: h, embedding: JSON.stringify(vec), updated_at: new Date().toISOString(),
        });
        if (wErr) return jsonRes(500, { error: wErr.message });
        embedded++;
      }
      // Questions deleted from the bank cascade away with their section; this
      // catches a question MOVED to another assessment.
      const gone = Object.keys(hashOf).filter(id => !ids.includes(id));
      if (gone.length) await admin.from('bank_question_embeddings').delete().in('section_id', gone);
      return jsonRes(200, { embedded, unchanged, total: (secs || []).length });
    }

    return jsonRes(400, { error: "action must be 'refresh' or 'search'" });
  } catch (e) {
    return jsonRes(500, { error: (e as Error)?.message || String(e) });
  }
});
