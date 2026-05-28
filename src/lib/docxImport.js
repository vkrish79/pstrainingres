// Parses a .docx file into a workbook structure (title + sections + blocks).
//
// Two ways to drive the parser:
//
//  1. EXPLICIT MARKERS (preferred, works in any docx):
//     Heading 1                          → workbook title
//     Heading 2                          → new section
//     Paragraph [SHORT: label]           → field, short_text
//     Paragraph [LONG:  label]           → field, long_text
//     Paragraph [CHOICE: label | A | B]  → field, choice
//     Paragraph [CHECK:  label | A | B]  → field, check_group
//     Table cell [INPUT:short|long]      → input cell (else static)
//
//  2. HEURISTICS (so existing Etihad-style workbooks import without rework):
//     - Bold paragraph matching /^(Exercise|Section|Module|Chapter|Lesson|Lab|Activity|Part)\s+\d+/i
//       → starts a new section
//     - Word content-control placeholder text in a cell
//       ("Click or tap here to enter text.", "...to enter a date.")
//       → becomes a short_text input cell
//     - Word TOC paragraphs (links to #_Toc...) are skipped
//     - Bold-cell rows are treated as table headers
//     - Single-answer MCQ table (spanning question row over 2-cell option rows
//       where each left cell has one native Word checkbox) → field, choice
//     - Matrix table (question row + bold header row + option rows where the
//       last K cells each have one checkbox) → prose question + one
//       check_group field per option row, options = trailing K column headers
//     - Pre-section "Document information" / "Revision information" tables
//       are dropped (Word boilerplate)

export async function parseDocxToWorkbook(file) {
  const { default: mammoth } = await import('mammoth/mammoth.browser.js');
  const arrayBuffer = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
  return parseHtmlToWorkbook(html, file.name);
}

export function parseHtmlToWorkbook(html, fallbackName = 'Imported workbook') {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstChild;

  const tocLookup = buildTocLookup(root);

  // Pre-pass: count H1s and harvest the workbook title from the
  // "Document Information" table's `Document title` row (if present).
  // ≥2 H1s → "hierarchy mode": every H1 becomes a group section above its
  // H2/exercise children, pre-section content is preserved as Cover + Document
  // Information. Single-H1 docs (e.g. ARDW) keep the legacy "first H1 =
  // workbook title" behavior, so the smoke-test import is unchanged.
  const elements = Array.from(root.childNodes).filter(n => n.nodeType === 1);
  let h1Count = 0;
  let docInfoTitle = null;
  for (const n of elements) {
    const tg = n.tagName.toLowerCase();
    if (tg === 'h1') h1Count += 1;
    else if (tg === 'table' && isMetadataTable(n)) {
      const t = extractDocumentTitleFromTable(n);
      if (t && !docInfoTitle) docInfoTitle = t;
    }
  }
  const hierarchyMode = h1Count >= 2;

  let title = null;
  let description = null;
  const sections = [];
  let current = null;
  // Tracks whether we've consumed pre-H1 content into a Cover/Doc-Info section.
  let coverEmitted = false;
  let docInfoEmitted = false;
  let sawFirstHeading = false;

  function ensureSection() {
    if (!current) {
      current = { title: 'Untitled section', blocks: [], kind: 'exercise' };
      sections.push(current);
    }
    return current;
  }

  // Hierarchy mode: lazily create the Cover group when the first pre-heading
  // content appears, so a doc with no front matter doesn't get an empty Cover.
  function ensureCoverSection() {
    if (!coverEmitted) {
      current = { title: 'Cover', blocks: [], kind: 'group' };
      sections.push(current);
      coverEmitted = true;
    }
    return current;
  }

  for (const node of elements) {
    const tag = node.tagName.toLowerCase();

    if (tag === 'h1' || tag === 'h2') {
      const headText = resolveHeadingText(node, tocLookup);

      if (hierarchyMode) {
        // In hierarchy mode every H1 is a group section, every H2 is an
        // exercise. The workbook title comes from the pre-pass (Doc Info)
        // or falls back to the filename; H1 is never consumed as the title.
        sawFirstHeading = true;
        if (headText) {
          const kind = tag === 'h1' ? 'group' : 'exercise';
          current = { title: headText, blocks: [], kind };
          sections.push(current);
        }
        continue;
      }

      // Legacy mode (single-H1 docs like ARDW): unchanged behavior.
      if (tag === 'h1' && !title && !SECTION_HEADER_RE.test(headText)) {
        if (headText) title = headText;
        continue;
      }
      if (headText) {
        current = { title: headText, blocks: [], kind: 'exercise' };
        sections.push(current);
      }
      continue;
    }

    if (tag === 'h3' || tag === 'h4' || tag === 'ul' || tag === 'ol' || tag === 'blockquote') {
      ensureSection().blocks.push(prose(node.outerHTML));
      continue;
    }

    if (tag === 'p') {
      const text = node.textContent.trim();
      if (!text) continue;

      // Skip Word TOC paragraphs (e.g. "<p><a href='#_Toc...'>Exercise 1\t4</a></p>")
      if (isTocParagraph(node)) continue;

      // No h1 in the doc? Use the first bold short paragraph as the title
      // (legacy behavior — hierarchy mode never enters this branch because
      // the title is sourced from the Doc Info table / filename instead).
      if (!hierarchyMode && !title && !current && isAllBold(node) && text.length < 80) {
        title = text;
        continue;
      }

      // Heuristic section header (e.g. "Exercise 1", "Module 3 – Booking")
      if (looksLikeSectionHeader(node, text)) {
        current = { title: text, blocks: [], kind: 'exercise' };
        sections.push(current);
        sawFirstHeading = true;
        continue;
      }

      const field = parseFieldMarker(text);
      if (field) {
        const host = hierarchyMode && !sawFirstHeading ? ensureCoverSection() : ensureSection();
        host.blocks.push({ block_type: 'field', config: field });
        continue;
      }

      // Legacy: first plain pre-section paragraph → description.
      if (!hierarchyMode && !current && !description && title) {
        description = text;
        continue;
      }

      // Hierarchy mode: pre-heading paragraphs go into the Cover group so
      // the front-matter page is preserved exactly as written.
      if (hierarchyMode && !sawFirstHeading) {
        ensureCoverSection().blocks.push(prose(node.outerHTML));
        continue;
      }

      ensureSection().blocks.push(prose(node.outerHTML));
      continue;
    }

    if (tag === 'table') {
      const isMeta = isMetadataTable(node);

      if (hierarchyMode && isMeta && !sawFirstHeading) {
        // Bundle metadata tables under a single "Document Information" group.
        if (!docInfoEmitted) {
          current = { title: 'Document Information', blocks: [], kind: 'group' };
          sections.push(current);
          docInfoEmitted = true;
        }
        current.blocks.push(tableBlockFromHtml(node));
        continue;
      }

      // Legacy mode preserves prior behavior: we don't trust the metadata-table
      // detector here, so these tables fall through as ordinary table blocks
      // (which is what the older heading-text regex did in practice for ARDW).
      // The detector is still used to harvest the workbook title in the pre-pass.

      const sec = hierarchyMode && !sawFirstHeading ? ensureCoverSection() : ensureSection();
      const choice = tryChoiceFieldFromTable(node);
      if (choice) { sec.blocks.push(choice); continue; }
      const matrix = tryMatrixFieldsFromTable(node);
      if (matrix) { matrix.forEach(b => sec.blocks.push(b)); continue; }
      const split = tryInlineChoiceSplit(node);
      if (split) { split.forEach(b => sec.blocks.push(b)); continue; }
      const stacked = tryStackedChoiceSplit(node);
      if (stacked) { stacked.forEach(b => sec.blocks.push(b)); continue; }
      sec.blocks.push(tableBlockFromHtml(node));
      continue;
    }
  }

  const resolvedTitle = hierarchyMode
    ? (docInfoTitle || fallbackName.replace(/\.docx?$/i, ''))
    : (title || fallbackName.replace(/\.docx?$/i, ''));

  return {
    title: resolvedTitle,
    description,
    sections,
  };
}

// Pull the value from a "Document title" labelled row inside a Document
// Information table. Tries common label variants so workbooks authored with
// slightly different wording still surface a title.
function extractDocumentTitleFromTable(tableEl) {
  const rows = Array.from(tableEl.querySelectorAll('tr'));
  for (let i = 0; i < rows.length; i++) {
    const cells = Array.from(rows[i].children);
    for (let j = 0; j < cells.length; j++) {
      const label = (cells[j].textContent || '').trim().toLowerCase();
      if (label === 'document title' || label === 'title' || label === 'workbook title') {
        // Value can be the next cell in the same row, or the cell directly
        // below (Word "label above, value below" layouts).
        const nextInRow = cells[j + 1];
        if (nextInRow && nextInRow.textContent.trim()) return nextInRow.textContent.trim();
        const below = rows[i + 1]?.children?.[j];
        if (below && below.textContent.trim()) return below.textContent.trim();
      }
    }
  }
  return null;
}

function prose(html) {
  return { block_type: 'prose', config: { html } };
}

function parseFieldMarker(text) {
  const m = text.match(/^\[(SHORT|LONG|CHOICE|CHECK)\s*:\s*([\s\S]+)\]$/i);
  if (!m) return null;
  const kind = m[1].toUpperCase();
  const inner = m[2].trim();

  if (kind === 'SHORT') return { label: inner, input_type: 'short_text' };
  if (kind === 'LONG') return { label: inner, input_type: 'long_text' };

  const parts = inner.split('|').map(s => s.trim()).filter(Boolean);
  const label = parts.shift() || 'Untitled question';
  const options = parts.length ? parts : ['Option 1', 'Option 2'];
  return {
    label,
    input_type: kind === 'CHOICE' ? 'choice' : 'check_group',
    options,
  };
}

// Detects the "single-answer MCQ" table shape produced by Word docs that use
// native checkbox content controls in the first column. Shape:
//
//   row 0: one cell (typically colspan=N) containing the question text,
//          often wrapped in <ol><li>...</li></ol>
//   rows 1..n: exactly 2 cells. Left cell has exactly one
//              <input type="checkbox" /> + a short letter label (A, B, C...).
//              Right cell has the option text and no checkbox.
//
// Returns a { block_type: 'field', config: { input_type: 'choice', ... } }
// block, or null if the table doesn't match the signature.
function tryChoiceFieldFromTable(tableEl) {
  const allRows = Array.from(tableEl.querySelectorAll('tr'));
  if (allRows.length < 2) return null;

  const firstRowCells = Array.from(allRows[0].children);
  if (firstRowCells.length !== 1) return null;

  const optionRows = allRows.slice(1);
  if (optionRows.length < 2) return null;
  if (!optionRows.every(tr => tr.children.length === 2)) return null;

  for (const tr of optionRows) {
    const [left, right] = Array.from(tr.children);
    const leftBoxes = left.querySelectorAll('input[type="checkbox"]');
    const rightBoxes = right.querySelectorAll('input[type="checkbox"]');
    if (leftBoxes.length !== 1) return null;
    if (rightBoxes.length !== 0) return null;
  }

  const label = stripLeadingListNumber(firstRowCells[0].textContent.trim());
  if (!label) return null;

  const options = optionRows
    .map(tr => tr.children[1].textContent.trim())
    .filter(Boolean);
  if (options.length < 2) return null;

  return {
    block_type: 'field',
    config: { label, input_type: 'choice', options },
  };
}

function stripLeadingListNumber(text) {
  return text.replace(/^\s*\d+[.)]\s+/, '').trim();
}

// Detects the "matrix / multi-column tick" table shape: a question header row,
// then a header row of column labels, then option rows where the last K cells
// each contain one checkbox. Emits one prose block (the question) plus one
// `field` (input_type: check_group) block per option row, with options drawn
// from the last K column headers. Returns an array of blocks, or null if the
// table doesn't match.
function tryMatrixFieldsFromTable(tableEl) {
  const allRows = Array.from(tableEl.querySelectorAll('tr'));
  if (allRows.length < 3) return null;

  const r0Cells = Array.from(allRows[0].children);
  if (r0Cells.length !== 1) return null;
  const question = stripLeadingListNumber(r0Cells[0].textContent.trim());
  if (!question) return null;

  const r1Cells = Array.from(allRows[1].children);
  if (r1Cells.length < 2) return null;
  for (const c of r1Cells) {
    if (c.querySelector('input[type="checkbox"]')) return null;
    const t = c.textContent.trim();
    if (!t) return null;
    if (!(c.querySelector('strong, b') || isAllBold(c))) return null;
  }

  const optionRows = allRows.slice(2);
  if (!optionRows.length) return null;

  const counts = optionRows.map(tr => tr.querySelectorAll('input[type="checkbox"]').length);
  const K = counts[0];
  if (!K || counts.some(n => n !== K)) return null;
  if (r1Cells.length < K) return null;

  // Verify shape: trailing K cells in each option row each have exactly one
  // checkbox; preceding label cells have none.
  for (const tr of optionRows) {
    const cells = Array.from(tr.children);
    if (cells.length < K + 1) return null;
    const checkCells = cells.slice(-K);
    const labelCells = cells.slice(0, -K);
    for (const lc of labelCells) {
      if (lc.querySelectorAll('input[type="checkbox"]').length !== 0) return null;
    }
    for (const cc of checkCells) {
      if (cc.querySelectorAll('input[type="checkbox"]').length !== 1) return null;
    }
  }

  const options = r1Cells.slice(-K).map(c => c.textContent.trim());
  if (options.some(o => !o)) return null;

  const blocks = [prose(`<p><strong>${escapeHtml(question)}</strong></p>`)];
  for (const tr of optionRows) {
    const cells = Array.from(tr.children);
    const labelCells = cells.slice(0, -K);
    const label = labelCells
      .map(c => c.textContent.trim())
      .filter(t => t && !/^[A-Z][.)]?$/.test(t))
      .join(' — ');
    if (!label) continue;
    blocks.push({
      block_type: 'field',
      config: { label, input_type: 'check_group', options },
    });
  }
  if (blocks.length < 2) return null;
  return blocks;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// "Document information" / "Revision information" boilerplate tables are
// detected by their distinctive first-column labels rather than the heading
// paragraph (which sits OUTSIDE the table in most exports). A table qualifies
// if ≥2 of its first-column cells match this label set.
const METADATA_ROW_LABELS = new Set([
  'document title',
  'document owner',
  'business approval by',
  'version №',
  'version no',
  'version no.',
  'version date',
  'revised by',
  'revision approved by',
  'revision date',
  'revision №',
  'revision no',
  'revision no.',
  'effective date',
  'next review date',
]);

function isMetadataTable(tableEl) {
  const rows = Array.from(tableEl.querySelectorAll('tr'));
  if (rows.length < 2) return false;
  let hits = 0;
  for (const tr of rows) {
    const first = tr.querySelector('td, th');
    if (!first) continue;
    const txt = (first.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (METADATA_ROW_LABELS.has(txt)) hits += 1;
  }
  return hits >= 2;
}

// Inline-choice row: a single row inside an otherwise normal data table
// where the first cell holds a question and the remaining cells each
// contain one Word checkbox + a short label (e.g. "☐YES", "☐NO").
// Returns an array of blocks segmenting the table around any such rows,
// or null if the table has none (caller falls back to a plain table block).
function tryInlineChoiceSplit(tableEl) {
  const allRows = Array.from(tableEl.querySelectorAll('tr'));
  if (allRows.length === 0) return null;

  // Detect header row the same way tableBlockFromHtml does.
  let headerRowIdx = -1;
  const theadRow = tableEl.querySelector('thead tr');
  if (theadRow) headerRowIdx = allRows.indexOf(theadRow);
  else {
    const firstCells = Array.from(allRows[0].children);
    const allBold = firstCells.length > 0 && firstCells.every(c => {
      const t = c.textContent.trim();
      return t && (c.querySelector('strong, b') || isAllBold(c));
    });
    if (allBold) headerRowIdx = 0;
  }

  const dataStart = headerRowIdx + 1;
  const dataRows = headerRowIdx >= 0 ? allRows.slice(dataStart) : allRows;
  const classifications = dataRows.map(classifyInlineChoiceRow);
  if (!classifications.some(c => c && c.kind === 'choice')) return null;

  const blocks = [];
  let runStart = 0;
  function flushRun(end) {
    if (end <= runStart) return;
    const sub = subTableFromRows(tableEl, headerRowIdx, dataStart + runStart, dataStart + end);
    if (sub) blocks.push(tableBlockFromHtml(sub));
  }
  for (let i = 0; i < dataRows.length; i++) {
    const c = classifications[i];
    if (c && c.kind === 'choice') {
      flushRun(i);
      blocks.push(c.field);
      runStart = i + 1;
    }
  }
  flushRun(dataRows.length);
  return blocks;
}

function classifyInlineChoiceRow(rowEl) {
  const cells = Array.from(rowEl.children);
  if (cells.length < 2) return null;
  const [first, ...rest] = cells;
  if (first.querySelectorAll('input[type="checkbox"]').length !== 0) return null;
  const question = first.textContent.trim();
  if (!question) return null;
  if (!rest.every(isCheckboxOptionCell)) return null;
  // Strict guard for the option-word fallback (no checkbox glyph or input
  // survived in any rest cell): require the first cell to look like a
  // question. Avoids classifying random short labels in regular data tables.
  const allBareWords = rest.every(c => {
    if (c.querySelectorAll('input[type="checkbox"]').length === 1) return false;
    if (BALLOT_BOX_RE.test((c.textContent || '').trim())) return false;
    return true;
  });
  if (allBareWords && !/\?/.test(question)) return null;
  const options = rest.map(getCheckboxCellLabel).filter(Boolean);
  if (options.length < 2) return null;
  return {
    kind: 'choice',
    field: {
      block_type: 'field',
      config: {
        label: stripLeadingListNumber(question),
        input_type: 'choice',
        options,
      },
    },
  };
}

// A choice option cell is one of:
//   a) has exactly one <input type="checkbox"> (Word content control rendered
//      by mammoth);
//   b) text starts with a ballot-box glyph (☐ □ ☑ etc.) — Word symbol char;
//   c) text is exactly a recognised option word (YES, NO, A, B, ...). This
//      catches the case where Word's content-control checkbox was silently
//      dropped during mammoth conversion and only the label survived. The
//      first cell must contain "?" for the row to qualify, so unrelated
//      short cells in data tables don't get misclassified.
const COMMON_OPTION_WORDS = new Set([
  'yes', 'no', 'y', 'n',
  'true', 'false', 't', 'f',
  'a', 'b', 'c', 'd', 'e', 'f',
  'i', 'ii', 'iii', 'iv', 'v',
  '1', '2', '3', '4', '5',
]);

const BALLOT_BOX_RE = /^[☐☑☒□☐☑☒□]\s*/;

function isCheckboxOptionCell(cellEl) {
  const rawText = (cellEl.textContent || '').trim();
  if (!rawText || rawText.length > 60) return false;
  if (/\[input:(short|long)\]/i.test(rawText)) return false;
  if (/click\s+or\s+tap/i.test(rawText)) return false;

  // (a) Native input checkbox.
  if (cellEl.querySelectorAll('input[type="checkbox"]').length === 1) {
    return !!getCheckboxCellLabel(cellEl);
  }
  // (b) Ballot-box glyph prefix.
  if (BALLOT_BOX_RE.test(rawText)) {
    return !!getCheckboxCellLabel(cellEl);
  }
  // (c) Bare option word.
  const lower = rawText.toLowerCase();
  return COMMON_OPTION_WORDS.has(lower);
}

function getCheckboxCellLabel(cellEl) {
  return (cellEl.textContent || '')
    .replace(BALLOT_BOX_RE, '')
    .trim();
}

// Detects "stacked" choice questions inside a composite questionnaire table:
// a full-width bold question row (a single cell, spanned across the table) that
// is IMMEDIATELY followed by a row whose every cell holds exactly one Word
// checkbox + a label. This is the horizontal-options layout the New Joiner
// workbook uses, e.g.
//
//   <tr><td colspan="4"><strong>1) What type of ticket has been issued?</strong></td></tr>
//   <tr><td>☑Staff Ticket</td><td colspan="2">☑Redemption Ticket</td><td>☑Revenue Ticket</td></tr>
//
// Each such pair becomes one `choice` field; rows in between (e.g. the
// "label | Click or tap here…" text fill-ins) are flushed as residual table
// blocks, exactly as they'd import today — so this only adds the missing
// choice fields and changes nothing else. Returns an array of blocks, or null
// if the table has no such pair. Runs after the vertical-MCQ, matrix, and
// inline-choice detectors, so it never competes with them (a checkbox row of
// ≥2 boxes-per-row can't match any of those — see their cell-count guards).
function tryStackedChoiceSplit(tableEl) {
  const allRows = Array.from(tableEl.querySelectorAll('tr'));
  if (allRows.length < 2) return null;

  // A single-cell row whose text is bold — the question header.
  function isQuestionRow(tr) {
    const cells = Array.from(tr.children);
    if (cells.length !== 1) return false;
    const cell = cells[0];
    if (!cell.textContent.trim()) return false;
    return !!(cell.querySelector('strong, b') || isAllBold(cell));
  }
  // A row of ≥2 cells where EVERY cell has exactly one native checkbox and a
  // non-empty label. Strict on purpose (not isCheckboxOptionCell, whose bare-
  // word fallback could over-match plain data rows in other workbooks).
  function horizontalOptions(tr) {
    const cells = Array.from(tr.children);
    if (cells.length < 2) return null;
    const options = [];
    for (const c of cells) {
      if (c.querySelectorAll('input[type="checkbox"]').length !== 1) return null;
      const label = getCheckboxCellLabel(c);
      if (!label) return null;
      options.push(label);
    }
    return options;
  }

  const blocks = [];
  let runStart = 0;
  let found = false;
  function flushRun(end) {
    if (end <= runStart) return;
    const sub = subTableFromRows(tableEl, -1, runStart, end);
    if (sub) blocks.push(tableBlockFromHtml(sub));
  }

  let i = 0;
  while (i < allRows.length) {
    const options = (i + 1 < allRows.length && isQuestionRow(allRows[i]))
      ? horizontalOptions(allRows[i + 1])
      : null;
    if (options) {
      flushRun(i);
      const label = stripLeadingListNumber(allRows[i].children[0].textContent.trim());
      blocks.push({
        block_type: 'field',
        config: { label: label || 'Untitled question', input_type: 'choice', options },
      });
      runStart = i + 2;
      i += 2;
      found = true;
    } else {
      i += 1;
    }
  }
  if (!found) return null;
  flushRun(allRows.length);
  return blocks;
}

// Clone the table, keep only the header row (if any) + the row range
// [absStart, absEnd) (absolute indexes into allRows). Empty result -> null.
function subTableFromRows(tableEl, headerRowIdx, absStart, absEnd) {
  if (absEnd <= absStart) return null;
  const clone = tableEl.cloneNode(true);
  const rows = Array.from(clone.querySelectorAll('tr'));
  const keep = new Set();
  if (headerRowIdx >= 0 && headerRowIdx < rows.length) keep.add(headerRowIdx);
  for (let i = absStart; i < absEnd && i < rows.length; i++) keep.add(i);
  rows.forEach((tr, idx) => { if (!keep.has(idx)) tr.remove(); });
  return clone;
}

function parseSpan(attr) {
  const n = parseInt(attr, 10);
  return Number.isFinite(n) && n > 1 ? n : 1;
}

function tableBlockFromHtml(tableEl) {
  const rows = [];
  let headers = null;
  const allRows = Array.from(tableEl.querySelectorAll('tr'));
  let inputCounter = 0;

  // Detect header row: <thead><tr> OR a first row whose every cell is bold/strong
  let headerRowIndex = -1;
  const theadRow = tableEl.querySelector('thead tr');
  if (theadRow) {
    headerRowIndex = allRows.indexOf(theadRow);
  } else if (allRows.length > 0) {
    const firstCells = Array.from(allRows[0].children);
    const allBold = firstCells.length > 0 && firstCells.every(c => {
      const t = c.textContent.trim();
      return t && (c.querySelector('strong, b') || isAllBold(c));
    });
    if (allBold) headerRowIndex = 0;
  }

  allRows.forEach((tr, ri) => {
    const cells = Array.from(tr.children);
    if (ri === headerRowIndex) {
      headers = cells.map(c => c.textContent.trim());
      return;
    }
    const row = cells.map(td => {
      const text = td.textContent.trim();
      const inputType = detectInputType(text);
      const cell = inputType
        ? { kind: 'input', id: `r${ri}c${++inputCounter}`, input_type: inputType }
        : { kind: 'static', text };
      const colSpan = parseSpan(td.getAttribute('colspan'));
      const rowSpan = parseSpan(td.getAttribute('rowspan'));
      if (colSpan > 1) cell.colSpan = colSpan;
      if (rowSpan > 1) cell.rowSpan = rowSpan;
      return cell;
    });
    rows.push(row);
  });

  const cfg = { rows };
  if (headers) cfg.headers = headers;
  return { block_type: 'table', config: cfg };
}

function isAllBold(el) {
  const text = el.textContent.trim();
  if (!text) return false;
  const boldText = Array.from(el.querySelectorAll('strong, b'))
    .map(b => b.textContent).join('').trim();
  return boldText.length >= text.length * 0.8;
}

const SECTION_HEADER_RE = /^(Exercise|Section|Module|Chapter|Lesson|Lab|Activity|Part|Unit|Topic)\s+(\d+|[IVX]+)\b/i;

function looksLikeSectionHeader(p, text) {
  if (!SECTION_HEADER_RE.test(text)) return false;
  if (text.length > 120) return false; // too long to be a heading
  // Either bold or short — both signal heading-ness
  return isAllBold(p) || text.length < 80;
}

function isTocParagraph(p) {
  const links = p.querySelectorAll('a');
  if (!links.length) return false;
  for (const a of links) {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#_Toc')) return true;
  }
  return false;
}

// Word stores auto-numbered headings ("Exercise 1") with no literal text in
// the heading element — the visible string only lives in the TOC entry. Build
// a map of #_Toc anchor id → text so we can recover the heading text later.
function buildTocLookup(root) {
  const map = new Map();
  for (const a of root.querySelectorAll('a[href^="#_Toc"]')) {
    const id = (a.getAttribute('href') || '').slice(1);
    // TOC entries look like "Exercise 1\t5" — drop the tab + page number.
    const txt = (a.textContent || '').split('\t')[0].trim();
    if (id && txt && !map.has(id)) map.set(id, txt);
  }
  return map;
}

function resolveHeadingText(headingEl, tocLookup) {
  const direct = headingEl.textContent.trim();
  if (direct) return direct;
  for (const a of headingEl.querySelectorAll('a[id^="_Toc"]')) {
    const id = a.getAttribute('id');
    if (id && tocLookup.has(id)) return tocLookup.get(id);
  }
  return '';
}

const PLACEHOLDER_RE = /^Click or tap (here )?to enter (text|a date)\.?$/i;

function detectInputType(text) {
  // Explicit marker first
  const m = text.match(/^\[INPUT\s*:\s*(short|long|short_text|long_text)\]$/i);
  if (m) return m[1].toLowerCase().startsWith('long') ? 'long_text' : 'short_text';
  // Word content-control placeholder
  if (PLACEHOLDER_RE.test(text)) return 'short_text';
  return null;
}

// Counts to show in the import preview
export function countsOf(parsed) {
  let prose = 0, field = 0, table = 0, groups = 0;
  for (const s of parsed.sections) {
    if (s.kind === 'group') groups += 1;
    for (const b of s.blocks) {
      if (b.block_type === 'prose') prose += 1;
      else if (b.block_type === 'field') field += 1;
      else if (b.block_type === 'table') table += 1;
    }
  }
  return { sections: parsed.sections.length, groups, prose, field, table };
}
