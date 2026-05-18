# pstrainingres — progress log

A reference for what's been built on top of the v1 commit (`0992ec8`), grouped
by area. Each section lists capability, where it lives in the code, gotchas,
and any deferred work.

> **Required setup before this all works in a deployed environment**
>
> 1. Apply both migrations in Supabase Studio → SQL Editor:
>    - `supabase/add_answer_notes.sql`
>    - `supabase/add_session_city_code.sql`
> 2. In **Authentication → URL Configuration**:
>    - **Site URL:** `https://pstrainingres.vercel.app`
>    - **Redirect URLs (allow-list):**
>      - `https://pstrainingres.vercel.app/reset-password`
>      - `http://localhost:5174/reset-password` (for local dev)
> 3. Decide on email delivery before any cohort relies on password reset —
>    see [`docs/auth-email-setup.md`](./auth-email-setup.md).

---

## 1. Workbook authoring

### 1.1 DOCX importer

**Goal:** trainers author the workbook in Word using a small set of conventions,
upload the `.docx`, and the app creates the workbook + sections + blocks.

**Code:**
- `src/lib/docxImport.js` — parser. Uses `mammoth` (lazy-loaded so the main
  bundle stays slim — `mammoth.browser` is its own ~500 kB chunk).
- `src/pages/ImportWorkbookPage.jsx` — file picker → live preview (counts +
  per-block previews) → confirm → inserts workbook, sections, blocks.
- Route: `/trainer/workbooks/import`. Button on TrainerHomePage.

**Marker syntax (explicit — works in any docx):**

| Word style / pattern                         | Becomes                       |
|----------------------------------------------|-------------------------------|
| Heading 1                                    | workbook title                |
| Heading 2                                    | section                       |
| `[SHORT: label]`                             | field, short text             |
| `[LONG: label]`                              | field, long text              |
| `[CHOICE: label \| A \| B \| C]`             | field, single-choice radio    |
| `[CHECK:  label \| A \| B \| C]`             | field, multi-select checkbox  |
| Word table cell `[INPUT:short]` / `[INPUT:long]` | input cell in a table     |
| Other Word table cells                       | static text cell              |
| Bold first row of a Word table               | header row                    |

**Heuristics (so existing Etihad-style workbooks like ARDW import without rework):**

- Bold paragraphs matching `^(Exercise|Section|Module|Chapter|Lesson|Lab|Activity|Part|Unit|Topic)\s+(\d+|[IVX]+)` start a new section.
- Word content-control placeholder text in a cell — `Click or tap here to enter text.` / `…to enter a date.` — becomes a short-text input cell.
- Word TOC entries (paragraphs whose only link is `#_Toc…`) are skipped.
- An H1 whose text matches the section pattern (e.g. mammoth promotes one
  custom-styled heading) is treated as a section, not the workbook title.
- If no h1 exists, a leading bold short paragraph becomes the workbook title.
- **Single-answer MCQ table** (spanning question row over 2-cell option rows
  where each left cell has one native Word checkbox) → `field`, `choice`.
- **Matrix table** (question row + bold header row + option rows where the
  last K cells each have one checkbox) → prose question + one `check_group`
  field per option row, options drawn from the trailing K column headers.
- **Body-cell `colspan` / `rowspan`** are preserved as optional `colSpan` /
  `rowSpan` props on the cell and applied at render time.
- Pre-section "Document information" / "Revision information" tables are
  dropped (Word boilerplate).

**Known limitation:**

- **Header-row spans are not preserved.** Body-cell merging works, but a
  `<th>` with `colspan="2"` still splits into two separate columns because
  `cfg.headers` is a flat string array. See `docs/docx-importer-next.md` §8.

### 1.2 In-app editor

**Code:** `src/pages/WorkbookEditorPage.jsx`, `src/hooks/useWorkbookEditor.js`,
`src/components/editor/BlockListItem.jsx`, `src/components/editor/BlockForm.jsx`.

**Capabilities added on top of v1:**

- **`+ New workbook`** — `src/pages/NewWorkbookPage.jsx`, route
  `/trainer/workbooks/new`. Creates a workbook + seeds an empty first section.
- **Sections:** add, click-to-rename, delete with confirm. Cascades to blocks
  via existing FK.
- **Blocks:**
  - `+ Add prose`, `+ Add field`, **`+ Add table`** (table button is new).
  - **Duplicate** — clones a block, inserts immediately after the source. For
    tables, regenerates input-cell IDs so participant answers don't collide.
- **Full table editing** (was a v2 stub before):
  - Caption, optional header row (add/remove whole header row).
  - Per-column: rename, `× col` removes from headers + every row.
  - Per-cell: toggle Static/Input; static cells get a textarea, inputs choose
    between Short text / Long text.
  - Per-row: `× row` removes that row.
  - `+ Add column`, `+ Add row`.
  - Input-cell IDs stay stable across edits → answers survive renames and reorders.

---

## 2. Session dashboard

### 2.1 Tab structure

**Code:** `src/pages/SessionDashboardPage.jsx`.

Two tabs: **Participants** (existing v1 view, mostly unchanged) and
**By exercise** (new). The earlier Heatmap and "By question" tabs were
prototyped and removed — their functionality is subsumed by the new
By-exercise view + sidebar.

### 2.2 By exercise — layout

**Code:** `src/components/dashboard/ExerciseResponses.jsx`.

- **Left sidebar** (sticky, scrolls independently): one row per exercise
  showing the exercise title, **cohort completion %**, mini progress bar
  (grey/gold/green), and `X/Y done` (participants who've completed every
  fillable block in that exercise).
- **Right pane:** participant tile grid for the selected exercise.
- **Mobile (<800 px):** sidebar collapses to a sticky `<select>`.
- Designed to scale to 50+ exercises by scrolling.

### 2.3 By exercise — toolbar

- **Search** — type-ahead filter by participant name or email.
- **Filter:** All / Incomplete / Done / **Flagged** (live counts in each label).
- **Sort:** Name (A→Z) / Most progress first / Least progress first / Recent
  activity.
- **Expand all / Collapse all** (disabled when already in that state).
- Tile **default expansion**: ≤ 8 participants → expanded; > 8 → collapsed.
  Per-tile clicks override; switching exercises resets the per-tile overrides.

### 2.4 Participant tile

- Header row (always visible, click to toggle): chevron, name, flag/note
  badges if any, relative-time of last activity (e.g. `5m ago`), colored
  progress pill `3 / 8 (38%)`.
- Body (when expanded): each fillable block rendered as a label/value, tables
  expanded into a nested mini-table of input cells. Plus the trainer-only
  note row beneath each block (see §2.6).

### 2.5 CSV export

**Code:** `src/lib/sessionExport.js`. Button is in the dashboard hero
(`↓ Export CSV`).

- Long format: `session, participant, section, block, cell, value, updated_at, flag, note`.
- One row per filled answer. Tables expand to one row per filled input cell.
- Same flag/note repeats for every cell of a flagged table block (block-level
  annotation).
- Filename: `<session>_answers_<timestamp>.csv`.
- Disabled when no participants are enrolled.

### 2.6 Trainer annotations (flag + note)

**Schema:** `answer_notes` table (`supabase/add_answer_notes.sql`):

```
id, session_id, participant_id, block_id, trainer_id, note, flag,
created_at, updated_at,
unique (session_id, participant_id, block_id)
```

**RLS:** trainers only — participants cannot read or write notes via any
path. Trainers can read all notes; only trainer who wrote a note can update;
any trainer can delete.

**Realtime:** `answer_notes` is added to `supabase_realtime` so co-trainer
edits appear live.

**Hook:** `src/hooks/useSessionNotes.js` — loads notes by `[participantId][blockId]`,
exposes `saveNote` (upsert) and `deleteNote`. Subscribes to realtime updates.

**UI:**
- Inline editor lives under each fillable block in two places:
  1. **By exercise** tile body (`ExerciseResponses.jsx`).
  2. **Participants** tab → side answers panel (`SessionDashboardPage.jsx`).
- Component: `src/components/dashboard/NoteRow.jsx` (shared between both).
- Collapsed state: `+ Note / flag` button if empty; otherwise icon + note text + Edit.
- Editing state: textarea + "🚩 Flag for follow-up" checkbox + Save / Cancel /
  Delete.
- Tile header surfaces 🚩 N (red) + 💬 N (blue) badges; tile border tints red
  when there's any flag.

**Scope decision (v1):**
- Block-level only (one note per block, not per cell). Per-cell precision
  deferred unless asked for.

---

## 3. Per-session workbook clones

**Goal:** each session owns its own deep copy of the chosen template
workbook. Edits made from the session dashboard never affect other sessions
or the template.

**Schema:** `workbooks` gains:
- `is_template boolean not null default true` — templates show on the trainer
  home; session-copies (`is_template=false`) are hidden.
- `template_id uuid references workbooks(id) on delete set null` — each
  clone records its parent template (cosmetic; not load-bearing).

**RPC:** `create_session_with_workbook_clone(p_template_id, p_name, p_starts_at, p_ends_at, p_city_code) → session id`
clones the workbook + sections + blocks (preserving order, regenerating ids
via `gen_random_uuid()`) and inserts the session row in a single transaction.
Lives in `supabase/add_workbook_templates.sql`.

**UI changes:**
- `useTrainerWorkbooks` filters to `is_template = true` so session-copies
  don't show on the trainer home.
- `NewSessionPage` workbook picker filters to templates and now calls the
  RPC instead of inserting a session row directly.
- `ImportWorkbookPage` and `NewWorkbookPage` set `is_template: true` on
  insert (matches the column default; explicit for clarity).
- `SessionDashboardPage` hero adds an `✎ Edit workbook` link — the only
  trainer-visible path to a cloned workbook's editor.

**One-time:** the migration deletes pre-rollout sessions (those still
pointing at a template workbook). New sessions all go through the RPC.

---

## 4. Session metadata

### 3.1 Date range and city code

**Schema:**
- `sessions.starts_at` and `sessions.ends_at` already existed (timestamptz,
  nullable) — exposed in the UI for the first time.
- `sessions.city_code` added by `supabase/add_session_city_code.sql` with a
  `^[A-Z]{3}$` check constraint.

**Form:** `src/pages/NewSessionPage.jsx` adds:
- HTML date inputs for from / to (both optional).
- 3-letter city-code input (auto-uppercase, monospace, `maxLength=3`).
- Validation: city must match `^[A-Z]{3}$` if filled; end date can't precede start.

**Where it's displayed:**
- **Trainer home** (`TrainerHomePage.jsx`): city code as a black pill in the
  session card; date range below the workbook title.
- **Trainer dashboard** hero: city pill inline with the session name; date
  range appended to the workbook title line.
- **Participant view** hero (`ParticipantWorkbookPage.jsx`): city pill next to
  workbook title; session name + date range; workbook description.

**Deferred:**
- **Editing existing sessions** (only create flow exists today).
- **Date-based access enforcement** (currently dates are display-only;
  participants can fill in answers regardless of `starts_at` / `ends_at`).

---

## 5. Participant experience

**Code:** `src/pages/ParticipantWorkbookPage.jsx`, `src/hooks/useWorkbook.js`.

- Hero now shows session name, date range, city code, and workbook description.
- **Left sidebar** with the same look as the trainer's By-exercise sidebar:
  - First entry: **All exercises** (default — the original single-page workbook).
  - Then one row per section with **personal progress** (`5/8 answered` + mini bar).
- **Selecting a specific exercise** filters the main pane to just that section's
  blocks — focused workspace, less scrolling.
- Mobile (<800 px) → sticky `<select>`.

**Access control:**
- Existing RLS (`workbooks_participant_read`, `sections_participant_read`,
  `blocks_participant_read`, `answers_self_*`) restricts each participant to
  the workbook of sessions they're enrolled in. They cannot query or write
  outside their own session.
- **Multi-session participants**: `useWorkbook` does `.limit(1)` on enrolled
  sessions — picks the first one returned. If a participant ever joins a
  second session, they'd be stuck on whichever loaded first. Deferred:
  add a session picker for multi-enrollment.

---

## 6. Auth — password reset

### 5.1 Forgot password

**Code:** `src/pages/ForgotPasswordPage.jsx`, route `/forgot-password`.

- Public page with email input.
- Submits to `supabase.auth.resetPasswordForEmail(email, { redirectTo: '${origin}/reset-password' })`.
- Always shows a generic "if an account exists, a link was sent" — never
  reveals which emails are registered (avoids account-enumeration).
- Rate-limit errors are silently swallowed.
- Linked from the LoginPage.

### 5.2 Reset password

**Code:** `src/pages/ResetPasswordPage.jsx`, route `/reset-password`.

- Public route (no `ProtectedRoute` wrapping).
- On mount: listens for `PASSWORD_RECOVERY` auth event AND calls `getSession()`
  in case the URL was already processed before the listener attached.
- If a recovery session is established → shows new-password form.
- Otherwise → shows "invalid or expired link" with a link back to forgot-password.
- On save: calls the existing `changePassword()` (so `must_change_password`
  also gets cleared if it was set).
- After success: redirects to `/trainer` or `/workbook` based on role.

### 5.3 AuthContext additions

**Code:** `src/contexts/AuthContext.jsx`.

- New: `sendPasswordReset(email)` → wraps `supabase.auth.resetPasswordForEmail`
  with the standard `redirectTo`.
- Existing `changePassword(newPassword)` is now reused by both:
  - The first-login forced flow (`ChangePasswordPage`, unchanged).
  - The new reset-password flow.

### 5.4 Required Supabase configuration

In Supabase Studio → **Authentication → URL Configuration**:

- **Site URL:** `https://pstrainingres.vercel.app`
- **Redirect URLs (allow-list):**
  - `https://pstrainingres.vercel.app/reset-password`
  - `http://localhost:5174/reset-password` (for local dev)

Without this, the email link will refuse to land on `/reset-password`.

### 5.5 Email delivery

Out of the box, Supabase's built-in email service sends the reset email
(rate-limited ~3–4/hr free, ~30/hr Pro). For production: switch to one of
Office 365 SMTP relay, Send Email Hook → Power Automate, or a custom Edge
Function. Full decision tree and step-by-step setup for the Power Automate
path: [`docs/auth-email-setup.md`](./auth-email-setup.md).

---

## 7. Roles, vendors, and admin pages (v2)

The five-tier role model and the two admin pages that act on it. Full
specification + decisions live in
[`docs/vendor-trainer-model.md`](./vendor-trainer-model.md). This is the
shipped-summary view.

### 7.1 Role tiers

`profiles.role` now takes one of: `super_admin`, `super_trainer`,
`vendor_manager`, `vendor_trainer`, `participant` (commit `4e44ef7`).
Helpers in `src/lib/roles.js` (`isSuperTrainerOrAbove`,
`isVendorTrainerOrAbove`, etc.) — never compare role strings inline.
TopBar shows a colored tier chip beside the user's name (`bd2744a`).

### 7.2 Vendors

New `vendors` table (migration `supabase/add_vendors_and_roles.sql`).
Every non-super profile and every session belongs to a vendor.

**Vendors admin page** at `/trainer/vendors` (commit `11fae8c`,
super-tier only): list / inline-add / rename / delete. Delete is
blocked if the vendor has any trainers or sessions.
Files: `src/hooks/useVendors.js`, `src/pages/VendorsAdminPage.jsx`.

### 7.3 Staff admin

**Staff admin page** at `/trainer/staff` (commits `1290b51`, `acf56e5`,
super-tier only): list vendor managers + vendor trainers, filterable by
vendor; add staff (with auto-generated temp password regenerated per
row); reassign a staff member to another vendor; reset temp password;
hard-delete (drops both `profiles` row and `auth.users` row so the
email can be re-invited fresh).

Edge functions: `supabase/functions/create-staff`, `delete-staff`,
`reset-staff-password` — all super-tier gated.

### 7.4 What's NOT yet wired (Phase C — see vendor-trainer-model.md)

The 5-tier model is enforced at the DB layer by RLS, but several pages
still render as if every trainer-tier user were super_admin. Phase C
fixes this page by page. **C1 shipped — see §11.1 below.** Remaining:
C3 (NewSessionPage tier-aware pickers), C4 (TrainerHomePage full tier
branching — partially done as part of C1). C2 was dropped: the People
page was removed entirely (see §8.6) since participant management is
now per-session only.

---

## 8. Session-first participant enrolment + per-session usernames (v2)

Shipped on 2026-05-18 (commits `226f2f3`, `59e72b2`, `fee8f90`).
Replaces the old "create accounts on People page, then enrol via
dropdown" flow with "create a session, add participants directly inside
it." See [[session-first-enrolment]] memory + `vendor-trainer-model.md`
for full decision history.

### 8.1 The identity model

Participants are identified by a **username**, unique *per session*
(not global). Supabase Auth requires an email-format identifier, so the
server synthesizes one when needed:

- Plain username (e.g. `jane.doe`) →
  `jane.doe@{join_code.lowercase}.pstrainingres.local`
- If the trainer types a value containing `@` → used as a real email
  (D9 escape hatch; those participants log in via `/login`, not `/join`).

Two "john"s in two parallel sessions are independent auth accounts.

### 8.2 Session join codes

`sessions.join_code` — 6 chars from
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no confusable 0/O/1/I). Generated
by `gen_join_code()` SQL function used as the column default, so new
sessions get one automatically. Backfilled for existing rows. Migration:
`supabase/migrations/20260518000000_session_join_code.sql` (idempotent
— pre-applying it manually via SQL Editor doesn't break the integration
re-run on push).

### 8.3 Public `/join/:code` page

`src/pages/JoinSessionLoginPage.jsx`, route `/join/:code`. Public (like
`/login`). On mount, calls
`get_session_by_join_code(p_code)` — a SECURITY DEFINER RPC that
exposes only `id, name, starts_at, ends_at, join_code` to anon
(migration `20260518000001_get_session_by_join_code.sql`). Renders
session header + username/password form. On success, redirects to
`/workbook`. Case-insensitive on the URL `:code` segment.

### 8.4 Add participants from inside a session

`SessionDashboardPage` → **+ Add** opens
`src/components/dashboard/AddSessionParticipants.jsx`:

- **Add one** mode: username + optional full name. Server generates a
  10-char temp password and returns it in the results row.
- **Upload CSV** mode: `participants_template.csv` is `username,
  full_name`. No `temp_password` column — server always generates and
  returns one per row in the results table for the trainer to share.
- Backed by `supabase/functions/add-session-participants/`. Auth: super
  tier OR vendor_manager of the session's vendor OR the session's
  trainer. Refuses cross-vendor email reuse on the real-email path.

### 8.5 Per-row password reset

Each participant row has a **Reset pwd** action next to Delete.
Click → confirm → server generates a new temp password, sets
`must_change_password=true`, and the new password renders inline with a
Copy button for the trainer to share. Backed by
`supabase/functions/reset-participant-password/`. Auth: super tier OR
the session's trainer.

### 8.5a Per-row hard delete

Each participant row has a **Delete** action. Click → confirm → server
hard-deletes the auth user, which cascades through `profiles →
session_participants → answers` via the schema's `ON DELETE CASCADE`
chain. One call wipes the participant, their enrolment in this session,
and every answer they submitted.

Backed by `supabase/functions/delete-participant/`. Auth: super tier OR
vendor_manager of `sessions.vendor_id` OR `sessions.trainer_id ===
caller.id` (mirrors `add-session-participants`).

Replaces the earlier "Remove" action which only deleted the
`session_participants` row — that left an orphan auth account that
couldn't log back in (the join-code-namespaced email no longer matched
an enrolment) and orphan `answers` rows attached to the deleted
enrolment. Hard delete is the safe default under the plain-username
policy (each account is single-session by design).

### 8.6 Other touch-ups in the same push

- **`SessionDashboardPage` hero**: third line shows
  `Join URL: https://…/join/<CODE>` with a Copy button.
- **People page removed entirely** (originally became a read-only
  roster on 2026-05-18; deleted on 2026-05-18 since per-session
  enrolment is now the only path). Removed: `src/pages/PeoplePage.jsx`,
  `src/hooks/useParticipants.js`, `/trainer/people` route, TopBar
  "People" link, and the `create-participant` edge function +
  `[functions.create-participant]` config block. `generateTempPassword`
  moved to `src/lib/passwords.js` (still used by StaffAdminPage).
- **`vercel.json`** at repo root: catch-all rewrite to `/index.html`.
  Without it, direct hits to `/join/:code` (or any deep link in
  incognito) returned Vercel's edge 404. See [[vercel-spa-rewrite]].

---

## 9. Deploy infrastructure (v2)

### 9.1 Supabase ↔ GitHub integration

Both **edge functions** AND **migrations** auto-deploy on push to
`main`. `supabase/config.toml` registers `project_id` and one
`[functions.<name>]` block per function. Migrations live under
`supabase/migrations/` with timestamped filenames; the integration
tracks applied versions in `supabase_migrations.schema_migrations`. See
[[supabase-deploy-via-github]].

**Rule: every migration must be idempotent.** The integration's
migration tracker is invisible to anything we apply manually via SQL
Editor (commonly done for localhost smoke testing), so on push the
integration re-runs the file. Use `add column if not exists`,
`create or replace function`, and wrap `add constraint` in a
`pg_constraint` lookup. A failure here halts the whole pipeline,
including the edge-function deploy. See [[supabase-idempotent-migrations]].

### 9.2 Vercel SPA rewrite

`vercel.json` at repo root rewrites all paths to `/index.html` so
React Router can handle deep links. Vercel still serves static assets
(`/assets/*`, favicon) before applying the rewrite. Don't remove or
narrow this without a replacement — see [[vercel-spa-rewrite]].

---

## 10. Migrations summary

**v1 + v2 migrations** in `supabase/` (applied by hand in the SQL Editor
in this order, before the GitHub-integration migration directory existed):

1. `supabase/add_email_to_profiles.sql`
2. `supabase/add_answer_notes.sql` — trainer annotations
3. `supabase/add_session_city_code.sql` — city code column on sessions
4. `supabase/add_workbook_templates.sql` — per-session workbook clones,
   `create_session_with_workbook_clone` RPC, one-time wipe of legacy
   sessions still pointing at template workbooks.
5. `supabase/add_vendors_and_roles.sql` — vendors table + 5-tier role
   enum + RLS helpers (`is_super_trainer_or_above()`,
   `trainer_vendor_id()`, etc.).

**v2.1 migrations** under `supabase/migrations/` (auto-applied by the
Supabase ↔ GitHub integration on push to `main`; tracked in
`supabase_migrations.schema_migrations`):

6. `20260518000000_session_join_code.sql` — `sessions.join_code`
   column, `gen_join_code()` generator, backfill, unique constraint.
   Idempotent.
7. `20260518000001_get_session_by_join_code.sql` — SECURITY DEFINER
   RPC for anon lookup of `id, name, starts_at, ends_at, join_code` by
   join code (used by `/join/:code`).

Going forward, every new migration should land under
`supabase/migrations/` with a timestamped filename and be **idempotent**
(see [[supabase-idempotent-migrations]]).

---

## 11. Next steps

The full Phase C plan + Phase A/B/session-first decision history lives in
[`docs/vendor-trainer-model.md`](./vendor-trainer-model.md). Below is the
current operational + UX backlog, ordered by recommended priority.

### 11.1 Phase C — tier-aware UI

The 5-tier role model is enforced at the DB layer by RLS. Phase C makes
the UI match, page by page.

#### C1 — WorkbookEditorPage + TrainerHome partial gating *(shipped 2026-05-18)*

`WorkbookEditorPage.jsx`: computes
`canEdit = !isTemplate || isSuperTrainerOrAbove(profile?.role)`.

- When `canEdit` is false (vendor-tier viewing a template), the page
  short-circuits to a clean **read-only viewer** — TopBar + hero with
  just the workbook title + Back link + an Exercises sidebar (same
  styling as ParticipantWorkbookPage) + main pane rendering each
  selected section's blocks via `<Block>`. No editor pane, no preview
  toggle, no form inputs, no action buttons.
- When `canEdit` is true, the original editor renders unchanged.
- Defense-in-depth: gating is UI-only; RLS (`workbooks_template_super_all`,
  `blocks_write`, `sections_write` in `add_vendors_and_roles.sql`) is
  the actual guard. Direct URL to a template as vendor-tier lands on
  the read-only view; any write attempt would 401 server-side.

`TrainerHomePage.jsx`: hides `+ New workbook` and `↑ Import .docx`
unless `isSuperTrainerOrAbove(role)`. `+ New session` stays for all
trainer tiers. Also dropped the "Manage workbooks…" hero subtitle (it
implied capabilities vendor tiers don't have).

`BlockListItem.jsx`: accepts a `canEdit` prop (defaults to true) that
hides the per-block action toolbar. Not exercised by `WorkbookEditorPage`
anymore (the early-return handles it), but kept as a defensive default
for any future caller.

`src/styles/dashboard.css`: bumped specificity of the
`.exresp-sidebar-item:hover` / `.active` rules using the doubled-class
trick (`.exresp-sidebar-item.exresp-sidebar-item:hover`) so they win
against the global `button:hover:not(:disabled)` (which has higher
specificity than a single class). Without this, the navy global hover
won and dark sidebar text became unreadable — fixes the same issue on
the participant workbook sidebar too.

#### Remaining Phase C work

- **C2 — dropped.** Plan was to vendor-scope the People page roster.
  Instead the page was removed entirely on 2026-05-18 (see §8.6) since
  participant management is per-session-only and a generic cross-vendor
  roster has no role-appropriate reader.
- **C3 — NewSessionPage:** auto-set `vendor_id` from caller's profile
  for `vendor_trainer`; for `vendor_manager`, pin to their vendor with
  a trainer picker filtered to their vendor; for super, show both
  pickers unfiltered.
- **C4 — TrainerHomePage (rest):** full tier branching — super sees
  vendor cards grid + full workbook library; vendor manager sees their
  vendor's sessions + read-only library; vendor trainer sees their own
  sessions + read-only library. (C1 already removed authoring actions
  for vendor tiers; the per-tier session/workbook scoping is still TODO.)

Per-step approach: build → smoke test on localhost → commit → push.
Avoids landing a multi-page diff and discovering one broke downstream.

### 11.2 Operational backlog

1. **Edit existing sessions** — change name/dates/city/trainer after
   creation. Today only the create flow exists.
2. **Date-based access enforcement** — read-only after `ends_at`,
   hidden before `starts_at`.
3. **Multi-session handling** — session picker on participant landing
   if enrolled in more than one session. Today `useWorkbook` does
   `.limit(1)` and silently picks one.
4. **Archive old sessions** — derive from `ends_at < today`; hide from
   the home page until "show archived" toggled.
5. **Pick an email delivery option** for staff/super password reset
   flows — see `docs/auth-email-setup.md`. (Participants use temp
   passwords and `/join/:code`, so this is now staff-only.)
6. **Docx import: preserve header-row `colspan` / `rowspan`** — body
   merging is done; headers still flatten. See
   `docs/docx-importer-next.md` §8.
7. **Bundle code-splitting** — main bundle is ~520 kB; lazy-load the
   editor and dashboard routes.

### 11.3 Forward-looking UX

Live focus / spotlight, model-answer debrief, mobile-responsive fill,
⌘K palette, session PDF — scoped in `docs/enhancements-roadmap.md`.
