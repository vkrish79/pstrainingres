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

**Known limitation:**

- **Colspan / rowspan are not preserved.** Tables with merged cells (e.g. ARDW
  itinerary tables) come in as ragged rows. The table editor handles ragged
  rows; rendering is acceptable but not visually faithful. Deferred until
  needed.

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

## 3. Session metadata

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

## 4. Participant experience

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

## 5. Auth — password reset

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

## 6. Migrations summary

Run idempotently in Supabase Studio → SQL Editor (in this order):

1. `supabase/add_email_to_profiles.sql` (existed before this iteration)
2. `supabase/add_answer_notes.sql` (new — trainer annotations)
3. `supabase/add_session_city_code.sql` (new — city code column on sessions)

---

## 7. Files added in this iteration

```
docs/auth-email-setup.md
docs/progress.md                                     ← this file
src/components/dashboard/ExerciseResponses.jsx
src/components/dashboard/NoteRow.jsx
src/hooks/useSessionNotes.js
src/lib/docxImport.js
src/lib/sessionExport.js
src/pages/ForgotPasswordPage.jsx
src/pages/ImportWorkbookPage.jsx
src/pages/NewWorkbookPage.jsx
src/pages/ResetPasswordPage.jsx
supabase/add_answer_notes.sql
supabase/add_session_city_code.sql
```

Existing files materially modified: `App.jsx`, `AuthContext.jsx`,
`useSessionDashboard.js`, `useTrainerSessions.js`, `useWorkbook.js`,
`useWorkbookEditor.js`, `blockHelpers.js`, `LoginPage.jsx`,
`NewSessionPage.jsx`, `ParticipantWorkbookPage.jsx`,
`SessionDashboardPage.jsx`, `TrainerHomePage.jsx`, `WorkbookEditorPage.jsx`,
`BlockForm.jsx`, `BlockListItem.jsx`, plus styles in
`dashboard.css`, `editor.css`, `index.css`.

---

## 8. Backlog (in roughly recommended order)

1. **Edit existing sessions** — change name/dates/city after creation.
2. **Date-based access enforcement** — read-only after `ends_at`, hidden
   before `starts_at`, etc.
3. **Multi-session handling** — session picker on participant landing if
   enrolled in more than one session.
4. **Pick an email delivery option** — see `docs/auth-email-setup.md`.
5. **Session summary PDF** — printable per-session report (cohort
   completion %, per-participant breakdown, flagged answers).
6. **Archive old sessions** — derive from `ends_at < today`; hide from the
   home page until "show archived" toggled.
7. **Docx import: preserve `colspan` / `rowspan`** — fix ragged imported
   tables.
8. **Bundle code-splitting** — main bundle is ~520 kB; lazy-load the editor
   and dashboard routes.
