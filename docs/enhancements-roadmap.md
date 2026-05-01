# Enhancement roadmap

**Status:** captured but not yet started. Picked from a wider brainstorm as the
top 5 by *value × UX impact*. Ordered roughly by how much they change the
trainer + participant experience, not by implementation cost.

When picking up any of these for real work, write a focused handoff doc in the
style of `docs/docx-importer-next.md` (scope, where things live, decisions to
confirm, test plan).

---

## 1. Live focus / spotlight + co-presence

**Pitch.** The biggest live-teaching gap today. Trainer "spotlights" the
current exercise → all participants get a soft banner ("Trainer is on
Exercise 12") with an optional **Jump to** button. Inversely, the **By
exercise** sidebar in the trainer dashboard shows live presence dots: where
each participant currently is. Keeps a cohort marching together instead of
scattering across 38 exercises.

**Why it's worth it.** Closes the awareness gap that today forces trainers
to verbally herd the room. Makes the platform feel like a live teaching
tool, not just a fillable form.

**Where it'd live.**
- Realtime: Supabase realtime is already wired for `blocks`, `answers`,
  `answer_notes`. Add channels for `session_focus` (one row per session,
  trainer writes) and `participant_cursor` (one row per participant, they
  write on section change).
- Schema: small. `session_focus (session_id, section_id, set_at, set_by)`
  and `participant_cursor (session_id, participant_id, section_id,
  updated_at)`.
- UI: a "Spotlight this exercise" button on each card in the trainer's
  **By exercise** sidebar. Participant view gets a top banner + optional
  auto-scroll. Sidebar shows tiny dots per participant.

**Open questions.**
- Soft nudge (banner + Jump button) vs. hard snap (force-scroll the
  participant view). Probably soft by default with a "lock to spotlight"
  toggle for stricter cohorts.
- Presence opt-in. Participants might dislike being tracked block-by-block.
  Section-level seems like a fair line.

---

## 2. Reveal answers / debrief mode (model answer key)

**Pitch.** Toggle in **By exercise**: *"Show my answers as model"*. Each
participant tile then renders their answer next to the trainer's practice
answer for the same block, with a green tick when they match (for choice
/ check_group). Reuses the trainer-practice feature already built.

**Why it's worth it.** Closes the learning loop. Right now we capture
answers but offer no built-in way to debrief them; trainers either talk
through answers verbally or paste them into chat. This makes the model
answer the source of truth and turns each participant tile into an
auto-graded mini-report.

**Where it'd live.**
- `src/components/dashboard/ExerciseResponses.jsx` — add a `?` toggle in
  the toolbar.
- `useTrainerPractice` already supplies the trainer's answers. Pass them
  down to the participant tile renderer.
- Comparison logic: exact match for `choice`, set-equality for
  `check_group`, exact for table input cells; skip free-text fields (no
  meaningful auto-grade).

**Bonus.** When this ships, the **Session summary PDF** (#5) can include
the model answer key as an appendix and percent-correct per question
across the cohort.

**Open questions.**
- Where the trainer's practice answers actually persist long-term
  (currently localStorage). For the dashboard tile to show them across
  devices, we'd need to promote storage to a `trainer_practice_answers`
  table — which the practice feature was designed to allow.

---

## 3. Mobile-responsive participant fill

**Pitch.** Make the participant fill view first-class on phone and tablet.
Bigger tap targets for radio / checkbox, tables that scroll horizontally
instead of squeezing, the section sidebar collapses cleanly to a sticky
select on small screens (already partially the case).

**Why it's worth it.** Adoption gate. If a trainer can't promise laptops
for every classroom, mobile-quality determines whether the tool is
considered usable. Today the layout works at 800px+ but degrades below
that.

**Where it'd live.**
- `src/styles/workbook.css` — the bulk of the work. Add a 600px / 480px
  breakpoint pass.
- `src/components/blocks/TableBlock.jsx` — wrap in a horizontal scroll
  container on narrow viewports.
- `src/components/blocks/FieldBlock.jsx` — increase touch-target padding
  on radio / checkbox.
- Ideally a real mobile session walkthrough on a real device, not just
  Chrome devtools resize.

**Open questions.**
- Whether to ship a "mobile mode" toggle (forces single-column,
  one-block-per-screen flow) for very small screens, or just rely on
  responsive breakpoints. I'd start with breakpoints.

---

## 4. Quick-jump / Cmd+K palette

**Pitch.** Keyboard-friendly fuzzy-search palette: `⌘K` (Mac) / `Ctrl+K`
opens a search overlay. Type "ex 27" → jumps to Exercise 27 in whichever
view the user is in (editor: scrolls + sets active section; participant
fill: switches the section selector; dashboard: switches the **By
exercise** sidebar selection).

**Why it's worth it.** With 38 exercises, manual scrolling adds up. Saves
5–10 seconds per use, dozens of times per session. Cheap to build,
immediately loved by power users.

**Where it'd live.**
- New `src/components/CommandPalette.jsx` — a portal-rendered overlay
  with fuzzy-match search.
- A small registry hook (e.g. `useCommandRegistry`) so each page
  contributes its searchable items (sections, blocks, common actions
  like "Export CSV", "Reset practice").
- `App.jsx` — global keydown listener for `⌘K` / `Ctrl+K`.

**Open questions.**
- Scope of the registry — start with "jump to section" only, or include
  actions ("Export CSV", "Add participant", "Edit workbook")? I'd start
  with sections + the 4–5 most-used actions on the current page.

---

## 5. Session summary PDF

**Pitch.** One-click branded report at the end of a session. Includes:
cohort completion %, per-exercise breakdown, flagged answers list, and
(optionally) one page per participant. Pairs naturally with #2 (model
answer key as appendix).

**Why it's worth it.** Closes the post-session loop. Trainers want
something to send to L&D / managers. CSV export covers raw data but
isn't readable; a PDF is the deliverable.

**Where it'd live.**
- New library: a client-side PDF generator (`pdfmake` or `@react-pdf/renderer`).
  React-PDF lets us reuse the existing `Block` component pretty closely.
- `src/lib/sessionPdf.js` — equivalent to `sessionExport.js` but for PDF.
- Hero button in `SessionDashboardPage.jsx`: `↓ Export PDF` next to
  `↓ Export CSV`.

**Open questions.**
- Branding: where do EY logo / colors come from? Likely a dedicated
  `/public/branding/` folder with a single config the PDF generator reads.
- Per-participant pages can balloon a 30-person session to 60+ pages. Make
  it optional via a checkbox in an export modal.

---

## Considered but cut

These came up in the brainstorm but didn't make the top 5. Captured in case
priorities shift.

- **Bulk participant import** (CSV / paste). Useful but operational —
  not UX-defining. Easy if needed.
- **Phased exercise release** (lock exercises until the trainer unlocks).
  Interesting; could feel paternalistic. Revisit only if cohorts complain
  about racing ahead.
- **Question-level analytics across sessions** (e.g. "this MCQ is wrong
  60% of the time"). High value for workbook iteration but only matters
  once you have several sessions of data — wait until then.
- **Header-row `colspan`/`rowspan` preservation** (the open follow-up in
  `docs/docx-importer-next.md` §8). Finishes the importer story but small
  surface.
- **Workbook versioning / edit history.** Nice but uncertain value at
  current scale; probably not worth the schema and UI cost yet.
- **Email digests to trainers** ("your cohort hit 50% complete"). Cute
  but better delivered as in-app notifications later.
