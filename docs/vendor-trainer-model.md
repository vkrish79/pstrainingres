# Vendor + trainer role model — planning doc

**Status:** Phase A in progress (2026-05-13). Migration applied to Supabase
and deployed to prod. Vendors admin page built locally, awaiting localhost
smoke test before commit. Next session resumes here.

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

### 🟡 Built locally, NOT YET committed or pushed

The Vendors admin page (Phase A). Files in the working tree:

- `src/hooks/useVendors.js` — fetch + create + rename + delete, includes
  per-vendor trainer and session counts
- `src/pages/VendorsAdminPage.jsx` — list table + inline add form +
  inline rename + delete (blocked when vendor has trainers or sessions)
- `src/components/ProtectedRoute.jsx` — extended to accept `role="super"`
- `src/components/TopBar.jsx` — "Vendors" nav link visible only to
  super-tier users
- `src/App.jsx` — new route `/trainer/vendors` gated to super-tier

Vite dev server is running at `http://localhost:5174/` with HMR clean.
**To resume:** open it in the browser as `vbalasubramanian@etihad.ae`
and run the smoke test below, then commit + push.

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

### 🔲 Pending — Phase B (next up after Phase A is in prod)

**Goal:** super trainers can add vendor managers and vendor trainers.

- New edge function `supabase/functions/create-staff/index.ts` (mirrors
  `create-participant` but: accepts `role` in `{vendor_manager, vendor_trainer}`,
  requires `vendor_id`, gated to super-tier callers only). Service-role
  insert of auth user + profile row.
- New page `src/pages/StaffAdminPage.jsx` at `/trainer/staff`:
  - List vendor_managers and vendor_trainers; filter by vendor; show
    name, email, vendor, role, must_change_password status, created date.
  - "+ Add staff member" form: Vendor (dropdown), Role (radio:
    Vendor manager / Vendor trainer), Email, Full name, Temp password.
  - Edit: reassign vendor (vendor dropdown). Delete: remove **both** the
    `profiles` row and the `auth.users` row (via service-role
    `auth.admin.deleteUser()` in the edge function), so the email is
    freed up and can be re-invited fresh. Decided 2026-05-13.
- Nav: new "Staff" link in TopBar, super-tier only. Slots between
  "Vendors" and "People".
- ProtectedRoute already supports `role="super"`, so no changes there.

### 🔲 Pending — Phase C (after Phase B)

Wire the existing pages to actually use the new tiers:

- **TrainerHomePage** — branch by tier. Super tier sees vendor cards;
  vendor managers see their vendor's sessions list; vendor trainers see
  only their own sessions. Today everyone sees the same thing.
- **NewSessionPage** — for vendor trainers, `vendor_id` is auto-set from
  their profile (no picker). For vendor managers, picker shows only
  vendor_trainers from their vendor (since managers can't deliver
  themselves). For super tier, picker shows everyone.
- **PeoplePage** — for vendor-tier callers, scope the participant list
  to their vendor only. Add a vendor picker for super-tier.
- **WorkbookEditorPage** — gate template structural edits on
  `is_super_trainer_or_above()` (today every trainer-tier user can edit
  templates; that's wrong per the new model).

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
