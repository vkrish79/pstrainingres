# Workbook prep repository — handoff doc

**Status:** implemented (prod build passes); pending localhost UI test + push to
deploy edge functions/migration. This replaces the session-level prep upload
(§2.8 in `progress.md`) with a **workbook-level prep repository**: a master
workbook owns a finite pool of prep "kits," and each session draws one kit per
participant, depleting a shared balance.

**Testable on localhost** (after applying the migration to the hosted DB via SQL
Editor — idempotent, safe to re-run on push): download template, upload to repo,
balance view, clear unconsumed, vendor-partition visibility, participant Prep
modal, and that the old session-upload button is gone. **Requires a push** (edge
functions only deploy via GitHub): withdrawal-on-enrolment, release-on-delete,
mark-used-on-close.

**Trigger:** the session-level "📎 Upload prep data" flow is being removed. Prep
now lives with the **master (template) workbook** and is consumed automatically
as participants are enrolled.

---

## 1. The model (decisions confirmed with the user)

- **Per-exercise pool, stored as rows.** Values across exercises are
  *independent* (an Exercise-1 PNR has no relationship to any other exercise's
  value) and in practice every column is filled to the same depth, so a
  template **row = one participant's allocation** ("kit"). Because values are
  independent, pairing them into a row is harmless. Balance is **one number:
  kits remaining** (with an optional per-exercise breakdown for the rare case
  a column is short).
- **Every participant needs every prep-requiring exercise** to complete the
  workbook — so a complete kit should have a value in every prep column.
  Upload validates this and warns on rows with a gap.
- **Prep-requiring exercises are implicit** — declared by which columns the
  trainer fills in the master template. No per-exercise toggle, no schema flag.
- **Authoring is open to all trainer tiers.** The blank template *structure* is
  defined by the master (super-authored) workbook, but downloading the blank
  template, filling it, and uploading prep to the repo is available to
  super_admin, super_trainer, vendor_manager, AND vendor_trainer. Because
  vendor tiers only ever see a template in **read-only mode** (C1 gating), the
  prep panel surfaces in the read-only viewer too — it's a capability separate
  from editing the workbook structure (which stays super-only).
- **The repository is partitioned per vendor.** Each kit carries a `vendor_id`.
  Prep authored for one vendor is **never** consumed by another. Within a
  vendor, prep is shared (a vendor_manager's and vendor_trainer's uploads pool
  together). Super uploads go to a **single shared super pool**
  (`vendor_id = null`), shared across all super trainers.
- **Consumption follows the session's `vendor_id`, full stop.** A vendor's
  session draws only that vendor's kits; a super-*delivered* session
  (`vendor_id = null`, the C3 self-deliver flow) draws only the super pool; a
  session a super creates **on behalf of a vendor** has that vendor's id and so
  draws **that vendor's** pool (super uploads don't seed it — the vendor must
  have its own prep, else "pending").
- **Super sees everything; vendors see their own.** The balance view shows
  super-tier all vendors' pools with a vendor filter; vendor-tier sees only
  their own vendor's pool.
- **Withdrawal happens only on enrolment.** Adding a participant to a session
  (single or CSV, via `add-session-participants`) claims the next available
  kit and writes it into that participant's `participant_prep`. The pool is
  **shared across every session that uses the workbook** — they deplete the
  same global balance.
- **Empty/short pool does NOT block enrolment.** The participant is still
  added; the UI shows a "prep pending — repository empty" warning.
- **Return-to-pool:** individual participant delete → kit returns to the pool
  (`available`). Session **close** → that session's kits stay consumed
  (`used`), never returned.
- **Old upload removed.** The session-level `UploadPrepData` modal + "Upload
  prep data" button are deleted. The per-participant `PrepEditor` (manual
  override) **stays** — editing a participant's prep does not un-consume a kit.

---

## 2. Where things live (current code)

- Per-participant prep table + RLS: `supabase/migrations/20260518000004_participant_prep.sql`.
  This stays — it remains the read surface for participants, CSV export, and the
  closed-session snapshot. The repository *feeds* it.
- Session-side prep hook: `src/hooks/useSessionPrep.js` (`saveOne` used by
  PrepEditor stays; `saveMany` was only for the old upload).
- Participant-side prep hook (read): `src/hooks/useParticipantPrep.js`.
- Old upload (to delete): `src/components/dashboard/UploadPrepData.jsx`,
  and its button + `useSessionPrep.saveMany` wiring in
  `src/pages/SessionDashboardPage.jsx`.
- Sheet parsing (reuse for upload): `src/lib/sheetParse.js` (xlsx + csv).
- Column→section matching (reuse): the `matchSection` / `IGNORED_HEADERS`
  logic currently inside `UploadPrepData.jsx` — lift into a shared lib.
- Enrolment edge function (withdrawal hook): `supabase/functions/add-session-participants/index.ts`.
- Delete / close edge functions (release / mark-used hooks):
  `supabase/functions/delete-participant/index.ts`,
  `supabase/functions/close-session/index.ts`.
- Master workbook editor (upload + balance UI mount): `src/pages/WorkbookEditorPage.jsx`
  (super-tier `canEdit` path; templates only — see `progress.md` §11.1 C1).
- Participant hero (new Prep button): `src/pages/ParticipantWorkbookPage.jsx:130-152`.
- Section cloning (proves the master→clone mapping): `create_session_with_workbook_clone`
  in `supabase/add_vendors_and_roles.sql` — copies `title` + `order_index`
  verbatim and sets the clone's `template_id` to the master id.

---

## 3. Schema (new migration, idempotent)

`supabase/migrations/20260522000000_workbook_prep_kits.sql`

```sql
create table if not exists workbook_prep_kits (
  id uuid primary key default gen_random_uuid(),
  workbook_id uuid not null references workbooks(id) on delete cascade, -- MASTER/template workbook
  vendor_id uuid references vendors(id) on delete cascade,       -- partition; NULL = shared super pool
  kit_index int not null,                       -- row order from the uploaded sheet
  payload jsonb not null default '{}'::jsonb,    -- { "<master_section_id>": "content", ... }  (NB: `values` is a reserved word)
  status text not null default 'available'
    check (status in ('available','allocated','used')),
  consumed_session_id uuid references sessions(id) on delete set null,
  consumed_participant_id uuid references profiles(id) on delete set null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (workbook_id, vendor_id, kit_index)  -- PG15+; treats the NULL super pool as one partition
);
create index if not exists wpk_pool_status_idx on workbook_prep_kits (workbook_id, vendor_id, status);

-- Robust master->clone section mapping (mirrors workbooks.template_id one level down).
alter table sections add column if not exists template_section_id uuid
  references sections(id) on delete set null;
create index if not exists sections_template_section_id_idx
  on sections (template_section_id);
```

- `payload` keyed by **master section_id** (stable identity for labels/balance).
  Withdrawal maps to a session's clone section via the new
  `sections.template_section_id` back-reference — **not** `order_index`, which
  silently corrupts data if the master is reordered after a clone exists (prep
  for Ex-B would land in Ex-C's slot). `create_session_with_workbook_clone`
  sets `template_section_id = <master section id>` on each cloned section (one
  extra value in the existing section insert).
- Availability = `status='available'`. Explicit status (not derived) is chosen
  deliberately over the "count `participant_prep` references" approach because
  the close-vs-delete distinction (used vs returned) can't be expressed by FK
  cascade alone. **(Divergence from an earlier advisor suggestion — see §8.)**
- RLS (vendor-scoped, all trainer tiers): super-tier reads/writes **any**
  partition (incl. the `null` super pool); vendor-tier reads/writes only
  `vendor_id = my_vendor_id()`. App sets `vendor_id` on insert (vendor-tier →
  `my_vendor_id()`; super → `null`); the `with check` enforces it server-side.
  Participants never touch this table. Edge functions use the service role and
  bypass RLS for withdrawal/release.

  ```sql
  create policy wpk_rw on workbook_prep_kits for all using (
    is_super_trainer_or_above()
    or (is_vendor_trainer_or_above() and vendor_id is not null and vendor_id = my_vendor_id())
  ) with check (
    is_super_trainer_or_above()
    or (is_vendor_trainer_or_above() and vendor_id is not null and vendor_id = my_vendor_id())
  );
  ```
- Realtime: add to `supabase_realtime` so the balance view updates live as
  sessions consume.

### RPCs (security definer, atomic)

- `claim_prep_kit(p_session_id, p_participant_id) returns jsonb` —
  `{ status: 'allocated'|'exhausted'|'none', prepped: int }`.
  1. Resolve master workbook `coalesce(clone.template_id, clone.id)` AND the
     session's `vendor_id` (NULL for super-delivered sessions).
  2. `select ... where workbook_id=master and vendor_id is not distinct from
     <session.vendor_id> and status='available' order by kit_index for update
     skip locked limit 1` (concurrency-safe; `is not distinct from` matches the
     NULL super pool cleanly).
  3. None found → if the pool has any rows at all return `exhausted`, else
     `none`.
  4. Set the kit `allocated` + `consumed_*`; for each `(master_section_id,
     content)` find the clone section via `template_section_id = master_section_id`
     and upsert `participant_prep(session_id, participant_id, clone_section_id,
     content)`.
- `release_prep_kit(p_session_id, p_participant_id)` — set the participant's
  `allocated` kits back to `available`, clear `consumed_*`. Called **before**
  the participant is hard-deleted.
- `mark_prep_kits_used(p_session_id)` — set the session's `allocated` kits to
  `used`, clear `consumed_participant_id`. Called during close (snapshot
  already captures the prep content, so cascade-deleting `participant_prep` is
  fine).

---

## 4. Flow & file changes

### Edge functions
- **`add-session-participants`**: after each `created` / `enrolled_existing`
  row, `admin.rpc('claim_prep_kit', { session_id, participant_id })`. Add a
  `prep` field to that result row (`allocated`/`exhausted`/`none`). UI warns if
  any row is `exhausted`.
- **`delete-participant`**: call `release_prep_kit(session_id, participant_id)`
  before deleting the auth user. (Confirm it has `session_id`; pass it if not.)
- **`close-session`**: call `mark_prep_kits_used(session_id)` as part of close.

### Hooks / libs (new)
- `src/lib/prepColumns.js` — extract `matchSection` + `IGNORED_HEADERS` from
  `UploadPrepData.jsx` (shared by the new upload).
- `src/lib/prepTemplate.js` — `buildPrepTemplateCsv(sections)` → CSV with a
  header per section title; downloaded via Blob (no new dependency; upload
  still accepts xlsx through `sheetParse`).
- `src/hooks/useWorkbookPrep.js` — for a master workbook: load kits, compute
  balance (`total / available / allocated / used` + per-exercise available),
  `appendKits(rows)` (upload **appends** — never clobbers consumed kits),
  realtime subscription filtered by `workbook_id`.

### Components / pages
- `src/components/editor/WorkbookPrepPanel.jsx` — **all-trainer-tier** panel on
  the master workbook: **Download template**, **Upload master template** (parse
  → match columns to sections → preview matched columns + row count + gap
  warnings → confirm → append into the caller's vendor partition), **Clear
  unconsumed kits** (`delete ... where workbook_id=? and vendor_id<=>? and
  status='available'`; used/allocated untouched), and the **balance visual**
  (headline "can fully prep N more participants" = available kits;
  per-exercise bars). For super-tier, a **vendor filter** switches which
  partition is shown/acted on (defaulting to the shared super pool); vendor-tier
  is locked to their own vendor.
- Mount it in `WorkbookEditorPage.jsx` for templates in **both** render paths:
  the super edit view AND the vendor-tier read-only viewer (the C1 early-return
  branch). Gate to trainer-tier, not `canEdit`.
- `src/components/participant/PrepModal.jsx` — read-only modal listing every
  section that has prep for this participant. Opened by a new **"🎯 Prep"**
  button in the participant hero (shown when the participant has any prep).
- `SessionDashboardPage.jsx` — remove the "Upload prep data" button + modal.
  Optionally add a small "prep: X drawn / pool Y left" indicator. PrepEditor
  stays.

---

## 5. Test plan (localhost first — see memory: verify on localhost)

1. Super uploads a master template (3 exercises filled, 5 rows). Balance shows
   5 kits / per-exercise 5,5,5.
2. Create a session from that workbook; add 3 participants → balance drops to
   2; each participant's workbook shows their (distinct) prep in the per-section
   callout AND the new Prep modal.
3. Add a 2nd session from the same workbook, add 3 participants → 4th is
   `exhausted` (warning shown), enrolment still succeeds, that participant has
   no prep.
4. Delete a participant (individual) → balance goes back up by 1.
5. Close a session → its kits become `used` (balance does NOT increase);
   snapshot still renders the prep.
6. CSV export still has the `prep` column; closed snapshot still has
   `section_prep`.
7. Edit a participant's prep via `PrepEditor` (manual override), then close the
   session → confirm the snapshot captures the **edited** value, not the
   original kit (snapshot reads `participant_prep`, so it should — verify).
8. **Vendor isolation:** as a vendor_trainer, open the same template (read-only
   viewer) → upload prep → it lands in *their* vendor pool only. A different
   vendor's session does NOT consume it; a super-delivered session does NOT
   consume it. A super sees both pools with the vendor filter. A super session
   created *on behalf of* vendor A consumes vendor A's pool.
9. `npm run build` (memory: dev passing ≠ prod build passing).

---

## 6. Decisions settled / open

**Settled:**
- **Master↔clone mapping** → `sections.template_section_id` (see §3), not
  `order_index`. Robust against rename/reorder/structural edits.
- **Partial (gappy) rows** → **accepted** as partial kits, not blocked: the
  upload preview flags the count of rows missing a value in a matched column,
  and the per-exercise balance bars surface the shortfall. (Trainers who know
  what they're doing aren't blocked; under "all prep required," the per-exercise
  bottleneck is the signal.)
- **Kits are immutable after upload.** No in-place edit of a kit value. Fix a
  bad pool by **Clear unconsumed kits** + re-upload; fix a single *consumed*
  participant's prep via the existing `PrepEditor` override.
- **Per-vendor partitioning** via `workbook_prep_kits.vendor_id` (not separate
  tables). Super uploads → shared `null` super pool; consumption always follows
  the session's `vendor_id`. All four trainer tiers author prep; the panel
  appears in the read-only viewer for vendor tiers.

**Open (defer-able, confirm during build):**
- **Balance view location.** Primary on the master workbook editor. A secondary
  per-session indicator on the dashboard is optional.
- **"Fill missing prep" retro action.** When a pool was empty at enrol time,
  offer a dashboard button to assign kits to unprepped participants after a
  top-up. Nice-to-have; can ship in a follow-up.

## 7. Migrations / deploy notes
- New migration under `supabase/migrations/` with a timestamped name, fully
  idempotent (memory: idempotent migrations; `create ... if not exists`,
  `do $$ ... exception` guards, `create or replace function`, `drop policy if
  exists` / `create policy`). Edge functions auto-deploy on push (memory:
  Supabase ↔ GitHub).

## 8. Note for the reviewer
Explicit `status` on `workbook_prep_kits` is chosen over deriving "consumed"
from `participant_prep.pool_row_id` references, because session-close must keep
kits consumed while individual-delete must return them — a distinction FK
cascade can't make. The trade-off: the edge functions own the lifecycle
transitions (claim/release/mark-used) rather than letting cascade do it.

---

## 9. Revision 2 (2026-05-22) — template setup screen + dedicated Prep tab

Front-of-house restructure after the first build shipped (commit `e22c1a7`).
The **engine is unchanged** — `workbook_prep_kits`, vendor partitioning,
`claim_prep_kit` / `release_prep_kit` / `mark_prep_kits_used`, withdrawal on
enrolment, and the participant Prep modal all stand. Five deltas:

### R2.1 Per-workbook prep template *structure* (new storage)
Prep-requiring exercises are no longer "all exercises" / implicit-from-fill —
the **super trainer explicitly defines them** by uploading an **empty** template
(header row only) whose columns map to exercises.

- `workbooks.prep_template jsonb` (nullable) = ordered `[{ section_id, header }]`.
  Set by the super's setup upload (parse headers → `matchSection` → store matched
  columns in order). **No kits seeded** (the upload is empty). Read by all
  trainer tiers (templates are trainer-readable) to generate the empty template
  in the Prep tab.
- New idempotent migration: `alter table workbooks add column if not exists
  prep_template jsonb`.
- Caveat: re-defining the structure after kits exist does not migrate existing
  kits (payloads stay keyed by `section_id`); document, don't auto-clear.
- Validation: the setup upload is **rejected if no header resolves to a section**
  (≥1 required) — guards against the wrong file / bad headers.
- If two headers resolve to the **same section**, dedupe **first-wins**.
- Stored column **order = the order columns appeared in the super's upload**; the
  tab regenerates the empty template in that order.

### R2.2 Editor "Prep" section → setup only (super)
`WorkbookPrepPanel` is repurposed to a **template-setup** panel:
- Renders **only in the super edit view** — REMOVE the mount from the vendor
  read-only viewer (vendor tiers now upload via the tab).
- Upload a template → its headers define & store `workbooks.prep_template`.
  Show the current structure (list of prep exercises) + allow re-upload to
  redefine.
- REMOVE from here: the all-exercises download, fill/append, balance, clear
  (all move to the tab).

### R2.3 New top-level "Prep" tab (all trainer tiers)
- TopBar entry → opens a **modal**.
- Step 1: **select a workbook** (templates the user can access).
- Step 2 (super only): **pool filter** — Super (shared) | each vendor.
- Then: **download the empty template** built from that workbook's
  `prep_template` (only the prep columns, not all exercises) → fill → upload →
  **append** to the repo in the selected partition. **Balance shown.**
- New: a `PrepUploadModal` + a TopBar entry (and route if page-backed).
- Upload mapping: match each uploaded column by exact header against
  `prep_template` (fallback `matchSection`); payload keyed by `section_id`.
- If a selected workbook has no `prep_template` yet: "No prep template set up for
  this workbook yet — ask a super trainer." Hide upload + download, but still
  show **balance read-only** (in case stale kits exist).
- **Clear unconsumed** stays available in the tab, gated like upload (super:
  super pool only; vendor-tier: own pool).

### R2.4 Upload-permission rule (super) — UI + RLS
Super may **upload only to the super pool** (`vendor_id = null`). Selecting a
vendor pool in the filter shows **balance only** (read-only). Vendor-tier
uploads to their own pool only. Enforced in both layers:
- UI: hide/disable upload when a super has a vendor pool selected.
- RLS (defense-in-depth): split the current `wpk_rw` FOR ALL policy into:
  - **SELECT** — super any partition; vendor-tier `vendor_id = my_vendor_id()`.
  - **INSERT/UPDATE/DELETE** — super only `vendor_id IS NULL`; vendor-tier
    `vendor_id = my_vendor_id()`.
  `claim_prep_kit` etc. are SECURITY DEFINER, so withdrawal into vendor pools
  still works regardless. New idempotent migration drops `wpk_rw`, adds
  `wpk_read` + `wpk_write`.
- Verified `useWorkbookPrep.appendKits` / `clearUnconsumed` are the only
  client-side writers of `workbook_prep_kits`; R2.3's UI gating stops super from
  attempting a disallowed vendor-pool write.

### R2.5 Empty-template generation
`prepTemplate.js`: replace the all-sections builder with one that takes the
stored `prep_template` columns (headers). The download on the editor setup
screen goes away entirely.

### R2.6 Existing kits from R1 testing
Leave them — production hasn't run a real cohort and they draw fine (their
`section_id` payload keys still resolve). A trainer can remove test kits via the
tab's **Clear unconsumed** per partition. No one-time wipe in the migration.

**Status of R2:** shipped (build passes; both migrations applied to hosted DB).

---

## 10. Revision 3 (2026-05-22) — prep items not tied to an exercise

Some prep columns don't map to any exercise (e.g. a role-play PNR that's needed
but has no exercise number). R2 **silently dropped** unmatched columns — losing
that prep. R3 makes prep an *item* that is **optionally** linked to an exercise.
Design goal: **additive and low-risk** — the exercise-linked path stays exactly
as-is; standalone prep gets its own small store.

### R3.1 Template setup keeps unmatched columns
- `workbooks.prep_template` = `[{ header, section_id|null }]`. At setup, **every**
  column is kept; `matchSection` resolves `section_id` where it can, else `null`
  (standalone). Setup rejects only an empty file (not "no match"). The panel
  shows which columns are exercise-linked vs standalone.
- Dedup/link rule: dedup exact headers (case-insensitive, **first-wins**). A
  section hosts **at most one** linked column (preserves `participant_prep`'s
  one-per-section) — a second column matching an already-used section is kept as
  **standalone**, so nothing is dropped.

### R3.2 Kit payload keyed by header
- `workbook_prep_kits.payload` becomes `{ "<header>": "content" }` (was keyed by
  master section_id). The header is the stable per-template item key (deduped at
  setup). Balance per-item keys by header (label = header).
- Existing R1/R2 **test** kits use section-id-keyed payloads; the R3 migration
  **truncates `workbook_prep_kits`** (no production cohorts) so no uuid-keyed
  orphans survive into the header-keyed model.

### R3.3 Standalone store (linked path unchanged)
- New table `participant_prep_standalone (id, session_id, participant_id, label,
  content, created_at, updated_at)`, unique `(session_id, participant_id,
  label)`. RLS mirrors `participant_prep` (participant reads own; trainer-in-
  session full CRUD). Added to realtime.
- `claim_prep_kit` rewrite: payload keyed by header; read `master.prep_template`;
  for each `header → content`: if the column has a `section_id` → map master→clone
  via `template_section_id` and upsert **`participant_prep`** (UNCHANGED,
  section-keyed); else upsert **`participant_prep_standalone`**. If a payload
  header isn't found in `prep_template` (renamed/removed later) → treat as
  **standalone with `label = header`** — never drop (the header is human-readable,
  so it reads sensibly in the General group; uuid-keyed orphans are gone via the
  truncate in R3.2).
- **Linked prep is 100% unchanged downstream** (callout, modal section list,
  PrepEditor, `useSessionPrep`, CSV, snapshot, dashboard). R3 only ADDS standalone.

### R3.4 Participant display (final)
- `useParticipantPrep` also loads standalone (+ realtime); returns
  `{ prep (by section, unchanged), standalone: [{ label, content }] }`.
- All prep is shown in a **right slide-in `PrepDrawer`** (not a modal): exercise-
  linked prep grouped by exercise + a "General / pre-work" group for standalone.
  The drawer **pushes the canvas** (body `margin-right`, no overlay/backdrop),
  is ~300px (prep values are short), and closes on × / Esc; bottom sheet under
  900px. The earlier top "Pre-work" callout was **removed** per request — the
  exercise-linked per-section callout is unchanged.

### R3.5 No silent data loss on export / close
- `buildAnswersCsv`: append standalone prep rows per participant.
- `close-session` snapshot: add `standalone_prep` per participant;
  `ClosedSessionView` renders it.

### R3.6 Deferred (participant experience is the priority now)
- Trainer **manual editing** of standalone prep (`PrepEditor` stays section-only).
- Live trainer-**dashboard** per-participant standalone display.
  (Standalone prep is set via the pool upload and shown to participants; trainer-
  side editing/inline display can follow.)

**Status of R3:** shipped (build passes). Needs migration #3 applied to the
hosted DB + a push to redeploy the `close-session` edge function (the
`claim_prep_kit` rewrite ships inside migration #3, so withdrawal updates on SQL
apply; only the closed-snapshot capture needs the push).

**Known gap (deferred, R3.6):** trainers can't manually edit a participant's
standalone prep yet — `PrepEditor` is section-only. A typo in a standalone PNR
can't be fixed except by redoing the pool. Worth telling the user.

---

## 11. Backlog — editing / replacing already-distributed prep (requested)

**Requirement (user, 2026-05-22):** prep that has already been distributed
sometimes needs fixing (a wrong/expired PNR or ticket number). Provide an option
to **replace the prep for a particular exercise**, at **two levels**:

### 11.1 Master level — replace one exercise's prep in the pool
Re-supply the values for a single prep column (exercise/header) in a workbook's
pool without redoing the whole template + upload. Today the only tools are
"upload (append)" and "clear unconsumed" — there's no per-column edit.

**Open design questions:**
- Scope of effect: does replacing a master column update only **available** kits
  (future withdrawals), or also **propagate to already-distributed** copies
  (`participant_prep` / `participant_prep_standalone` rows already written to
  participants)? The request says "already distributed," which implies
  propagation — but that overwrites per-participant values a trainer may have
  hand-edited. Decide precedence (pool replace vs manual override).
- Granularity: replace the whole column's value list, or edit individual kit
  cells? (Kits are currently immutable — see §6.)
- Partition: master = the super pool; vendor pools are edited by their own
  trainers (mirror the upload RLS in R2.4).

### 11.2 Session level — replace one exercise's prep within a session
Fix an exercise's prep for the participants of a specific session (the
"already distributed" case).

**What exists:** `PrepEditor` already edits **exercise-linked** prep
**per-participant, per-section** for a session (`useSessionPrep.saveOne` →
`participant_prep`). So single-participant linked edits are partly covered today.

**Gaps to close:**
- **Standalone** prep editing (R3.6) — `PrepEditor` is section-only; no path to
  edit a participant's standalone item.
- **Bulk/whole-session replace** — set/replace an exercise's prep for *every*
  participant in the session at once, not one at a time.

**Open questions:** per-participant vs whole-session default; whether a
session-level replace should pull fresh values from the (corrected) master pool
or take a typed value; how this interacts with the closed-session snapshot
(closed sessions are immutable archives — edits apply to live sessions only). Migration #1 (`20260522000000`) is
already applied/deployed; R2 lands a new migration for `prep_template` + the RLS
split, plus the UI rework.
