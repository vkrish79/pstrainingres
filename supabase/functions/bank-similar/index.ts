// bank-similar — "Already in the bank" (T2).
//
// Embeds question-bank questions with Supabase's built-in gte-small model
// (Supabase.ai, inside the edge runtime: no outside AI provider, no key) and
// compares them by meaning. Trainer tier only.
//
// Body:
//   { action: 'refresh', bank_id }
//       Re-embeds every question in the bank whose text changed since it was
//       last embedded, drops vectors of questions that no longer exist, and
//       returns the pairs that read alike:
//       { embedded, unchanged, total, pairs: [{ section_id, other_id, similarity, near }] }
//   { action: 'search', bank_id, text, limit? }
//       Embeds `text` and returns the bank's questions closest to it, best
//       first: { results: [{ section_id, similarity }] }.
//
// Vectors live in bank_question_embeddings (no direct access for anyone).
//
// Tuned on the ADRW bank (.verify/_t2-live.mjs; offline copy of the model in
// the T2 calibration notes). Two things matter more than anything else:
//   1. What is embedded. Only wording that says what the question is about:
//      topics and the scenario/question lines. Form plumbing (input types,
//      card numbers, names, e-mails) and lines most of the bank shares ("Enter
//      the PNR provided by the instructor") are left out.
//   2. Centring. gte-small scores any two questions about the same system
//      0.85–0.99, whatever they ask. Taking the bank's average vector away from
//      each one leaves what is particular to it, and real look-alikes then
//      stand well clear of the rest (refund pair 0.79 and 0.28 vs ≤ 0.10).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// deno-lint-ignore no-explicit-any
declare const Supabase: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const TRAINER_TIER = ['super_admin', 'super_trainer', 'vendor_manager', 'vendor_trainer', 'trainer'];
// gte-small reads at most 512 tokens; the cleaned text of a long question
// fits well inside this.
const MAX_CHARS = 1200;
// Centring needs enough questions for the average to mean anything; with two
// it would make them exact opposites.
const CENTRE_FROM = 5;
// Cut-offs, per scale. Centred: unrelated pairs sat at ≤ 0.10, the refund
// trio at 0.28–0.79. Raw (small banks): unrelated up to 0.93, trio 0.95–0.99.
const CUTS = {
  centred: { similar: 0.2, near: 0.6 },
  raw: { similar: 0.94, near: 0.97 },
};
const PER_QUESTION = 3;

function jsonRes(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ── What gets embedded ──────────────────────────────────────────────────────
const SKIP_KEYS = /(^id$|Id$|_id$|^kind$|^type$|input_type|width|height|align|color|colour|grid|span|order|index|style|answer|correct|points)/i;
const clean = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

// A line worth embedding: real words — not a config value, code, number,
// e-mail, or a name/place/heading in capitals.
function wordy(s: string) {
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/i.test(s)) return false;
  if (/\S+@\S+\.\S+/.test(s)) return false;
  if ((s.match(/[A-Za-z]{3,}/g) || []).length < 3) return false;
  if (!/\b[a-z]{4,}\b/.test(s)) return false;
  return (s.match(/\d/g) || []).length * 3 < s.length;
}
function collectText(v: unknown, out: string[], key = '') {
  if (v == null || SKIP_KEYS.test(key)) return;
  if (typeof v === 'string') {
    const s = clean(v);
    if (wordy(s)) out.push(s);
  } else if (Array.isArray(v)) {
    for (const x of v) collectText(x, out, key);
  } else if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) collectText(x, out, k);
  }
}

type Sec = { id: string; title: string | null; tags: string[] | null };
type Blk = { section_id: string; config: unknown };

// One text per question. A line is kept only if it has a word that fewer
// than half the bank's questions use, so shared instructions drop out.
function buildTexts(secs: Sec[], blocks: Blk[]): Record<string, string> {
  const lines = new Map<string, string[]>();
  for (const s of secs) {
    const out: string[] = [];
    for (const b of blocks) if (b.section_id === s.id) collectText(b.config, out);
    lines.set(s.id, [...new Set(out)]);
  }
  const common = secs.length >= 4 ? Math.ceil(secs.length / 2) : Infinity;
  const df = new Map<string, number>();
  for (const ls of lines.values()) {
    for (const w of new Set(ls.join(' ').toLowerCase().match(/[a-z]{4,}/g) || [])) df.set(w, (df.get(w) || 0) + 1);
  }
  const telling = (l: string) => (l.toLowerCase().match(/[a-z]{4,}/g) || []).some(w => (df.get(w) || 0) < common);
  const texts: Record<string, string> = {};
  for (const s of secs) {
    const parts: string[] = [];
    if (Array.isArray(s.tags) && s.tags.length) parts.push(`Topic: ${s.tags.join(', ')}.`);
    // The title is usually "Question 4" and says nothing; topics do.
    if (s.title && !/^\s*question\s*\d+\s*$/i.test(s.title)) parts.push(s.title);
    for (const l of lines.get(s.id) || []) if (telling(l)) parts.push(l);
    texts[s.id] = parts.join('\n').slice(0, MAX_CHARS);
  }
  return texts;
}

// ── Vectors ─────────────────────────────────────────────────────────────────
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

const dot = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const unit = (a: number[]) => { const n = Math.sqrt(dot(a, a)) || 1; return a.map(x => x / n); };

// The bank's vectors, centred when there are enough of them. `centre(v)`
// puts a search vector on the same footing.
// deno-lint-ignore no-explicit-any
async function bankSpace(admin: any, bankId: string) {
  const { data, error } = await admin.from('bank_question_embeddings').select('section_id, embedding').eq('bank_id', bankId);
  if (error) throw new Error(error.message);
  const rows = (data || []).map((r: { section_id: string; embedding: string | number[] }) => ({
    id: r.section_id,
    v: typeof r.embedding === 'string' ? JSON.parse(r.embedding) as number[] : r.embedding,
  }));
  const scale: 'centred' | 'raw' = rows.length >= CENTRE_FROM ? 'centred' : 'raw';
  let centre = (v: number[]) => v;
  if (scale === 'centred') {
    const mean = new Array(rows[0].v.length).fill(0);
    for (const r of rows) for (let i = 0; i < mean.length; i++) mean[i] += r.v[i] / rows.length;
    centre = (v: number[]) => unit(v.map((x, i) => x - mean[i]));
  }
  return { scale, centre, rows: rows.map((r: { id: string; v: number[] }) => ({ id: r.id, v: centre(r.v) })) };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

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
      const [q, space] = await Promise.all([embed(text), bankSpace(admin, bankId)]);
      const qv = space.centre(q);
      const limit = Math.min(Math.max(body.limit || 20, 1), 50);
      const results = space.rows
        .map((r: { id: string; v: number[] }) => ({ section_id: r.id, similarity: round(dot(qv, r.v)) }))
        .sort((a: { similarity: number }, b: { similarity: number }) => b.similarity - a.similarity)
        .slice(0, limit);
      return jsonRes(200, { results, scale: space.scale });
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

      // Which lines count depends on the whole bank, so adding a question can
      // re-embed others. Fine at bank sizes; unchanged texts are skipped.
      const texts = buildTexts((secs || []) as Sec[], (blocks || []) as Blk[]);
      let embedded = 0; let unchanged = 0;
      const keep = new Set<string>();
      for (const s of secs || []) {
        const text = texts[s.id];
        if (!text?.trim()) continue;
        keep.add(s.id);
        const h = await sha256(text);
        if (hashOf[s.id] === h) { unchanged++; continue; }
        const vec = await embed(text);
        const { error: wErr } = await admin.from('bank_question_embeddings').upsert({
          section_id: s.id, bank_id: bankId, text_hash: h, embedding: JSON.stringify(vec), updated_at: new Date().toISOString(),
        });
        if (wErr) return jsonRes(500, { error: wErr.message });
        embedded++;
      }
      // A question moved to another assessment, or emptied of wording.
      const gone = Object.keys(hashOf).filter(id => !keep.has(id));
      if (gone.length) await admin.from('bank_question_embeddings').delete().in('section_id', gone);

      // Pairs: up to three closest per question, above the cut-off.
      const space = await bankSpace(admin, bankId);
      const cut = CUTS[space.scale];
      const pairs: { section_id: string; other_id: string; similarity: number; near: boolean }[] = [];
      for (const a of space.rows) {
        space.rows
          .filter((b: { id: string }) => b.id !== a.id)
          .map((b: { id: string; v: number[] }) => ({ other_id: b.id, similarity: dot(a.v, b.v) }))
          .filter((x: { similarity: number }) => x.similarity >= cut.similar)
          .sort((x: { similarity: number }, y: { similarity: number }) => y.similarity - x.similarity)
          .slice(0, PER_QUESTION)
          .forEach((x: { other_id: string; similarity: number }) => pairs.push({
            section_id: a.id, other_id: x.other_id, similarity: round(x.similarity), near: x.similarity >= cut.near,
          }));
      }
      return jsonRes(200, { embedded, unchanged, total: (secs || []).length, scale: space.scale, pairs });
    }

    return jsonRes(400, { error: "action must be 'refresh' or 'search'" });
  } catch (e) {
    return jsonRes(500, { error: (e as Error)?.message || String(e) });
  }
});
