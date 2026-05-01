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

  let title = null;
  let description = null;
  const sections = [];
  let current = null;
  const tocLookup = buildTocLookup(root);

  function ensureSection() {
    if (!current) {
      current = { title: 'Untitled section', blocks: [] };
      sections.push(current);
    }
    return current;
  }

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType !== 1) continue;
    const tag = node.tagName.toLowerCase();

    if (tag === 'h1' || tag === 'h2') {
      // Word auto-numbered headings (e.g. "Exercise 1") often arrive as an
      // empty heading element whose only content is anchor `<a id="_Toc...">`
      // tags. Recover the visible text from the matching TOC entry.
      const headText = resolveHeadingText(node, tocLookup);
      // If an h1 looks like a section header (e.g. "Exercise 3"), treat it as one.
      if (tag === 'h1' && !title && !SECTION_HEADER_RE.test(headText)) {
        if (headText) title = headText;
        continue;
      }
      if (headText) {
        current = { title: headText, blocks: [] };
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

      // No h1 in the doc? Use the first bold short paragraph as the title.
      if (!title && !current && isAllBold(node) && text.length < 80) {
        title = text;
        continue;
      }

      // Heuristic section header (e.g. "Exercise 1", "Module 3 – Booking")
      if (looksLikeSectionHeader(node, text)) {
        current = { title: text, blocks: [] };
        sections.push(current);
        continue;
      }

      const field = parseFieldMarker(text);
      if (field) {
        ensureSection().blocks.push({ block_type: 'field', config: field });
        continue;
      }

      // Capture the description if it's the first plain paragraph before any section
      if (!current && !description && title) {
        description = text;
        continue;
      }
      ensureSection().blocks.push(prose(node.outerHTML));
      continue;
    }

    if (tag === 'table') {
      // Pre-section "Document information" / "Revision information" tables —
      // Word boilerplate. Skip them so they don't become an Untitled section.
      if (!current && isMetadataTable(node)) continue;
      const sec = ensureSection();
      const choice = tryChoiceFieldFromTable(node);
      if (choice) { sec.blocks.push(choice); continue; }
      const matrix = tryMatrixFieldsFromTable(node);
      if (matrix) { matrix.forEach(b => sec.blocks.push(b)); continue; }
      sec.blocks.push(tableBlockFromHtml(node));
      continue;
    }
  }

  return {
    title: title || fallbackName.replace(/\.docx?$/i, ''),
    description,
    sections,
  };
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

const METADATA_TABLE_RE = /\b(document|revision)\s+information\b/i;

function isMetadataTable(tableEl) {
  return METADATA_TABLE_RE.test(tableEl.textContent || '');
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
  let prose = 0, field = 0, table = 0;
  for (const s of parsed.sections) {
    for (const b of s.blocks) {
      if (b.block_type === 'prose') prose += 1;
      else if (b.block_type === 'field') field += 1;
      else if (b.block_type === 'table') table += 1;
    }
  }
  return { sections: parsed.sections.length, prose, field, table };
}
