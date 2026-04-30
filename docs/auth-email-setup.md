# Auth email delivery — setup options

Supabase generates the password-reset link with a recovery token; what we
choose here is **who actually delivers the email** (and from which address it
appears to come). Picking the right option is mostly a tradeoff between
deliverability, branding, and how much glue code we want to maintain.

## TL;DR

| Option | Effort | Email "From" | When to pick |
|---|---|---|---|
| 1. Supabase built-in (default today) | None | Generic Supabase address | Dev / pilot only — capped at ~3–4 emails/hour on free tier |
| 2. Office 365 SMTP relay | Low (one-time IT ticket) | Your EY mailbox | Production, no Power Automate involved |
| 3. Send Email Hook → Power Automate | Medium | Whatever the PA flow uses (Office 365 connector) | Production, no SMTP credentials needed in Supabase, audit trail in PA |
| 4. Custom Edge Function → Power Automate | High | Whatever the PA flow uses | Full control over email content, audit, branching |

## Option 1 — Supabase built-in (current state)

Nothing to configure. Already works.

- **Sender:** generic `noreply@mail.app.supabase.io` style address.
- **Rate limits:** ~3–4/hour on free tier, ~30/hour on Pro. Anything over gets throttled with no UX feedback for the user.
- **Branding:** template editable at *Authentication → Email Templates → Reset Password*, but the From address can't be changed.
- **When to use:** dev, internal testing, demos. Switch off this before any real cohort relies on email-based reset.

## Option 2 — Office 365 SMTP relay

Configure Supabase to send through EY's Office 365 SMTP. Requires IT to
either give us a service account that's allowed to do SMTP-auth submission, or
to permit our Supabase egress IPs as a relay source.

### Setup

1. Get an Office 365 service mailbox from IT (e.g. `pstrainingres-noreply@etihad.com`).
2. Confirm with IT that **SMTP AUTH** is enabled on that mailbox (it's disabled by
   default in modern Microsoft 365 tenants).
3. In Supabase Studio → **Project Settings → Auth → SMTP Settings**:

   | Field | Value |
   |---|---|
   | Sender email | `pstrainingres-noreply@etihad.com` |
   | Sender name | `pstrainingres` |
   | Host | `smtp.office365.com` |
   | Port | `587` |
   | Username | the service account's UPN |
   | Password | the service account's app password |
   | Minimum interval | `60s` (default) |

4. Add the redirect URL allow-list under **Authentication → URL Configuration**:
   - `https://<prod-domain>/reset-password`
   - `http://localhost:5174/reset-password` (for dev)
5. Send a test reset; confirm the email lands in inbox (not spam) and shows
   the EY From address.

### Pros / cons

- ✓ Cleanest end-state — one config screen, no extra moving parts.
- ✓ EY-domain From address improves trust and deliverability.
- ✗ Requires IT to enable SMTP AUTH (some EY tenants disable it for security).
- ✗ Credentials live in Supabase only — no PA-side audit.

## Option 3 — Supabase Send Email Hook → Power Automate (recommended for EY)

Instead of Supabase sending the email itself, it POSTs the rendered email to a
webhook we own. Power Automate listens, then sends the email via its built-in
Office 365 connector (no SMTP creds anywhere).

### One-time setup

#### A. Create the Power Automate flow

1. In Power Automate, create a new **Automated cloud flow** with trigger
   **"When an HTTP request is received"** (Request connector).
2. Define the inbound JSON schema (Supabase's hook payload shape):

   ```json
   {
     "type": "object",
     "properties": {
       "user": {
         "type": "object",
         "properties": {
           "id": {"type": "string"},
           "email": {"type": "string"}
         }
       },
       "email_data": {
         "type": "object",
         "properties": {
           "token": {"type": "string"},
           "token_hash": {"type": "string"},
           "redirect_to": {"type": "string"},
           "email_action_type": {"type": "string"},
           "site_url": {"type": "string"},
           "token_new": {"type": "string"},
           "token_hash_new": {"type": "string"}
         }
       }
     }
   }
   ```

3. Add a **Compose** action to build the magic link:
   `@{triggerBody()?['email_data']?['site_url']}/auth/v1/verify?token=@{triggerBody()?['email_data']?['token_hash']}&type=recovery&redirect_to=@{triggerBody()?['email_data']?['redirect_to']}`
4. Add **Office 365 Outlook → Send an email (V2)**:
   - To: `@{triggerBody()?['user']?['email']}`
   - Subject: `Reset your pstrainingres password`
   - Body (HTML): include a button/link that points at the Compose output.
     Keep it short — one paragraph + a clear CTA.
5. Save. Copy the generated **HTTP POST URL** (you'll paste it into Supabase).
6. Set the trigger's **Method** to `POST` and the security mode you want
   (recommended: enable a shared secret header — see step C below).

#### B. Enable the Send Email Hook in Supabase

1. Supabase Studio → **Authentication → Hooks**.
2. Click **"Send Email Hook"** → enable.
3. Choose **"HTTPS Webhook"**.
4. Paste the PA HTTP URL from step A.5.
5. (Recommended) Set the **HTTP Webhook Secret** to a random 32-char string. Copy it.

#### C. Verify the secret in Power Automate

In the PA flow, after the trigger:

1. Add a **Condition** action.
2. Compare `triggerOutputs()['headers']['x-supabase-signature']` (or whichever
   header Supabase uses for the secret — confirm in their docs at the time of
   setup) against the secret stored in PA (use **environment variables** in PA,
   never inline).
3. If mismatched, **Terminate** with a `403`-equivalent.

#### D. Test

1. From the app: forgot-password → submit a real participant email.
2. Confirm the PA flow run executes (PA → My flows → Run history).
3. Confirm the email lands in inbox with EY-domain From address.
4. Click the link — should land on `/reset-password` with the recovery session active.

### Pros / cons

- ✓ No SMTP credentials in Supabase — auth uses only the webhook secret.
- ✓ PA gives us a run history / audit log for every reset email.
- ✓ Email content can be tweaked by anyone with PA access (no code deploy).
- ✗ Send Email Hook may require Supabase Pro plan — confirm pricing tier.
- ✗ One more system in the dependency chain (PA outage → no reset emails).

## Option 4 — Custom Edge Function → Power Automate

Replace the call to `supabase.auth.resetPasswordForEmail` in the app with a
call to a new edge function (`request-password-reset`) that:

1. Calls `supabase.auth.admin.generateLink({ type: 'recovery', email })` to
   obtain the recovery URL server-side (using the service role key).
2. POSTs `{ email, recovery_url, requested_at }` to a Power Automate HTTP
   trigger.
3. PA assembles the email body and sends via Office 365 connector.

This is what to choose if we eventually want:

- Templated emails per cohort or per workbook (link to specific session etc.).
- Branching (different email subject for trainers vs. participants).
- Rate-limiting or throttling logic outside Supabase.
- Centralised audit of every reset request (success and failure).

It is meaningfully more code than Option 3 — only worth doing once the email
needs grow beyond a single template.

## Decision checklist (use tomorrow)

1. Will any production cohort use this in the next 30 days? **If no →** Option 1
   is fine for now.
2. Can IT enable SMTP AUTH on a service mailbox quickly? **If yes →** Option 2
   is the lowest-friction long-term answer.
3. Do we want PA-level audit / non-developer-editable email templates?
   **If yes →** Option 3.
4. Do we need branching email content (per cohort, per role)? **If yes →** Option 4.

Default recommendation if undecided: **Option 3** — it gets us off the
Supabase-built-in throttle, uses an EY-domain sender via the Office 365
connector, and the email body lives in PA where non-developers can iterate.
