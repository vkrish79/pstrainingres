// Light rich text for participant notes. Notes are authored in a WYSIWYG
// contentEditable editor and stored as a CONSTRAINED HTML subset —
// <strong>/<em>/<ul>/<ol>/<li>/<p>/<br> only, with NO attributes.
//
// `sanitizeNotesHtml` reconstructs its output from an allowlist, emitting only
// those tags and escaped text and never copying attributes, so the result is
// XSS-safe even though it's rendered via dangerouslySetInnerHTML (in the
// participant PDF and the trainer read-views). Run it on BOTH save (from the
// editor) and render (defensive against any value that didn't go through the
// editor).

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Elements dropped wholesale — tag AND content (their text is source code/markup
// noise, and we never want them anywhere near a dangerouslySetInnerHTML sink).
const DROP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'HEAD', 'TITLE']);

function serialize(node) {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) { out += escapeHtml(child.textContent); return; } // text
    if (child.nodeType !== 1) return;                                           // comment etc.
    const tag = child.tagName;
    if (DROP.has(tag)) return;
    if (tag === 'BR') { out += '<br>'; return; }
    const inner = serialize(child);
    if (tag === 'STRONG' || tag === 'B') out += inner ? `<strong>${inner}</strong>` : '';
    else if (tag === 'EM' || tag === 'I') out += inner ? `<em>${inner}</em>` : '';
    else if (tag === 'UL') out += inner ? `<ul>${inner}</ul>` : '';
    else if (tag === 'OL') out += inner ? `<ol>${inner}</ol>` : '';
    else if (tag === 'LI') out += `<li>${inner}</li>`;
    else if (tag === 'P' || tag === 'DIV') out += inner ? `<p>${inner}</p>` : '';
    else out += inner; // unknown inline (span, font, …): unwrap, keep the text
  });
  return out;
}

export function sanitizeNotesHtml(html) {
  if (!html) return '';
  const root = document.createElement('div');
  root.innerHTML = String(html);
  return serialize(root);
}

// Plain text for word count and CSV. Block boundaries become newlines; list
// items get a leading dash so a CSV cell stays readable. Reading textContent
// off a detached element never executes anything.
export function htmlToPlain(html) {
  if (!html) return '';
  const root = document.createElement('div');
  root.innerHTML = String(html)
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(p|div|li|ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  return (root.textContent || '').replace(/\n{2,}/g, '\n').trim();
}

export function wordCountHtml(html) {
  const plain = htmlToPlain(html);
  return plain ? plain.split(/\s+/).filter(Boolean).length : 0;
}
