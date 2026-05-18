// Minimal markdown for participant notes. Intentionally tiny — only what's
// useful for jotted notes:
//   **bold**     -> <strong>
//   _italic_     -> <em>
//   - bullet     -> <li> inside <ul>  (line-leading hyphen + space)
// Everything else is escaped and rendered as plain text. Returns an HTML
// string safe to drop into dangerouslySetInnerHTML.

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(escaped) {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)_(.+?)_(?=\s|[.,!?;:]|$)/g, '$1<em>$2</em>');
}

export function renderMarkdownLite(raw) {
  if (!raw) return '';
  const lines = escapeHtml(raw).split('\n');
  const out = [];
  let inList = false;
  for (const line of lines) {
    const bullet = line.match(/^-\s+(.*)$/);
    if (bullet) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(bullet[1])}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (line.trim() === '') out.push('<br>');
      else out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

export function wordCount(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}
