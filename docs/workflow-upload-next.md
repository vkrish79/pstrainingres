# Workflow upload — handoff doc (PARKED 2026-05-23)

**Status:** parked / not started. Requirement captured + source file inspected;
no code written. Picks up alongside the existing **prep template** setup on the
master workbook (this is a sibling feature, not part of the prep pool).

## 1. The need

A master (template) workbook should be able to carry a **trainer-facing
"workflow"** in addition to its prep template. The trainer running a session
needs the day-by-day run guide (process steps, trainer notes, which exercise
runs on which day) surfaced inside the app.

## 2. Decisions already made (confirmed with the user, 2026-05-23)

- **Parse into in-app content, not a stored binary.** No Supabase Storage
  bucket (the project uses none today — verified). Mirror the prep template:
  parse the sheet(s) and store structured JSON on the workbook.
- **Trainers only.** Participants do NOT see the workflow. (Contrast: prep is
  participant-facing.)
- **Setup = super, on the master workbook editor**, next to `WorkbookPrepPanel`
  (mount point `src/pages/WorkbookEditorPage.jsx:270`, gated `isTemplate`).
- **Storage:** a new nullable `workbooks.workflow jsonb` column (idempotent
  migration; no Storage bucket). Read by trainers downstream.
- **Default view (unconfirmed):** a "Workflow" section on
  `SessionDashboardPage` (where the trainer runs the cohort). Alternatives: the
  trainer's workbook view, or its own tab. **Confirm when picked up.**
- Reuse `src/lib/sheetParse.js` (`parseSheetFile`, via `read-excel-file`) — but
  see §4: it currently returns only the **first sheet**; the workflow is
  multi-sheet, so the parser needs extending.

## 3. Source file shape — `supabase/NJ Workflow.xlsx` (inspected 2026-05-23)

This is **not** a single flat table like the prep template. It's a 262 KB,
**11-sheet** workbook of heterogeneous trainer material. `read-excel-file/node`
returns `[{ sheet, data: rows }, …]` (one entry per sheet).

| Sheet | Rows | Cols | Header / shape |
|---|---|---|---|
| `Ex Mapping` | 82 | 4 | `Ex No.` → sector/scenario pairs (not a flat header) |
| **`Day 4-10`** | 106 | 15 | `Ex \| MAIN TITLE \| SCENARIO \| OLD SECTOR/RBD \| NEW SECTOR/RBD \| PREP / PREVIOUS EXERCISE \| PROCESS STEPS \| TRAINER NOTES \| D4…D10` |
| `Answer to Ex 1` | 40 | 4 | Q&A answer key |
| `Day 1-Overview & IAE` | 29 | 6 | `Slide No \| MAIN TITLE \| MODULE / ACTIVITY \| OBJECTIVE \| TRAINER NOTES \| D1` |
| **`Day 1 - 10 TTT`** | 105 | 20 | `Ex \| MAIN TITLE \| SCENARIO \| Activity \| SECTOR \| PSGR TYPE \| EXERCISE CONTENT \| ANSWERS… \| TRAINER NOTES \| D1…D10 \| MAC` |
| **`Day 11-19`** | 105 | 17 | `Ex \| MAIN TITLE \| SCENARIO \| OLD SECTOR/RBD \| NEW SECTOR/RBD \| PREP / PREVIOUS EXERCISE \| PROCESS STEPS \| TRAINER NOTES \| D11…D19` |
| `Voice Chat Roleplay 1` | 103 | 4 | roleplay script |
| `Sheet1` | 6 | 8 | roleplay (stray) |
| `Flight Information` | 0 | 0 | empty |
| `INSPIRE Day 2-3` | 107 | 10 | `SlideNo \| MAIN TITLE \| Training Aid \| PROCESS STEPS \| TRAINER NOTES \| D2 \| D3` |
| `Refunds FOP` | 52 | 5 | "***Below is JUST FYI…" reference notes |

**The core value** is the `Day …` / `INSPIRE Day …` run-sheets: keyed by
`Ex`/`Slide No`, carrying `PROCESS STEPS` + `TRAINER NOTES`, with **day-column
markers** (`D1…D19`, `MAC`) indicating which day each row runs. Cells contain
multi-line content (e.g. `"AUH-BOM (Q)\nYCOMFORT"`) — preserve newlines.

## 4. Open questions to resolve when un-parking

1. **Which sheets matter?** Import all 11, or just the `Day …` trainer run-sheets
   (skip `Flight Information` empty, maybe keep `Answer to Ex 1` / roleplay /
   `Refunds FOP` as reference)? Likely: ingest every non-empty sheet, render as a
   per-sheet view.
2. **Render model.** Sheets have *different* column shapes → a fixed
   header→field mapping won't work. Store **rows-as-is per sheet** (`{ sheet,
   headers, rows }[]`) and render each as a table / collapsible per-sheet
   section. Possibly group/filter the `Day` sheets by the day columns.
3. **Link to exercises?** The `Ex` column could map to the workbook's
   sections (like prep's `template_section_id`), letting the dashboard show the
   workflow row beside the matching exercise. Or keep it standalone reference.
   Decide effort vs. value.
4. **Multi-sheet parser.** `sheetParse.parseSheetFile` returns only sheet[0]
   today — add a variant that returns all sheets (`read-excel-file` already
   resolves the full array; we currently discard the rest).
5. **Size/perf.** 11 sheets × ~100 rows of rich text → a sizeable jsonb blob.
   Fine for a `workbooks.workflow` column, but confirm it's not bloating the
   row read on every editor load (consider a separate `workbook_workflow` table
   or lazy fetch).
6. **Confirm the view location** (§2) before building.

## 5. Where it slots in (code touchpoints)

- Setup panel: new `src/components/editor/WorkbookWorkflowPanel.jsx`, mounted
  next to `WorkbookPrepPanel` in `WorkbookEditorPage.jsx` (`isTemplate`, super).
- Migration: `alter table workbooks add column if not exists workflow jsonb`
  (idempotent — see memory: idempotent migrations).
- Parser: extend `src/lib/sheetParse.js` for multi-sheet.
- View: trainer-facing section on `SessionDashboardPage.jsx` (the session uses a
  clone; `workflow` lives on the master — read via `coalesce(clone.template_id,
  clone.id)`, same pattern as the prep pool's master resolution).

## 6. Note

The source file `supabase/NJ Workflow.xlsx` is currently sitting in `supabase/`
(untracked). Decide whether to keep it as a fixture or move/remove it — it does
not belong in the `supabase/` migrations folder long-term.
