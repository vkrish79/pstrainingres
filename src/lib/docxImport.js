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
      const headText = node.textContent.trim();
      // If an h1 looks like a section header (e.g. "Exercise 3"), treat it as one.
      if (tag === 'h1' && !title && !SECTION_HEADER_RE.test(headText)) {
        title = headText;
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
      ensureSection().blocks.push(tableBlockFromHtml(node));
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
      if (inputType) {
        inputCounter += 1;
        return { kind: 'input', id: `r${ri}c${inputCounter}`, input_type: inputType };
      }
      return { kind: 'static', text };
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
