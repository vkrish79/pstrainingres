# pstrainingres — progress log

A reference for what's been built on top of the v1 commit (`0992ec8`), grouped
by area. Each section lists capability, where it lives in the code, gotchas,
and any deferred work.

## Session log

### 2026-05-18

A large day. Phase C of the role-tier rollout finished, plus three
operationally significant feature additions (session close, prep data,
notes drawer) and one DOCX importer fix.

| Commit | Summary |
|---|---|
| `54a7e13` | **C1** — WorkbookEditor + TrainerHome tier gating (§11.1) |
| `805ab05` | People page removed (was C2); per-session is the only enrolment path now (§8.6) |
| `4e6513a` | `delete-participant` edge function; Remove → Delete on session dashboard (§8.5a) |
| `7ae9784` | **C3** — NewSessionPage tier-aware pickers + participant notes feature + print PDF (§5.6, §5.7, §11.1) |
| `d19724b` | Notes drawer UI replacing inline textarea; markdown lite + keyboard `N` + word count (§5.6) |
| `55b9881` | **C4** — TrainerHomePage tier branching + VendorSessionsPage drill-in (§11.1) |
| `43c2c06` | **Close session** — snapshot + hard delete + closed view (§2.7) |
| `31f333c` | Closed sessions archive page + TopBar entry (§2.7) |
| `0701f15` | **Prep data** — Excel/CSV upload, per-participant inline callout (§2.8) + DOCX inline-choice row split (§1.1) |
| `242e6c6` | DOCX: bare option-word fallback for dropped Word checkboxes |
| `1ca6cde` | Fix Vercel build: `read-excel-file` subpath import |

Manual Supabase step from earlier in the day (still applies if not done):
delete the legacy `create-participant` edge function from the Supabase
dashboard — the GitHub integration only stops *redeploying*, not
*undeploying*.



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
- **Inline-choice row inside a data table** (a single row whose first cell
  is the question and remaining cells each contain one checkbox + short
  label, e.g. `☐YES` / `☐NO`) → the table is **split** around that row:
  rows above become one table block, the choice row becomes a `field`
  (`input_type=choice`) with options drawn from the checkbox-cell labels,
  rows below become another table block. Preserves visual order without
  requiring a choice-cell type on the table data model.
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

### 2.8 Per-participant prep data (trainer upload)

**Goal:** trainers often have scenario-specific prep per participant (a
PNR, ticket number, sample passenger) prepared in Excel before the
session. Upload the spreadsheet and each row's prep populates that
participant's workbook at the right exercise.

**Schema** (migration `20260518000004_participant_prep.sql`, idempotent):

```
participant_prep (
  id, session_id, participant_id, section_id, content,
  created_at, updated_at,
  unique (session_id, participant_id, section_id)
)
```

RLS: participant reads own; trainer-tier (super OR vendor_manager of
vendor OR session trainer) has full CRUD. Added to `supabase_realtime`
so uploaded prep appears live in any open participant tab.

**Mapping (D-prep-1):** rows in the spreadsheet are auto-distributed to
participants sorted alphabetically by `full_name`. The Excel doesn't
need a participant-identifier column. Trainers can edit per-participant
prep afterwards via the per-row "Prep…" action — order-based mapping
gets you 90% there, manual fixes cover the rest.

**Header → exercise matching (D-prep-2):**
- Exact case-insensitive match on section title (e.g. "Exercise 1").
- Else extract the leading integer and match the section whose title
  contains the same number (e.g. "1", "Ex 1", "Exercise 1" all map to
  the section titled "Exercise 1").
- Common non-data headers ignored (`name`, `participant`, `username`,
  `email`, `id`, `#`, `no.`, `row`, `index`).
- Unmatched headers shown in the upload preview's "Unmatched" list.

**File parser:**
- `src/lib/sheetParse.js` — accepts `.xlsx` (lazy-loaded
  [read-excel-file], ~50 kB chunk) and `.csv` (small inline
  RFC-4180-ish parser; handles quoted cells with commas / newlines).

**Upload flow:**
- Button **📎 Upload prep data** in the session dashboard hero.
- `src/components/dashboard/UploadPrepData.jsx` modal — file picker
  → preview (matched columns, unmatched, row→participant mapping,
  warnings for extra rows or missing participants) → Confirm. Batch
  upsert via `useSessionPrep.saveMany`.

**Per-participant edit:**
- "Prep…" action on every participant row →
  `src/components/dashboard/PrepEditor.jsx` modal: one textarea per
  section; save-on-blur via `useSessionPrep.saveOne`. Empty content =
  delete that row.

**Visibility:**
- Participant workbook (`ParticipantWorkbookPage`) shows a purple
  callout **"Pre-work from your trainer"** at the top of each section
  with prep. Driven by `useParticipantPrep` (realtime).
- Trainer dashboard shows the same callout (labelled **"Prep"**) at the
  top of each section in the Participants tab answers-pane and inside
  each `ExerciseResponses` tile body.
- CSV export (`buildAnswersCsv`) gains a `prep` column on every answer
  row; orphan prep (section has prep but no answers) gets its own row.
- Closed-session snapshot includes `section_prep` per participant; the
  `ClosedSessionView` renders the prep callout the same way as live
  views.

### 2.7 Close session (snapshot + participant purge)

**Goal:** when a cohort finishes, the trainer freezes the session, the
data becomes a permanent JSON record, and the participant accounts are
hard-deleted so the auth table doesn't accumulate single-use accounts.

**Schema** (migration `20260518000003_close_session.sql`, idempotent):
- `sessions.closed_at timestamptz`
- `sessions.closed_by uuid references profiles on delete set null`
- `sessions.closed_summary jsonb`
- partial index `sessions_closed_at_idx` on `closed_at` where not null
- `get_session_by_join_code` RPC dropped + recreated to expose `closed_at`
  (anon-callable, used by `/join/:code`)

**Edge function** `supabase/functions/close-session/`:
- Auth: super-tier OR vendor_manager of the session's vendor OR
  the session's trainer (mirrors `add-session-participants`).
- Loads workbook structure + participants + answers + section notes +
  trainer notes/flags via service role.
- Builds a snapshot JSON (`schema_version: 1`):
  `{ closed_at, closed_by, session, workbook, participants, trainer_notes }`.
  Each participant entry captures `id, full_name, username` (parsed from
  the synthesized email so the human-readable handle survives) plus
  `answers` and `section_notes`.
- Persists snapshot to `sessions.closed_summary`, sets `closed_at` and
  `closed_by`.
- HARD DELETES every participant via `auth.admin.deleteUser`. The
  schema's existing FK cascade chain (auth.users → profiles →
  session_participants → answers → participant_notes → answer_notes)
  takes care of the rest. Per-row delete errors are logged in the
  response but don't fail the close — the snapshot is already saved.

**Trigger UI:** "✕ Close session" button in the session dashboard hero.
Confirmation reads "Close session? Participants and their accounts will
be permanently deleted; a JSON summary is saved." No un-close.

**Closed view** `src/components/dashboard/ClosedSessionView.jsx`:
- Mounted automatically by `SessionDashboardPage` when `closed_at` is set
  (skips the live dashboard entirely; there's nothing live left).
- Hero: session metadata + Closed pill + "Closed YYYY-MM-DD by X".
- Stat strip: participant count + avg completion % + flagged count.
- Toolbar: search by name/username + filter (All / Has flags / Has
  section notes) + expand/collapse all.
- Body: participant-first cards. Click to expand → renders that
  participant's answers section-by-section, plus their section notes,
  plus any trainer notes/flags inline under the relevant block.
- Two export buttons: **Download JSON** (machine archive, the raw
  snapshot) and **Print / Download PDF** (human archive, browser print
  dialog; print CSS expands all cards).

**Home page filters closed sessions out** of every live grid (own /
vendor / drill-in). `useTrainerSessions` gained an `includeClosed`
param defaulting to `'live'` — every existing live view inherits the
filter for free.

**Archive page** `src/pages/ClosedSessionsPage.jsx` at
`/trainer/archive`, reachable via a new **Closed sessions** entry in
the TopBar (trainer-tier). RLS scopes the list automatically:
vendor_trainer sees own; vendor_manager sees their vendor; super sees
all. The archive uses a **table layout** (denser than cards for 50+
rows), with:

- Search by session name / vendor / trainer
- Year filter (auto-populated from `closed_at`)
- Vendor filter (super-tier only)
- Sortable columns (Session, Dates, Closed)
- Year separator rows when not filtered to one year
- Click a row → opens the session URL, which mounts `ClosedSessionView`
  via the `closed_at` check in `SessionDashboardPage`

The Closed pill / faded card styling on `SessionCard` is retained as
defensive defaults but shouldn't appear in normal live views anymore.

**Participant impact:** `JoinSessionLoginPage` checks `session.closed_at`
and renders "This session has ended" with the close date instead of the
login form. Even if a stale browser tab tries to submit, the auth account
is already deleted so login would fail.

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
  sessions. Not a real concern under the plain-username identity policy
  (each session's synthesized email is a distinct auth account — one
  account is enrolled in exactly one session by design).

### 5.6 Per-section notes (participant-authored)

**Schema:** `participant_notes` table (migration
`supabase/migrations/20260518000002_participant_notes.sql`):

```
id, session_id, participant_id, section_id, note, created_at, updated_at,
unique (session_id, participant_id, section_id)
```

**RLS:** participant can read/write their own notes only. Trainers who can
see the session (super, vendor_manager of `sessions.vendor_id`, or
`sessions.trainer_id`) get read-only access. Mirrors the `answers_read`
pattern. Added to `supabase_realtime` so trainers see edits live.

**Hook:** `src/hooks/useParticipantNotes.js` — loads notes for the
current participant + session, exposes `saveNote(sectionId, text)` with
600 ms debounce + optimistic local update.

**UI (participant) — slide-in notes drawer:**

- A **📝 Notes** button in the hero opens a right-side drawer
  (`src/components/participant/NotesDrawer.jsx`, styles in
  `src/styles/drawer.css`). Drawer lists all sections with their
  current note; the section in view is auto-expanded and focused.
  Mobile: slides up from the bottom.
- Keyboard: **N** toggles the drawer (unless typing in an input);
  **Esc** closes it.
- Save indicator inline with each note: "Saving…" → "Saved 14:23".
- Word count badge on the section heading and on the sidebar
  (💬 N words) — gives an at-a-glance overview of what's been jotted.
- Rotating placeholder hints (e.g. *"Why did this exercise matter?"*,
  *"What's the rule of thumb here?"*) chosen deterministically per
  section so a participant who doesn't know what to write gets a nudge.
- The button shows total word count when > 0 (e.g. `📝 Notes (124)`).
- Markdown lite supported in printed output: `**bold**`, `_italic_`,
  `- bullet`. Helper: `src/lib/markdownLite.js`. The drawer is plain
  text on screen — formatting renders in the PDF.

**UI (trainer):** read-only render at the top of each section in the
Participants tab answers-pane and inside each `ExerciseResponses` tile
body. Driven by `useSessionParticipantNotes(sessionId)` (realtime).

**CSV export:** `buildAnswersCsv` gained a `participant_note` column.
Notes attach to every answer row in their section; orphan notes
(participant left a note but didn't answer anything in that section)
get their own synthetic row so nothing is silently dropped.

### 5.7 Print / Download PDF

`Print / Download PDF` button in the participant hero calls
`window.print()`. `src/styles/print.css` hides app chrome
(TopBar, sidebar, save indicator, the print button itself), expands
the layout to full width, and emits a print-only header with workbook
title + session name + city + date range.

Participant notes are rendered as plain text in print (the on-screen
`<textarea>` doesn't print its value reliably across browsers, so a
twin `.participant-note-print` div is shown only when printing).

Trainer notes/flags are deliberately excluded from the participant's
download.

To save as PDF: open the print dialog, pick "Save as PDF" as the
destination. No new dependencies.

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
fixed this page by page. **Phase C complete on 2026-05-18:** C1, C3,
C4 shipped (see §11.1 below for the per-step detail); C2 was dropped
because the People page was removed entirely (see §8.6).

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
8. `20260518000002_participant_notes.sql` — `participant_notes` table
   for per-section notes written by participants. RLS: self-only writes,
   trainers in the session get read access. Added to `supabase_realtime`.
   Idempotent.
9. `20260518000003_close_session.sql` — `sessions.closed_at`, `closed_by`,
   `closed_summary jsonb`; updated `get_session_by_join_code` RPC to
   expose `closed_at` so `/join/:code` can show "session has ended".
   Idempotent.
10. `20260518000004_participant_prep.sql` — `participant_prep` table
    for trainer-uploaded prep data (one entry per participant per
    section). RLS: participant reads own, trainer-tier full CRUD.
    Added to `supabase_realtime`. Idempotent.

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

#### C3 — NewSessionPage tier-aware pickers *(shipped 2026-05-18)*

`NewSessionPage.jsx` now branches on `profile.role`:

- **vendor_trainer**: no extra pickers. Submits with `p_trainer_id =
  null`; the RPC defaults it to the caller.
- **vendor_manager**: a Trainer dropdown listing themselves + their
  team's vendor_trainers (RLS already scopes `useStaff` for them).
- **super_admin / super_trainer**: a "I'll deliver this session
  myself" checkbox defaulting **on**. When on, no pickers — session is
  assigned to the super (vendor_id resolves to whatever they have,
  usually null). When off, Vendor + Trainer dropdowns appear, both
  required. Trainer dropdown is disabled until Vendor is picked and
  then filters to that vendor's staff.

Form validation: trainer required for vendor_manager and for super
when not self-delivering; vendor required only when super is in
assign mode. RPC re-validates on the server side
(`vendor_trainer` can't pick anyone but themselves, etc.).

#### C4 — TrainerHomePage tier branching *(shipped 2026-05-18)*

`TrainerHomePage` now picks one of three sub-layouts based on
`profile.role`. Hero actions stay (super-only New workbook / Import,
all-tiers New session) from C1.

- **vendor_trainer** *(unchanged)*: own sessions (`scope='own'`) +
  read-only template library.
- **vendor_manager**: all sessions in their vendor (`scope='all'` —
  RLS naturally scopes to `vendor_id = my_vendor_id()`). Each card
  shows `Trainer: <name>` so the manager can see who runs what at a
  glance. Stat strip shows vendor-wide counts.
- **super_admin / super_trainer**: vendor-first overview. A "My
  sessions" strip (own self-delivered sessions from C3) on top — hidden
  when empty. Below: grid of **vendor cards** showing
  `<sessions> · <trainers>`. Click a card → new page
  `/trainer/vendors/:vendorId/sessions` (`VendorSessionsPage`) listing
  every session in that vendor with trainer names. Full template
  library with author buttons.

New / refactored:
- `useTrainerSessions(userId, scope='own', vendorId)` — gained scope
  param; selects `trainer:profiles!sessions_trainer_id_fkey` so cards
  can show the trainer name.
- `src/components/dashboard/SessionCard.jsx` — extracted; accepts a
  `showTrainer` prop.
- `src/pages/VendorSessionsPage.jsx` + route
  `/trainer/vendors/:vendorId/sessions` (super-only via
  `ProtectedRoute role="super"`).

#### Remaining Phase C work

- **C2 — dropped.** Plan was to vendor-scope the People page roster.
  Instead the page was removed entirely on 2026-05-18 (see §8.6) since
  participant management is per-session-only and a generic cross-vendor
  roster has no role-appropriate reader.
- *(Phase C complete — C1, C3, C4 shipped; C2 dropped.)*

Per-step approach: build → smoke test on localhost → commit → push.
Avoids landing a multi-page diff and discovering one broke downstream.

### 11.2 Operational backlog

1. **Edit existing sessions** — change name/dates/city/trainer after
   creation. Today only the create flow exists.
2. **Date-based access enforcement** — read-only after `ends_at`,
   hidden before `starts_at`.
3. ~~Multi-session handling~~ — N/A under the plain-username identity
   policy (each session = a distinct auth account; `useWorkbook`'s
   `.limit(1)` is correct).
4. ~~Archive old sessions~~ — done as part of session close (§2.7) +
   the dedicated archive page (§2.7).
5. **Pick an email delivery option** for staff/super password reset
   flows — see `docs/auth-email-setup.md`. (Participants use temp
   passwords and `/join/:code`, so this is now staff-only.)
6. **Docx import: preserve header-row `colspan` / `rowspan`** — body
   merging is done; headers still flatten. See
   `docs/docx-importer-next.md` §8.
7. **Bundle code-splitting** — main bundle is ~600 kB after the prep
   feature; lazy-load the editor / dashboard / archive routes.
8. **Strip the real-email path from `add-session-participants`** — the
   D9 escape hatch is no longer policy. See `vendor-trainer-model.md`
   for context. Currently dormant code, low priority.

### 11.3 Forward-looking UX

Live focus / spotlight, model-answer debrief, mobile-responsive fill,
⌘K palette, session PDF — scoped in `docs/enhancements-roadmap.md`.
