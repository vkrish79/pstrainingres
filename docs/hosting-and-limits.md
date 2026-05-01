# Hosting & capacity — Supabase free tier

A reference for why this app runs on Supabase and what the free-tier
constraints mean in practice. Useful when planning cohort load, deciding
when to upgrade, or onboarding new contributors.

> **Verify before relying on numbers below.** Supabase has changed its
> pricing tiers and quotas before; treat the figures here as the shape of
> the limits, not the exact contract. The current canonical source is
> [supabase.com/pricing](https://supabase.com/pricing).

---

## Why Supabase

It was already wired into the project at the v1 commit (`0992ec8`); the
schema, RLS policies, auth flows, and realtime channels were all built
on top of it. Everything since has layered onto that foundation.

That said, it's a reasonable fit for this app:

- **Postgres + RLS** does the access-control heavy lifting. Trainer and
  participant scopes are enforced at the row level, so the JS client
  can't accidentally leak another cohort's answers. See policies in
  `supabase/schema.sql` (search for `create policy`).
- **Built-in auth** (email/password, password reset) saved building user
  management. The reset flow is the only place we actively integrate
  with Supabase auth events; see `src/pages/ResetPasswordPage.jsx`.
- **Realtime** is used for live cohort updates: block edits broadcast to
  participants (`useWorkbook.js`), trainer notes broadcast to co-trainers
  (`useSessionNotes.js`), answers update dashboards live
  (`useSessionDashboard.js`).
- **One platform for DB + auth + realtime** keeps the operational
  surface small.

---

## Free-tier limits (what matters for this app)

| Resource | Free tier | What it means here |
|---|---|---|
| **Postgres storage** | 500 MB | Likely binding constraint. See sizing below. |
| **Database egress** | 5 GB / month | Plenty for a few cohorts. Watch if you run frequent full-cohort CSV exports. |
| **Monthly active users** | 50,000 | Effectively unlimited for training cohorts. |
| **Realtime concurrent connections** | ~200 | One cohort ≈ 30 connections. Fine. |
| **Realtime messages** | ~2M / month | Fine for normal use. |
| **Auto-pause** | After **7 days** of inactivity | Probably the biggest operational gotcha — see below. |
| **Daily backups** | 7 days retention, no PITR | Acceptable for training data; not great for compliance-sensitive cohorts. |
| **Projects per org** | 2 | Counts production + any staging. |
| **Edge Functions** | 500K invocations / month | Not used. |
| **Storage (files)** | 1 GB + 5 GB egress | Not used. |

---

## Sizing this app against 500 MB

Back-of-envelope using the Etihad workbook as a reference: ~38 exercises,
~200 fillable blocks per workbook.

- **Workbook clone:** ~400 KB JSON (sections + blocks).
- **Answers:** one row per (participant × fillable block), ~500 bytes/row.
- **30-person cohort:** 30 × 200 × 500 B ≈ 3 MB of answers + 0.4 MB
  workbook = **~3.5 MB total per session.**
- Trainer notes, participants, sessions metadata, RLS overhead:
  negligible at this scale.

**Implied capacity:** roughly **100–140 sessions** of that size before
the 500 MB cap. Plenty of runway for a small training operation; tight
if you keep every session forever for many years.

When the cap looms, the cheapest mitigation is the **Archive old
sessions** backlog item (`progress.md` §9 #5): drop archived sessions'
cloned workbook + answers, keep only summary metadata.

---

## Operational gotchas to watch

1. **7-day inactivity auto-pause** is the most likely surprise. If the
   project gets no requests for 7 days, Supabase pauses the database;
   the first request after wakes it (cold-start of several seconds).
   Schedule a daily cron / external health-check ping if you have gaps
   between cohorts. A trivial `select 1` query is enough.
2. **No point-in-time recovery on free tier.** Daily backups are 7-day
   retention. If a trainer deletes the wrong template, you can roll
   back to the previous day, not to 2 hours ago. Mitigation: tell
   trainers the **Delete workbook** button is irreversible (it is —
   confirms but no undo).
3. **CSV export over many cohorts** chews through egress. Each export
   pulls all answers + notes for the cohort. Not a near-term concern at
   the current scale, but worth knowing.
4. **`mammoth.browser` is ~500 kB on the client.** Lazy-loaded (only
   when the import page is opened), but it's a Vite bundle concern, not
   Supabase. See `progress.md` §9 #7.

---

## When to upgrade

The Pro tier (≈$25/mo at last check — verify) buys:

- 8 GB storage, 250 GB egress
- **No auto-pause** (the usual trigger to upgrade)
- 7-day point-in-time recovery
- 14-day daily-backup retention
- More compute, faster cold starts

Realistic trigger: as soon as you have a paying customer cohort, or a
production deployment that can't tolerate cold starts after a quiet week.

---

## What to monitor

- **Supabase dashboard → Reports → Database** — storage used, daily
  changes.
- **Supabase dashboard → Reports → API** — egress trend.
- **Auth → Users** — MAU count (won't bind for this app, but useful
  signal).
- **Database → Tables → workbooks** — count of `is_template = false`
  rows (i.e. session-clones); biggest contributor to storage growth.

A monthly glance at these is enough at this scale.
