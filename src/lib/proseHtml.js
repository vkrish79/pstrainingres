// The HTML a prose block stores, as written by the rich-text editor.
//
// The editor is a contentEditable box, and a browser's contentEditable writes
// whatever markup it likes: <b> or <strong>, <div> for a new line, <span
// style=…> around pasted text, and a signed URL on every picture it displays.
// None of that may reach the block. So nothing is read back as innerHTML; the
// editor's DOM is REBUILT from an allowlist, the way notesRichText.js does for
// participant notes:
//
//   blocks   <p> <h3> <h4> <ul> <ol> <li>          (h1/h2/h5/h6 kept as written)
//   inline   <strong> <em> <u> <br>
//   picture  <img data-wb-image="PATH" alt="…">     — the storage path only;
//                                                     the displayed src is dropped
//
// Everything else is unwrapped to its text, and attributes are never copied.
//
// That is lossy for markup outside the list (a <pre>, a link, a class), and
// "contentEditable round-trips mangle the markup" is why the session-copy
// editor stayed on a raw textarea. canEditAsText() answers the question that
// makes this safe: would a pass through the editor give back exactly what is
// stored? If not, the block opens as HTML and nothing is lost.

const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const DROP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'HEAD', 'TITLE']);
const BLOCK = new Set(['P', 'DIV', 'UL', 'OL', 'LI', ...HEADINGS]);

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u00a0/g, '&nbsp;');
}
function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}

function inline(node) {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) { out += esc(child.textContent); return; }
    if (child.nodeType !== 1) return;
    const tag = child.tagName;
    if (DROP.has(tag)) return;
    if (tag === 'BR') { out += '<br>'; return; }
    if (tag === 'IMG') {
      const path = child.getAttribute('data-wb-image');
      // A picture is only ever its storage path. One without a path (pasted,
      // dragged in) has nowhere to live and is dropped.
      if (path) out += `<img data-wb-image="${escAttr(path)}" alt="${escAttr(child.getAttribute('alt') || '')}">`;
      return;
    }
    const inner = BLOCK.has(tag) ? blocks(child) : inline(child);
    if (tag === 'STRONG' || tag === 'B') out += inner ? `<strong>${inner}</strong>` : '';
    else if (tag === 'EM' || tag === 'I') out += inner ? `<em>${inner}</em>` : '';
    else if (tag === 'U') out += inner ? `<u>${inner}</u>` : '';
    else out += inner; // span, font, a, …: keep the words, lose the wrapper
  });
  return out;
}

// Children of a block container. Loose inline content between blocks — what a
// browser leaves when you type straight into the box — is gathered into <p>.
function blocks(node) {
  let out = '';
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const holder = document.createElement('p');
    run.forEach(n => holder.appendChild(n.cloneNode(true)));
    const inner = inline(holder);
    if (inner.replace(/<br>/g, '').trim()) out += `<p>${inner.replace(/(<br>)+$/, '')}</p>`;
    run = [];
  };
  node.childNodes.forEach((child) => {
    if (child.nodeType === 1 && DROP.has(child.tagName)) return;
    if (child.nodeType === 1 && BLOCK.has(child.tagName)) {
      flush();
      const tag = child.tagName;
      if (tag === 'UL' || tag === 'OL') {
        const items = [...child.children].filter(c => c.tagName === 'LI').map(li => `<li>${inline(li)}</li>`).join('');
        if (items) out += `<${tag.toLowerCase()}>${items}</${tag.toLowerCase()}>`;
      } else if (tag === 'LI') {
        out += `<ul><li>${inline(child)}</li></ul>`;
      } else {
        const t = HEADINGS.has(tag) ? tag.toLowerCase() : 'p';
        const inner = inline(child).replace(/(<br>)+$/, '');
        if (inner.replace(/<br>/g, '').trim()) out += `<${t}>${inner}</${t}>`;
      }
      return;
    }
    if (child.nodeType === 3 && !child.textContent.trim() && !run.length) return;
    run.push(child);
  });
  flush();
  return out;
}

export function serializeProse(root) {
  return blocks(root);
}

export function cleanProseHtml(html) {
  const root = document.createElement('div');
  root.innerHTML = String(html || '');
  return serializeProse(root);
}

// Equal once both are parsed by the browser and whitespace between tags is
// ignored, with <b>/<i> read as <strong>/<em> (the same thing, as stored by
// the import and as written by the editor).
//
// An EMPTY anchor (<a id="_Toc…"></a>) is ignored too: Word puts one on every
// heading it lists in a table of contents, it shows nothing, and nothing in the
// app links to it. Counting it would send every imported "Ticket 1" heading to
// the HTML tab. The serializer drops it, which loses nothing anyone sees.
const EMPTY_ANCHOR = /<a\b[^>]*>\s*<\/a>/gi;
function canonical(html) {
  const d = document.createElement('div');
  d.innerHTML = String(html || '')
    .replace(EMPTY_ANCHOR, '')
    .replace(/<(\/?)b>/gi, '<$1strong>')
    .replace(/<(\/?)i>/gi, '<$1em>');
  return d.innerHTML.replace(/>\s+</g, '><').trim();
}

export function canEditAsText(html) {
  if (!String(html || '').trim()) return true;
  return canonical(cleanProseHtml(html)) === canonical(html);
}
