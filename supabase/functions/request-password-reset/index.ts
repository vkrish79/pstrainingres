// Supabase Edge Function: request-password-reset
//
// PUBLIC (verify_jwt = false) — the forgot-password page is unauthenticated.
// Generates a recovery link server-side (service role) and delivers it via a
// generic Power Automate email endpoint that accepts { to, subject, body, html }.
// Works for every role (incl. supers) — a recovery link lands on /reset-password.
//
// Always returns 200 with a generic body: never reveals whether the email has
// an account (no enumeration). PA / link failures are logged, not surfaced.
//
// Body: { email, redirectTo? }
// Secrets: PA_EMAIL_URL (the Power Automate HTTP trigger), SITE_URL (optional).

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
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const PA_URL = Deno.env.get('PA_EMAIL_URL');
  const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://pstrainingres.vercel.app';

  let body: { email?: string; redirectTo?: string };
  try { body = await req.json(); } catch { return jsonRes(400, { error: 'Invalid JSON body' }); }

  const email = (body.email ?? '').toString().trim();
  const redirectTo = (body.redirectTo ?? `${SITE_URL}/reset-password`).toString();
  if (!email) return jsonRes(400, { error: 'email is required' });
  if (!PA_URL) { console.error('PA_EMAIL_URL not set'); return jsonRes(500, { error: 'Email transport not configured' }); }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Recovery link. Supabase validates redirectTo against the Auth redirect
  // allow-list, so this can't be turned into an open redirect. If the email has
  // no account, generateLink errors — swallow it and still return success.
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });
  const link = (data as { properties?: { action_link?: string } } | null)?.properties?.action_link;
  if (error || !link) {
    // Logged (never surfaced) so this otherwise-invisible exit is diagnosable:
    // distinguishes a generateLink error from "no account / no link" for a given email.
    console.error('No recovery link generated', { email, reason: error ? error.message : 'no link returned' });
    return jsonRes(200, { ok: true });
  }

  const subject = 'Reset your pstrainingres password';
  const text = [
    'We received a request to reset your pstrainingres password.',
    '',
    'Open this link to set a new password:',
    link,
    '',
    "If you didn't request this, you can safely ignore this email.",
  ].join('\n');
  const html = [
    '<p>We received a request to reset your <strong>pstrainingres</strong> password.</p>',
    `<p><a href="${link}">Set a new password</a></p>`,
    '<p style="color:#888;font-size:13px">If you didn\'t request this, you can safely ignore this email.</p>',
  ].join('');

  // Deliver via Power Automate. Errors are logged but not surfaced (a transport
  // failure only happens for an existing account, so reporting it would leak).
  try {
    console.log('Recovery link generated, POSTing to PA', { email });
    const resp = await fetch(PA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // PA flow's HTTP trigger schema requires `htmlBody` (not `html`).
      body: JSON.stringify({ to: email, subject, body: text, htmlBody: html }),
    });
    if (!resp.ok) console.error('PA email send failed', resp.status, await resp.text().catch(() => ''));
  } catch (e) {
    console.error('PA email send error', e);
  }

  return jsonRes(200, { ok: true });
});
