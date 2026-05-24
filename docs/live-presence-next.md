# Live presence — "which exercise is each participant on" (handoff doc)

**Status:** implemented (prod build passes). Pending: migration applied to the
hosted DB + the two-browser runtime test (§5). Implements the *co-presence*
half of roadmap item #1 (`docs/enhancements-roadmap.md`). A trainer running a
session can glance at the **Participants** table and see, live, which exercise
each participant is **currently looking at** — plus a "● N online" cohort read.

**Requirement (user, 2026-05-24):** "an option for the trainer to do a quick
check on participant's activity … which page of the workbook each participant
is on, done from within a session." Confirmed semantics: **where they're
looking right now** (true viewport), not where they last typed.

---

## 1. Decisions (confirmed with the user)

- **Semantics = live viewport, not progress.** Chosen over the cheaper
  "section of last-edited answer" option. We track where the participant is
  actually looking, in real time.
- **UI surface = a column in the existing Participants table**, not a new tab.
  The table (`Name | Progress | Last activity`) is already the trainer's
  monitoring surface; a "quick check" is a glance, not a context switch. New
  column **On now** sits between Progress and Last activity. A "● N online"
  count sits in the participants header.
- **Trainer-only visibility (peer privacy).** A participant must NOT be able to
  see classmates' positions. This drove the transport choice (below): a shared
  Supabase Presence channel is all-or-nothing for membership — any participant
  who knows the session id could subscribe and read everyone — so it can't
  enforce trainer-only. An **RLS-protected `participant_cursor` table** can:
  the trainer reads every cursor in their session; a participant reads/writes
  only their own row.
- **Transport = `participant_cursor` table + `postgres_changes`** (the
  codebase's existing realtime pattern), NOT Supabase Presence. Trade-off vs.
  presence: no auto-expiry on disconnect, so online/offline is derived from a
  **heartbeat** + a `last_seen` staleness window.
- **Three dot states:** ● live (online + moved/answered within IDLE_MS), ◐ idle
  (online, parked longer), ○ offline (no heartbeat within OFFLINE_MS → fall
  back to "last Ex N" from their most-recent answer, so the cell is never
  blank).
- **Windows:** heartbeat 20s; IDLE_MS 45s; OFFLINE_MS 45s. One constant each.
- **Tracking is silent** (no participant-facing "your trainer can see your
  page" badge), per the roadmap's "section-level seems a fair line." Peers are
  now locked out by RLS regardless.

## 2. The one constraint that shapes the participant side

The fill view (`ParticipantWorkbookPage.jsx`) defaults `selectedSectionId` to
**`__all__`** — every section renders in one long scrolling page. So reading
`selectedSectionId` tells you nothing for most participants. The "current
exercise" comes from an **IntersectionObserver scroll-spy** over the section
headings:

- Observe each `<section className="wb-section" data-section-id>` with a
  `rootMargin` defining an "active band" in the top ~third of the viewport.
- Current section = the **first section (document order) intersecting the
  band**. Deterministic and order-correct.
- In single-section mode (`selectedSectionId !== __all__`) skip the observer —
  current = the selected section directly.

## 3. Where things live (code)

- **Migration:** `supabase/migrations/20260524000000_participant_cursor.sql` —
  table, server-timestamp trigger, RLS (participant rw-own / trainer read-all),
  realtime publication. Idempotent.
- **Hook:** `src/hooks/useSessionCursor.js`. One hook, two modes:
  - **participant** (`track: true`): upserts its own cursor when the scroll-spy
    section changes, plus a 20s heartbeat.
  - **trainer** (`track: false`): loads all cursors for the session + keeps
    them live via `postgres_changes`. Returns `cursors`:
    `participantId -> { section_id, section_title, moved_at, last_seen }`.
- **Participant side:** `src/pages/ParticipantWorkbookPage.jsx` — scroll-spy →
  `currentSectionId` → hook in track mode.
- **Trainer side:** `src/pages/SessionDashboardPage.jsx` — hook in read mode;
  **On now** column + "● N online" count + a 15s tick so dots decay without an
  event.
- **Styles:** `src/styles/dashboard.css` — `.presence`, `.presence-dot`
  (live/idle/offline), `.presence-label`, `.online-count`.

## 4. Server-authoritative timestamps (no client-clock trust)

`set_cursor_timestamps()` (trigger) stamps, on the DB clock:
- `last_seen := now()` on **every** write (heartbeat included) → drives
  online/offline.
- `moved_at := now()` only when `section_id` actually changes (or on insert) →
  drives live vs. idle.

The participant never sends a timestamp. The trainer compares these server
timestamps to its own `Date.now()`; with NTP-synced browsers and 45s windows
the residual skew is immaterial (documented, not engineered away).

The live/idle decision also ORs in a recent answer (`answers.updated_at`,
already loaded) so someone typing in one long exercise without changing section
still reads "live."

## 5. Test plan (localhost first — see memory: verify on localhost)

Apply the migration to the hosted DB first (idempotent, safe to re-run on
push). Then, in two browsers:

1. Trainer opens a live session dashboard → Participants tab. Sign in as an
   enrolled participant in a second browser/incognito.
2. Participant scrolls → trainer's **On now** updates to the exercise heading in
   the participant's viewport; dot ● green; "● 1 online" in the header.
3. Participant switches the section selector to a specific exercise → On now
   follows it.
4. Participant sits still > 45s (no scroll/typing) → dot decays to ◐ idle.
   They type an answer → back to ● live.
5. Participant closes the tab → within ~45s the row flips to ○ offline showing
   "last · <exercise of their most recent answer>".
6. Two participants on different exercises → trainer sees the spread.
7. **Peer privacy:** as participant A, in DevTools, attempt to read participant
   B's cursor (`supabase.from('participant_cursor').select()` for the session)
   → RLS returns only A's own row, never B's.
8. Closed session / no participants → no errors; column renders offline/"—".
9. `npm run build` (memory: dev passing ≠ prod build passing).

## 6. Deploy notes

- Migration is idempotent; apply via the hosted SQL Editor (it's invisible to
  the tracker, so the GitHub integration re-runs it on push — guards make that
  safe). No edge-function changes, so a push isn't required for the feature to
  work once the migration is applied — but push to keep the tree deployable.

## 7. Deferred / follow-ups

- **Cohort-spread badges in "By exercise."** Once cursors stream, the
  `ExerciseResponses` sidebar can show a `· N` count per exercise ("how many are
  parked here now"). Free data; v2.
- **Re-render churn.** Heartbeats write every 20s/participant, each firing a
  `postgres_changes` event → a dashboard re-render. Fine at cohort scale; if it
  ever matters, throttle or skip state updates that only bump `last_seen`.
- **Spotlight / "jump to"** (the other half of roadmap #1) — trainer pushes the
  cohort to an exercise. Separate feature; this cursor read is the prerequisite.

## 8. Known low-risk gap

The participant write policy (`participant_cursor_self_rw`) only checks
`participant_id = auth.uid()`, not session enrolment — so a participant could
upsert a cursor row for a session they're not in. The trainer of that session
never renders it (their UI iterates `session_participants`, so unknown rows are
invisible), and it leaks nothing. This is parity with `participant_prep`, which
has the same shape. Add a `session_participants` enrolment guard to the `with
check` if this junk-write surface ever matters.
