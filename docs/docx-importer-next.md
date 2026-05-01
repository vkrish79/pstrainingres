# DOCX importer — next iteration (handoff doc)

**Status:** §5 steps 1, 2, 3, 5 are implemented. Step 4 was rolled into step 1.
Open follow-up: header-row span preservation (see §8 below). This document
remains useful as the handoff for the follow-up and as the rationale record.

**Trigger:** the new workbook `workbook-source/Etihad Guest Redemption Workbook.docx`
exposes two limitations called out in `docs/progress.md`:

1. The known limitation at `docs/progress.md` lines 59-64: **`colspan` / `rowspan`
   are not preserved**, producing ragged imported tables.
2. **Native Word checkboxes are silently dropped** by the current importer.

The task is to close both gaps so this workbook imports cleanly.

---

## 1. Context — where things live

- Current importer: `src/lib/docxImport.js`
- Field/cell schema helpers: `src/lib/blockHelpers.js`
- Editor (cell input-type UI): `src/components/editor/BlockForm.jsx`
- Existing field input types (already supported in the model): `short_text`,
  `long_text`, `choice` (single-radio), `check_group` (multi-checkbox). See
  `BlockForm.jsx:39-40`.
- Source workbooks for comparison:
  - `workbook-source/ARDW Overview Workbook - Online.docx` — the v1 reference
    that the existing heuristics already handle.
  - `workbook-source/Etihad Guest Redemption Workbook.docx` — the new workbook
    that motivates this iteration.
- Pre-generated analysis artifacts (uncommitted; useful but disposable):
  - `workbook-source/_egrw_mammoth.html` — raw mammoth HTML output for the new
    workbook
  - `workbook-source/_egrw_mammoth_pretty.html` — same, with newlines inserted
    after structural tags so it's grep-friendly
  - `workbook-source/_egrw_analysis.txt` — earlier feature dump (table-by-table
    summary with `gridSpan`/`vMerge` counts and checkbox/SDT detection)

If the artifacts above are gone, regenerate by running mammoth on the docx —
`src/lib/docxImport.js` itself uses `mammoth/mammoth.browser.js` so the same
output is produced in-app.

---

## 2. What's in the new workbook (numbers)

Counted from the mammoth HTML:

- **162 tables**, **14 H1**, **39 H2**, ~50 plain paragraphs.
- **Almost all content lives in tables** (including most of the prose).
- **Zero `[SHORT:...]`/`[LONG:...]`/`[CHOICE:...]`/`[CHECK:...]` markers** anywhere.
  Trainers will not be retrofitting bracket markers; the importer must read
  native Word constructs.
- **148 native checkboxes** distributed across **25 tables**. Source: Word
  `<w:sdt><w14:checkbox/>` content controls. Mammoth converts each one to
  `<input type="checkbox" />`.
- **~140 tables use `colspan`**, **7 use `rowspan`**. So `colspan` is the
  dominant merge case.

---

## 3. Three distinct table patterns the importer must handle

### Pattern A — Single-answer MCQ (~15 tables, dominant question form)

**Shape (HTML):**

```html
<table>
  <tr><td colspan="2"><ol><li>What is the Guest Miles validity ...?</li></ol></td></tr>
  <tr>
    <td><p><strong>A  <input type="checkbox" /></strong></p></td>
    <td><p>02 years from the date miles are earned</p></td>
  </tr>
  <tr>
    <td><p><strong>B  <input type="checkbox" /></strong></p></td>
    <td><p>18 Months from the date miles are earned</p></td>
  </tr>
  ...
</table>
```

**Target:** emit a single `field` block:

```js
{
  block_type: 'field',
  config: {
    label: 'What is the Guest Miles validity for an Etihad Guest Platinum member?',
    input_type: 'choice',
    options: ['02 years from the date miles are earned', '18 Months from ...', 'No Expiry date'],
  }
}
```

**Detection signature:**
- Row 0 has a single cell with `colspan="2"` (or whatever the table's column
  count is) containing a single block of question text. Often the text is
  wrapped in `<ol><li>...</li></ol>`.
- Every subsequent row has exactly 2 cells.
- The left cell of every option row contains exactly one `<input type="checkbox" />`
  AND a short letter label (`A`, `B`, `C`, ...).
- The right cell contains the option text and no checkbox.

### Pattern B — Matrix / multi-column tick (~10 tables)

**Shape (HTML, abridged):**

```html
<table>
  <tr><td colspan="5"><ol><li>Select the right channel ...</li></ol></td></tr>
  <tr>
    <td colspan="2"><p><strong>Transaction</strong></p></td>
    <td><p><strong>VIP Desk</strong></p></td>
    <td><p><strong>Online</strong></p></td>
    <td><p><strong>CC</strong></p></td>
  </tr>
  <tr>
    <td><p><strong>A</strong></p></td>
    <td><p>Choose your EYG Number</p></td>
    <td><p><input type="checkbox" /></p></td>
    <td><p><input type="checkbox" /></p></td>
    <td><p><input type="checkbox" /></p></td>
  </tr>
  ...
</table>
```

**Target:** the schema does **not** have a native matrix block. Two viable
mappings:

- **(A) Per-row `check_group` fields.** Each option row becomes one field whose
  label is the row's static text and whose options are the column headers.
  Loses the visual matrix, gains correctness.
- **(B) Extend the table cell shape with a `kind: 'checkbox'` cell type** so
  the matrix renders as the original grid with toggleable cells. More work,
  more faithful.

Recommendation: ship (A) first, revisit (B) only if trainers complain.

### Pattern C — Step-by-step instruction tables (the large tables)

Mostly static prose with occasional SDT text-input placeholder cells
(`Click or tap here to enter text.`). These are mostly handled today — the
issue is **layout**: extensive `colspan` (and a small amount of `rowspan`) is
dropped, producing ragged rows. Fixing colspan/rowspan in the cell model is
what makes these readable.

---

## 4. Where the current importer drops things — concrete defects

All references are to `src/lib/docxImport.js`.

1. **Checkboxes vanish silently.** `tableBlockFromHtml` at L141-182 only ever
   reads `td.textContent`. `<input type="checkbox" />` carries no text, so an
   MCQ imports as static cells `[A] [02 years…] [B] [18 Months…]` with no
   answerable input. Affects all 25 checkbox tables (148 lost answer points).

2. **No detection of MCQ shape.** The importer never inspects
   `<input type="checkbox">` or considers turning a table into a `field` of
   kind `choice` / `check_group`. The schema already supports both
   (`BlockForm.jsx:39-40`); this is purely an importer mapping change.

3. **`colspan` / `rowspan` are dropped (the line-59-64 limitation).** L162-176
   reads `tr.children` flat. Mammoth emits `colspan="N"` and `rowspan="N"` but
   neither attribute is read or carried. The cell model in `blockHelpers.js`
   has no `colSpan` / `rowSpan` field today. To fix:
   - Extend the cell schema with optional `colSpan` / `rowSpan` (or introduce
     `kind: 'merged'` placeholder cells for occupied positions).
   - Update the table renderer (participant view) to honor them.
   - Update the table editor in `src/components/editor/BlockForm.jsx` to
     preserve them through edits.
   - `inputCellsOf()` at `blockHelpers.js:49-69` is unaffected — it walks
     input cells only.

4. **Header-row detection misfires for MCQ tables.** L148-159 flags row 0 as
   header iff every cell is bold. The MCQ question row is wrapped in
   `<ol><li>` (not `<strong>`), so it is not detected as a header — but it
   shouldn't be a normal row either. Once Pattern A is reclassified as a
   `field`, this becomes moot for MCQs.

5. **`<ol><li>` numbering inside cells.** Mammoth preserves Word's
   auto-numbering as `<ol>`. Today this surfaces as raw "1." text inside
   static cells. For MCQ tables this is part of the question label and needs
   trimming during extraction.

6. **`Document information` / `Revision information` tables** at the very top
   end up as ungrouped blocks before the first H1. Minor — either skip
   pre-H1 tables that contain those headings, or accept that trainers delete
   them in the editor.

7. **SDT text inputs inside Pattern C tables.** `PLACEHOLDER_RE` at L211
   catches `Click or tap here…` strings, but mammoth sometimes emits an empty
   cell for `<w:sdt>` with no visible placeholder text. Worth a follow-up but
   low volume relative to (1) and (3).

---

## 5. Suggested order of work (smallest blast radius first)

1. ✅ **Pattern A → `choice` field.** Implemented in
   `tryChoiceFieldFromTable` (`src/lib/docxImport.js`). Strict detection:
   single-cell row 0, ≥ 2 option rows of exactly 2 cells, left cell has 1
   checkbox + letter label, right cell has option text. `<ol>` numbering is
   stripped via `stripLeadingListNumber`.

2. ✅ **`colspan` / `rowspan` end-to-end (body cells).** Decided on cell-level
   `colSpan` / `rowSpan` props (not placeholder cells) — see §7. Implemented
   across importer (`tableBlockFromHtml`), renderer
   (`src/components/blocks/TableBlock.jsx`), and editor
   (`src/components/editor/BlockForm.jsx` `setCellKind`). Header-row spans
   are still flat (see §8).

3. ✅ **Pattern B (matrix) → per-row `check_group`.** Implemented in
   `tryMatrixFieldsFromTable`. Emits `[prose(question), check_group(row1),
   ...]`. Single-letter label cells (`A`, `B`...) are dropped from the
   row label.

4. ✅ **Strip `<ol>` numbering from MCQ question text.** Bundled with #1.

5. ✅ **Skip pre-H1 metadata tables.** Implemented via `isMetadataTable`
   matching `/(document|revision)\s+information/i` in any pre-section table.

---

## 6. Test workbooks to use

- **Smoke test:** `workbook-source/ARDW Overview Workbook - Online.docx` — must
  continue to import as before (no regressions).
- **Target:** `workbook-source/Etihad Guest Redemption Workbook.docx` — after
  the changes:
  - The "Etihad Guest Product and Polices" section should contain ~15 MCQ
    `choice` fields, not 15 raw tables.
  - Step-by-step instruction tables should render with their merged headers
    visually correct (no ragged rows).
  - No regression in TOC skipping, section detection, or
    `Click or tap here…` placeholder mapping.

---

## 7. Decisions made during implementation

- **Cell schema extension for colspan/rowspan:** went with cell-level optional
  `colSpan` / `rowSpan` props, **not** `kind: 'merged'` placeholders. Mammoth
  emits HTML with the same shape (one cell at the spanning position, no entry
  where covered), so the mapping is direct. `inputCellsOf`, the CSV exporter,
  and the dashboard tile iterate `[ri][ci]` positions and only act on
  `cell.kind === 'input'` — the new fields are invisible to them, so zero
  changes were needed there. Existing stored tables (no spans in their JSON)
  round-trip fine.
- **Pattern B mapping:** shipped as N × `check_group` per the doc's
  Recommendation (A). Richer "matrix-as-table" with a `kind: 'checkbox'` cell
  type is still deferred — revisit only if trainers complain about losing the
  visual matrix.
- **Metadata tables:** drop them silently when they appear before any section
  heading. The detector matches the heading text inside the table itself, so
  it won't drop a content table that legitimately contains the words
  "Document information".

## 8. Open follow-up

- **Header-row span preservation.** `cfg.headers` is still a flat string
  array (see `tableBlockFromHtml`), so a header `<th>` with `colspan="2"`
  splits into two separate columns instead of merging. To fix, headers would
  need to become objects `{ text, colSpan?, rowSpan? }` and the renderer +
  editor would need to handle the new shape. Body-row merging covers the
  bulk of the visual fidelity gap from `progress.md` lines 59-64; this
  finishes the job.
