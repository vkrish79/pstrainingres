# Vendor + trainer role model — planning doc

**Status:** Phase A and Phase B shipped to prod (2026-05-13). Vendors admin
+ staff admin (create, reassign vendor, reset password, hard delete) are
live. Supabase ↔ GitHub integration is now wired so edge functions and
future migrations auto-deploy on push to `main`.

**Mid-stream change before Phase C:** session-first enrolment + username
identity model. Half-built in the working tree as of end-of-day 2026-05-13,
**not yet committed.** Resumes tomorrow with the Path 2 (session-scoped
join codes) decision below. After this lands, Phase C resumes from C1.

## Build progress (2026-05-13)

### ✅ Done and deployed to prod

Two commits on `main`:

- **`4e44ef7`** — vendor + 5-tier role model
  - `supabase/add_vendors_and_roles.sql` migration (applied manually in
    Supabase SQL editor)
  - `src/lib/roles.js` central tier helpers
  - `TopBar`, `ProtectedRoute`, `ChangePasswordPage`, `ResetPasswordPage`
    updated to use the helper (no more `role === 'trainer'` string checks)
  - `supabase/functions/create-participant/index.ts` updated to accept all
    four trainer-tier roles and stamp `vendor_id` on the new participant
  - This doc with the full role-tier spec and decisions
- **`bd2744a`** — TopBar role chip (gold = super_admin, midnight = super_trainer,
  qasr = vendor_manager, outline = vendor_trainer; no chip for participant)

### ✅ Done manually in Supabase (not in source)

- Auth users created via Supabase Dashboard for the two super trainers
  whose accounts didn't exist yet:
  - `MFeroz@etihad.ae` (Feroz)
  - `MRMarleen@etihad.ae` (Riznie Marleen)
- Their `profiles` rows inserted with `role='super_trainer'` via SQL editor.
- Final state: four super-tier accounts exist —
  - `vbalasubramanian@etihad.ae` → `super_admin`
  - `EnsioM@etihad.ae` → `super_trainer`
  - `MFeroz@etihad.ae` → `super_trainer`
  - `MRMarleen@etihad.ae` → `super_trainer`

### ✅ Phase A shipped (commit `11fae8c`)

Vendors admin page at `/trainer/vendors`:
- `src/hooks/useVendors.js`, `src/pages/VendorsAdminPage.jsx`
- `ProtectedRoute` extended for `role="super"`; `TopBar` shows "Vendors"
  to super-tier only.

### ✅ Phase B shipped (commits `1290b51`, `560450b`, `acf56e5`)

Staff admin page at `/trainer/staff` + Supabase GitHub integration wired:
- `supabase/functions/create-staff`, `delete-staff`,
  `reset-staff-password` — all super-tier gated.
- `supabase/config.toml` — registers project + functions for auto-deploy
  on push.
- `src/hooks/useStaff.js`, `src/pages/StaffAdminPage.jsx` — add /
  reassign-vendor / reset-temp-password / hard-delete.
- `TopBar` shows "Staff" between "Vendors" and "People" to super-tier.

### Vendors page smoke test (run on resume)

1. Log in as `vbalasubramanian@etihad.ae`. TopBar should show
   **Home | Vendors | People** + gold "SUPER ADMIN" chip.
2. Click **Vendors** → lands on `/trainer/vendors`, empty table.
3. Add a vendor: code `ETIHAD`, name `Etihad Airways`. Should appear in
   the table with `0` trainers and `0` sessions.
4. Try a bad code (`etihad` or `ETI HAD`) — must be rejected with
   "Use 2–12 chars, A–Z / 0–9 / _ only."
5. Try the same code twice — must show "A vendor with code ETIHAD already exists."
6. Click **Edit** → rename to `Etihad` → **Save** — row updates inline.
7. Click **Delete** on an empty vendor → confirm → vendor removed.
8. (Optional) Log in as Ensio — should also see the **Vendors** link
   and have access (super_trainer).
9. (Optional) Log in as a participant — should NOT see the link;
   visiting `/trainer/vendors` directly should redirect to `/workbook`.

If anything fails, share the error and I'll fix before committing.

### Decisions locked for Phase A (so they don't need to be re-debated)

- **Code is immutable after creation.** Only Name is editable.
- **Hard delete, blocked when in use.** When the vendor has any trainers
  (`profiles.vendor_id`) or sessions (`sessions.vendor_id`) referencing it,
  the Delete action shows a message telling the user to reassign or
  remove those first. No soft-delete column.
- **Access:** super-tier only (super_admin + super_trainer). Vendor
  managers and trainers cannot reach this page even though their RLS
  lets them read the vendors table (for vendor pickers elsewhere).
- **List columns:** Code · Name · # Trainers (managers + trainers in
  that vendor) · # Sessions · Created · Actions.
- **Form layout:** inline add form at the top of the page, matches
  People page pattern.

### 🟡 In progress — Session-first enrolment + username identity (resumes 2026-05-14)

**Goal:** trainer creates a session, then adds participants directly inside
that session — by direct entry or by uploading a CSV template. No more
"go to People page → create account → come back to session → pick from
dropdown" workflow.

#### Decisions locked (2026-05-13)

- **D6 — Workflow is session-first.** Participants are added in the context
  of a session, not on the People page. People page becomes a read-only
  roster. Single workflow is easier to teach.
- **D7 — Two add modes per session:**
  - **Add one** — inline form with username, full name (optional). Submits
    a one-row batch to the edge function.
  - **Upload CSV** — trainer downloads a lightweight template, fills it in
    Excel, uploads. Server processes the batch.
- **D8 — CSV template columns: `username`, `full_name`.** No `temp_password`
  column. Server auto-generates a secure 10-char temp password for every
  new row and returns it in the per-row results table for the trainer to
  share. The original 3-col template (email/full_name/temp_password) and
  the `email` field on the direct-add form get renamed to `username` and
  the temp_password column dropped before commit.
- **D9 — Identity model: username, not email.** Supabase Auth requires an
  email-format string, so the server synthesizes one when needed. If the
  trainer types a value containing `@`, it's used as the real email.
  Otherwise the server appends a sentinel domain (see D10).
- **D10 — Sentinel domain is `pstrainingres.local`.** RFC-reserved for
  local hostnames, won't collide with real mail.
- **D11 — Username uniqueness is per-session, NOT global** (resolves the
  "two johns in parallel sessions" concern). See Path 2 below.
- **D12 — Session join code + `/join/:code` URL.** Each session gets a
  short opaque `join_code` (random 6 chars, A–Z/0–9, generated at session
  creation). Participants log in via `/join/:code` which renders a
  session-scoped login form (username + password). Trainers and super
  continue to use `/login` with their real email — that path is unchanged.

#### Path 2 implementation plan (build order)

1. **Migration `supabase/migrations/<ts>_session_join_code.sql`** — adds
   `sessions.join_code text unique not null default <generated>`. Use a
   small SQL function `gen_join_code()` that picks 6 chars from
   `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no confusing 0/O, 1/I). Backfill
   existing sessions with unique codes in the same migration. This is
   the first migration to ride the Supabase ↔ GitHub integration —
   verify it auto-applies on push.
2. **Update `create_session_with_workbook_clone` RPC** (or its caller) to
   generate the join_code at session creation. Simplest: column default
   does it; no RPC change needed.
3. **Edge function `supabase/functions/add-session-participants/index.ts`**
   — already drafted in the working tree, needs reworking:
   - Accept `username` (not `email`) in body rows.
   - Build synthetic auth email: if username contains `@`, use as-is;
     else `${username}@${join_code}.${SENTINEL_DOMAIN}` where SENTINEL_DOMAIN
     is `pstrainingres.local`. This namespaces the email per session, so
     `john` in session ABCDEF and `john` in session GHJKLM are independent
     auth accounts with emails `john@abcdef.pstrainingres.local` and
     `john@ghjklm.pstrainingres.local`.
   - On duplicate-in-session: return `already_enrolled`.
   - On "username exists for this session's join_code but in a different
     session" → can't happen by construction (join_code is unique to session).
   - On "username already in another vendor": same vendor isolation rule
     still applies — synthesize the email, look up by it, error if the
     existing profile's vendor differs from the session's vendor.
4. **CSV helpers `src/lib/csv.js`** — drop `temp_password` column from
   template + parser; rename `email` → `username`. Already drafted in
   working tree; needs the rename.
5. **`AddSessionParticipants.jsx`** — rename Email field to Username;
   drop "temp password" input from the direct-entry form (server always
   generates). Results table shows the requested username + assigned
   temp password.
6. **New route `/join/:code`** — `src/pages/JoinSessionLoginPage.jsx`:
   - Look up session by `join_code`. If not found, show "Session not found"
     and a link to `/login`.
   - Show session name + cohort dates as the page header.
   - Username + Password fields. On submit, construct synthetic email
     `${username}@${join_code}.pstrainingres.local` and call
     `supabase.auth.signInWithPassword`.
   - On success, redirect to `/workbook`.
7. **`SessionDashboardPage.jsx`** — show the join code + share link
   prominently in the session header so trainer can copy/paste it to
   participants. Format: "Join URL: <https://pstrainingres.vercel.app/join/ABCDEF>".
8. **`PeoplePage.jsx`** — remove the "Add a participant" form. Already
   drafted in the working tree as a read-only roster.
9. **Login form `LoginPage.jsx`** — no change. Trainers/super still log
   in via email + password. Only participants use `/join/:code`.

#### What's already in the working tree (uncommitted)

Files modified or created on 2026-05-13, NOT committed because the
identity model changed (D11/D12) and the code needs reworking before
push:

- `src/lib/csv.js` — CSV helpers. **Currently uses `email` + `temp_password`
  columns; needs rename to `username` and drop `temp_password`.**
- `supabase/functions/add-session-participants/index.ts` — edge function.
  **Currently uses single global sentinel `@pstrainingres.local`; needs
  changing to per-session `@{join_code}.pstrainingres.local`.**
- `supabase/config.toml` — added entry for the new function.
- `src/hooks/useSessionDashboard.js` — replaced `addParticipant(id)` with
  `addSessionParticipants(rows)` calling the edge function. ✅ Keep as-is.
- `src/components/dashboard/AddSessionParticipants.jsx` — new component
  with two modes. **Currently uses "Email" label and exposes temp password;
  needs rename to "Username" and drop temp password input.**
- `src/pages/SessionDashboardPage.jsx` — replaced dropdown picker with
  the new component. ✅ Keep, plus add join-code/share-URL display.
- `src/pages/PeoplePage.jsx` — stripped the add form. ✅ Keep as-is.

#### Migration sketch for `sessions.join_code`

```sql
-- supabase/migrations/<ts>_session_join_code.sql

create or replace function gen_join_code()
returns text language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  ok boolean := false;
begin
  while not ok loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    -- check uniqueness
    perform 1 from sessions where join_code = code;
    if not found then ok := true; end if;
  end loop;
  return code;
end;
$$;

alter table sessions
  add column join_code text;

-- backfill existing rows one at a time so each gets a unique code
do $$
declare r record;
begin
  for r in select id from sessions where join_code is null loop
    update sessions set join_code = gen_join_code() where id = r.id;
  end loop;
end;
$$;

alter table sessions
  alter column join_code set not null,
  alter column join_code set default gen_join_code(),
  add constraint sessions_join_code_unique unique (join_code);
```

(Defer: case-insensitivity at the SQL layer — handle in the app by
upper-casing the URL param before query.)

#### Resume checklist (2026-05-14)

1. Read this section + the working-tree status above.
2. Decide if anything in D6–D12 needs a second look before building (e.g.
   should the trainer be able to *override* the auto-generated temp
   password from the direct-entry form? See D8 — currently no.).
3. Build in the order listed under "Path 2 implementation plan."
4. Use the migration as the first test of the Supabase ↔ GitHub
   integration's migrations leg.
5. Smoke test against prod: create a session as a vendor_trainer, copy
   the join URL, open it in an incognito window, log in with the
   username you just created. Two parallel sessions, both with a "john"
   — confirm they're independent auth accounts (different `auth.users.id`
   in Supabase Dashboard).
6. Commit + push as a single feature commit ("Session-first enrolment +
   per-session usernames"). Then resume Phase C from C1.

---

### 🔲 Pending — Phase C (after session-first enrolment lands)

Wire the existing pages to actually use the new tiers. Today RLS allows
vendor isolation, but the UI pages still load and render as if every
trainer-tier user is a super_admin — leaks cross-vendor names, lets
vendor trainers see the "Edit template" buttons even though their write
would fail at the DB layer, etc.

Sub-tasks, **ordered by priority** (security/correctness first, UX
polish later):

- **C1 — WorkbookEditorPage:** gate template structural edits on
  `isSuperTrainerOrAbove(role)`. Hide "Edit", "Delete workbook",
  "Add section/block" buttons for non-super on template (non-cloned)
  workbooks. Smallest change; closes a UI leak.
- **C2 — PeoplePage:** for vendor-tier callers, filter the participant
  list to `vendor_id = trainer_vendor_id()`. Add a vendor filter for
  super-tier so they can scope while testing. Also extend
  `create-participant` UI to expose `vendor_id` to super (the edge
  function already accepts it; the page doesn't pass it yet).
- **C3 — NewSessionPage:** auto-set `vendor_id` from caller's profile
  for `vendor_trainer`; for `vendor_manager`, pin to their vendor and
  show a `trainer_id` picker filtered to `vendor_trainer` rows in
  their vendor; for super, show vendor + trainer pickers (all vendors,
  all trainers).
- **C4 — TrainerHomePage:** branch by tier.
  - Super: vendor cards grid (name, # active sessions, # trainers) →
    drill into vendor; below, full workbook library with "+ New" /
    "Import .docx".
  - Vendor manager: their vendor's session list + read-only workbook
    library.
  - Vendor trainer: their own sessions only + read-only workbook
    library.
  Biggest change of the four — pure UX. Save for last.

Per-step approach: build C1, smoke-test, commit, push. Then C2, etc.
Avoids landing a 4-page diff and discovering one of them broke
something downstream.

## Confirmed decisions

### Role tiers (final)

Five tiers. `profiles.role` is widened from `('trainer','participant')` to
`('super_admin','super_trainer','vendor_manager','vendor_trainer','participant')`.
Each user is in exactly one tier; hierarchy is encoded in helper functions
(`is_super_trainer_or_above()`, `can_manage_vendor(v)` etc.), not in
multiple boolean flags.

| Tier | Vendor scope | Sessions | Master workbooks | Session workbooks (cloned) | Participants | Vendors / trainers admin |
|---|---|---|---|---|---|---|
| **super_admin** | global | full CRUD | full CRUD | full | full | full — plus can promote anyone to super trainer / super admin |
| **super_trainer** | global | full CRUD | full CRUD | full | full | CRUD on vendors, vendor managers, vendor trainers. **Cannot** add super trainers. |
| **vendor_manager** | one vendor | full CRUD on sessions in their vendor | read-only | read-only | add/remove/delete on any session in their vendor | — |
| **vendor_trainer** | one vendor | CRUD on **own** sessions only | read-only | **edit** the clone owned by their session | add/delete in their own sessions | — |
| **participant** | one vendor | read sessions they're enrolled in | read (via session) | read (via session) | — | — |

Notes:

- **No UI to add super trainers / super admin.** That is SQL-only;
  enforced by the deploy boundary (`vbalasubramanian@etihad.ae` is the
  only one with DB access).
- **Vendor managers can create sessions but cannot edit the cloned
  workbook.** That means session creation by a manager must let them
  pick which `vendor_trainer` from the same vendor owns the session.
  Schema allows this — `sessions.trainer_id` just needs to point at any
  vendor trainer in the same vendor. UI detail, handled at the
  session-creation page.
- Existing rows: every current `role='trainer'` becomes `vendor_trainer`
  with `vendor_id = null` → no access until a super trainer assigns
  them a vendor. Existing `role='participant'` rows: same — no vendor,
  no session access until enrolled.

### Other decisions

- **D1 — Vendors:** managed `vendors` table (not a hardcoded enum).
  **Start empty, no seed.** Super trainers add/edit/delete vendors from
  a "Manage vendors" page in the app.
- **D2 — Master workbooks:** shared library — all templates visible to
  all vendor trainers; super trainers curate the one canonical library.
  Upgrade to mixed (nullable `vendor_id` per template) later if
  vendor-confidential content ever appears.
- **D3 — Participants:** vendor-scoped. `profiles.vendor_id` set on
  participant creation; pickers and RLS filter on it. Same human
  attending under two vendors = two participant rows.
- **D4 — Super-trainer roster (provided 2026-05-13):**
  - `vbalasubramanian@etihad.ae` — super admin (also flagged super trainer)
  - `MRMarleen@etihad.ae` — Riznie Marleen
  - `MFeroz@etihad.ae` — Feroz
  - `EnsioM@etihad.ae` — Ensio
- **D5 — Vendor-trainer invites:** email + temp password (reuses
  existing participant-add code path). Magic-link invites deferred.

### Caveat on D4 — account existence

The migration uses `update profiles set … where email in (…)`. Rows are
flipped only for accounts that already exist. If any of the four
addresses above doesn't yet have a `profiles` row, the migration will
skip it silently — that account will need a re-run after signup, or
a trigger on signup to auto-apply the flag. To confirm before running:

```sql
select email, role, is_super_trainer, is_super_admin
from profiles
where email in (
  'vbalasubramanian@etihad.ae',
  'MRMarleen@etihad.ae', 'MFeroz@etihad.ae', 'EnsioM@etihad.ae'
);
```

---

## What the user asked for

- **Vendors** are the top-level grouping. Each vendor has its own trainers
  and runs its own sessions. Examples: airlines, training companies, etc.
- **Vendor trainers** belong to one vendor. They can:
  - Create sessions at any **venue** (BLR / MNL / CAI / AUH).
  - Add participants to their own sessions.
  - Deliver training — including using the trainer practice copy.
  - **Cannot** edit master workbooks (templates).
  - See / manage **only their own vendor's sessions and participants**.
- **Super trainers** manage everything end-to-end:
  - Create vendor records.
  - Create / edit / delete master workbooks.
  - Add vendor trainer accounts and assign them to vendors.
  - View and manage all sessions across all vendors and venues.
- **Participants** unchanged in role, but probably need vendor scoping
  too (see Decision 3 below).
- **Venue** (the BLR / MNL / CAI / AUH `city_code`) is now just a session
  attribute — not used for trainer access control. The 4-card UI block
  the user mentioned earlier becomes "vendor cards" instead, with venue
  as a filter inside a vendor's view.

---

## Where this lands in the existing model

Today (`supabase/schema.sql`):
- `profiles.role` is `'trainer' | 'participant'` — no vendor link, no
  super-tier marker.
- `sessions.city_code` already represents venue. Stays.
- `workbooks_trainer_all` policy lets every trainer edit every workbook.
  Needs splitting: super-only on templates.

Migration footprint:
- New `vendors` table (or hardcoded constant — see Decision 1).
- `profiles.vendor_id` (nullable — supers and participants may be
  vendor-less, see Decision 3).
- `profiles.is_super_trainer boolean default false`.
- Sessions get a `vendor_id` (so a session is owned by a vendor, not
  inferred from its trainer's vendor — more robust if a trainer changes
  vendors later).
- RLS splits across workbooks, sections, blocks, sessions,
  session_participants, answer_notes — all become vendor-aware.

---

## Open decisions to confirm before implementing

### 1. Vendors — closed enum or managed table?

The user said vendors can have multiple venues, multiple trainers, and
sessions belong to vendors. Vendors look durable enough to deserve their
own table:

```sql
create table vendors (
  id uuid primary key default gen_random_uuid(),
  code text unique not null check (code ~ '^[A-Z0-9_]{2,12}$'),
  name text not null,
  created_at timestamptz not null default now()
);
```

Super trainers manage rows in this table from a new admin UI.

**Recommendation:** managed table. Hardcoded vendors don't fit the "super
adds vendor trainers" workflow if a vendor has to be deployed to exist.

### 2. Are master workbooks shared across all vendors, or vendor-private?

When a super trainer creates a master workbook (template), can vendor
trainer A from Vendor X **see and clone** it to start a session for
Vendor X? What about Vendor Y's trainer — same workbook?

- (a) **Shared library:** all templates are visible to all vendor
  trainers. Super trainers curate one canonical library. Simplest.
- (b) **Vendor-scoped templates:** templates have a `vendor_id`; vendor
  trainers see only their vendor's templates. Super trainers see all.
- (c) **Mixed:** templates can be either shared (`vendor_id = null`,
  visible to all) or vendor-private. Super trainers decide per template.

**Recommendation:** start with (a) shared library. Promote to (c) only if
vendors actually have non-overlapping content. Most training content is
content-licensed, not vendor-specific.

### 3. Are participants vendor-scoped?

When a vendor trainer adds a participant to their session, does that
participant belong to the vendor (so they don't appear in another
vendor's "+ Add participant" picker)?

- (a) **Global participant pool:** all trainers see all participants in
  the picker. Simplest, but Vendor X's people show up to Vendor Y's
  trainers — privacy concern.
- (b) **Vendor-scoped participants:** `profiles.vendor_id` set on
  participant creation; vendor trainers can only enroll their own
  vendor's participants. Super trainers see all.

**Recommendation:** (b). It's the natural extension of vendor scoping
and the only one that doesn't leak participant identities across
vendors.

### 4. Existing trainers — who becomes super?

The user said: "I will provide a list of super trainers." Capture those
emails tomorrow and bake into the migration:

```sql
update profiles set is_super_trainer = true
where email in (
  -- list provided by user
);
```

Everyone else with `role = 'trainer'` becomes a vendor trainer with
`vendor_id = null` until super assigns them — they'll have no access
until assigned. Acceptable since the user is provisioning vendors and
trainers from scratch.

### 5. Account creation flow for vendor trainers

Super trainers add vendor trainer accounts. Two paths:

- (a) **Email/password invite:** super enters email + name + vendor; the
  app creates a `profiles` row with `must_change_password = true`,
  generates a temporary password, and shows it once for the super to
  share manually. (Same shape as the existing participant-add flow.)
- (b) **Magic-link invite:** super enters email + vendor; the system
  emails the trainer a Supabase magic link to set their password.

**Recommendation:** (a) initially — matches existing patterns. (b) is a
later polish that depends on the email-delivery decision in
`docs/auth-email-setup.md`.

---

## Migration sketch (`supabase/add_vendors_and_roles.sql`)

```sql
-- 1. Vendors table
create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  code text unique not null check (code ~ '^[A-Z0-9_]{2,12}$'),
  name text not null,
  created_at timestamptz not null default now()
);

-- 2. Profiles: vendor link + super flag
alter table profiles
  add column if not exists vendor_id uuid references vendors(id) on delete set null,
  add column if not exists is_super_trainer boolean not null default false;

-- 3. Sessions: vendor link (denormalized so trainer reassignment doesn't
--    affect session ownership)
alter table sessions
  add column if not exists vendor_id uuid references vendors(id);

-- 4. Helpers for RLS
create or replace function is_super_trainer()
returns boolean language sql stable security definer as $$
  select exists(select 1 from profiles
                where id = auth.uid() and is_super_trainer = true);
$$;

create or replace function trainer_vendor_id()
returns uuid language sql stable security definer as $$
  select vendor_id from profiles where id = auth.uid();
$$;

-- 5. Seed super trainers (list provided by user)
update profiles set is_super_trainer = true
where email in ( /* TODO: insert from user's list */ );

-- 6. RLS split: workbook templates writable by super only
drop policy workbooks_trainer_all on workbooks;
create policy workbooks_trainer_read on workbooks for select using (is_trainer());
create policy workbooks_super_write on workbooks for all
  using (is_super_trainer()) with check (is_super_trainer());
-- (cloned non-template workbooks editable by their session's vendor
-- trainer — needs a join through sessions; see TODO in this file)

-- 7. Sessions: vendor trainer can manage own vendor only; super manages all
drop policy sessions_trainer_all on sessions;
create policy sessions_super_all on sessions for all
  using (is_super_trainer()) with check (is_super_trainer());
create policy sessions_vendor_trainer_all on sessions for all
  using (is_trainer() and vendor_id = trainer_vendor_id())
  with check (is_trainer() and vendor_id = trainer_vendor_id());

-- 8. Same kind of split for session_participants, answer_notes,
--    participant profiles (Decision 3).
```

The fiddly piece (same as before): RLS for sections/blocks of cloned
workbooks. They belong to a non-template workbook → which is referenced
by a session → which has a vendor. A vendor trainer can edit those iff
the session's `vendor_id` matches theirs. Tractable but needs careful
joins.

---

## UI sketch

- `src/lib/vendors.js` — small helper to fetch + cache the vendors list.
- **Super trainer home (`TrainerHomePage.jsx` branched):**
  - Top: vendor cards grid. Each card shows vendor name, # active
    sessions, # trainers. Click → drill into that vendor.
  - Below: full workbook library with **+ New workbook** / **↑ Import .docx**.
  - "Manage trainers" link → page that lists vendor trainers and lets
    super add new ones / reassign vendors.
- **Vendor trainer home:**
  - No vendor cards — they only have one vendor.
  - Top: their vendor's sessions list (filtered by `vendor_id =
    trainer_vendor_id()`).
  - Below: workbook library, **read-only** (no "+ New" / "Import"
    buttons; "Edit"/"Delete" workbook actions hidden in the editor).
- **Session creation:** vendor trainer's `vendor_id` is auto-set;
  city_code (venue) is a free pick from the 4 venues.
- **Workbook editor:** `Delete workbook` and structural edits gated on
  `is_super_trainer || !is_template`. Vendor trainers can still edit
  cloned workbooks they own (through their session) — that's where the
  per-session clone design pays off.
- **Manage trainers page (super only):** list of vendor trainers, "+ Add
  vendor trainer" button (email + name + vendor picker), reassign
  trailing actions.
- **Manage vendors page (super only):** small CRUD on the `vendors`
  table.

---

## Build order tomorrow (smallest path that delivers the core ask)

1. Migration: `vendors` table, `profiles.vendor_id` +
   `is_super_trainer`, `sessions.vendor_id`, helper functions, RLS
   splits. Bake the user-provided super trainer emails in.
2. Seed the initial vendors (whatever the user names them).
3. `useVendors` hook + `VendorGrid` component.
4. Super trainer home: vendor grid + drill-in.
5. Vendor trainer home: their vendor's sessions only; workbook library
   read-only.
6. Session creation: auto-set `vendor_id` from the trainer's profile;
   city_code stays a free pick.
7. Workbook editor: gate template edits on `is_super_trainer`.
8. Manage trainers page (super only) — basic CRUD on vendor trainers.

Defer:
- Vendor-scoped templates (Decision 2 — start with shared library).
- Magic-link invites (Decision 5 — start with email/temp password).
- Cross-vendor live monitoring (overlaps with the spotlight/presence
  item in `docs/enhancements-roadmap.md` §1).
- Editing existing sessions to reassign vendor (probably not needed).

---

## What I need from you tomorrow

- The list of super trainer emails to bake into the migration.
- The initial set of vendor names + codes to seed (e.g.
  `code='ETIHAD', name='Etihad Airways'`).
- Confirmation on Decisions 2, 3, 5 (recommendations above).

---

## Walkthrough of the open decisions

Each of the four open decisions, with the tradeoff and a recommended call.
These are starting positions — confirm or override before the migration is
written.

### Decision 2 — Master workbooks: shared library, vendor-private, or mixed?

When a super trainer publishes a master workbook, who can clone it into a
session?

- **(a) Shared library** — every vendor trainer sees every template. One
  canonical content set.
- **(b) Vendor-scoped** — templates carry `vendor_id`; trainers see only
  their vendor's.
- **(c) Mixed** — templates can be shared (`vendor_id = null`) or
  vendor-private, decided per template.

**Tradeoff:** (a) is by far the simplest — one library, one RLS policy, no
picker on workbook creation. (b)/(c) only earn their cost if vendors
actually have non-overlapping content (e.g. Etihad-specific safety content
that shouldn't leak to another airline).

**Recommendation:** start with (a). If a vendor later needs private
content, (c) is a clean upgrade — add a nullable `vendor_id` column and
one extra RLS clause. Don't pay for that flexibility now.

**Question to confirm:** is there content today that's vendor-confidential,
or is the library essentially generic training material?

### Decision 3 — Are participants vendor-scoped?

When Vendor X's trainer types into the "+ Add participant" picker, do
Vendor Y's participants appear?

- **(a) Global pool** — all trainers see all participants. Simplest.
- **(b) Vendor-scoped** — `profiles.vendor_id` set on participant
  creation; trainers only see/enroll their own vendor's people.

**Tradeoff:** (a) leaks names/emails across vendors, which is a real
privacy issue if vendors are competitors (e.g. two airlines). (b) costs
one column and an RLS filter.

**Recommendation:** (b). The whole point of vendor scoping is isolation;
an open participant picker undermines it. The cost is tiny.

**Edge case to decide:** if the same human attends training under two
vendors, do we create two participant rows (one per vendor) or allow
`vendor_id` to be many-to-many? Two rows is simpler and matches how
training rosters actually work — same person, separate enrolment.

### Decision 5 — Account creation flow for vendor trainers

How does a super trainer onboard a new vendor trainer?

- **(a) Email + temp password** — super enters email/name/vendor; app
  generates a temp password, shows it once, super shares manually. Forces
  password change on first login. Matches the existing participant-add
  flow.
- **(b) Magic-link invite** — system emails a Supabase magic link;
  trainer sets their own password.

**Tradeoff:** (a) reuses code you already have and works without
configured email delivery. (b) is nicer UX but depends on the email setup
work in `docs/auth-email-setup.md` actually being done.

**Recommendation:** (a) now, (b) later as polish. Don't block role rollout
on email infra.

**Question to confirm:** is Supabase email delivery configured today? If
yes, (b) becomes cheap and might be preferable from the start.

### Decision 1 — Vendors: closed enum or managed table? *(already leaning)*

The doc already recommends a managed `vendors` table (see "Open decisions"
§1) since the "super adds vendor + trainers" workflow doesn't fit a
hardcoded enum — vendors would need a deploy to exist. Just confirm
that's still the call before writing the migration.

### Also worth confirming before step 1

- **Existing trainer accounts:** the plan strands every current
  `role='trainer'` user with `vendor_id = null` until super assigns them.
  They lose access in the meantime. Fine if provisioning fresh — but if
  there are active trainers running real sessions today, a transitional
  plan is needed.
- **Super trainer emails** to bake into the migration.
- **Initial vendor seed list** — names and codes.
