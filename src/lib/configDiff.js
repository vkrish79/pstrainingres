// Turning two block configs into a readable list of what changed.
//
// A session trainer can only edit authored TEXT on a clone — structure is
// locked (see ContentEditor). So the useful diff is not "this JSON vs that
// JSON" but a short list of the specific strings that moved: a field label, an
// option's wording, a table cell. Everything else in the config is noise.
//
// The keys below mirror exactly what ContentEditor exposes as editable:
//   prose  → config.html
//   field  → config.label, config.options[i]
//   table  → config.caption, config.headers[i], config.rows[r][c].text (static)

export function configLines(blockType, config) {
  const cfg = config || {};
  const out = [];

  if (blockType === 'prose') {
    out.push({ key: 'html', label: 'Text', text: cfg.html || '', html: true });
    return out;
  }

  if (blockType === 'field') {
    out.push({ key: 'label', label: 'Label', text: cfg.label || '' });
    (Array.isArray(cfg.options) ? cfg.options : []).forEach((opt, i) => {
      out.push({ key: `opt:${i}`, label: `Option ${i + 1}`, text: opt ?? '' });
    });
    return out;
  }

  if (blockType === 'table') {
    // Always emitted, even when absent, so an added or removed caption pairs
    // up with the other side instead of looking like an unrelated line.
    out.push({ key: 'caption', label: 'Caption', text: cfg.caption || '' });
    (Array.isArray(cfg.headers) ? cfg.headers : []).forEach((h, i) => {
      out.push({ key: `hdr:${i}`, label: `Column ${i + 1}`, text: h ?? '' });
    });
    (Array.isArray(cfg.rows) ? cfg.rows : []).forEach((row, ri) => {
      (Array.isArray(row) ? row : []).forEach((cell, ci) => {
        if (cell?.kind !== 'static') return; // answer cells are never authored
        out.push({ key: `cell:${ri}:${ci}`, label: `Row ${ri + 1}, col ${ci + 1}`, text: cell.text || '' });
      });
    });
    return out;
  }

  return out;
}

// Strip tags for display. Prose is stored as raw HTML and edited as raw HTML,
// but a diff full of <p> tags hides the sentence that actually changed.
export function plainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|li|h[1-6]|div)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Only the lines that moved. `formattingOnly` marks a prose change whose
// visible words are identical — the trainer touched the markup, not the
// wording, which is almost never worth carrying into the master.
export function diffConfigs(blockType, before, after) {
  const b = new Map(configLines(blockType, before).map(l => [l.key, l]));
  const a = new Map(configLines(blockType, after).map(l => [l.key, l]));
  const keys = [...new Set([...b.keys(), ...a.keys()])];

  return keys.map(k => {
    const line = a.get(k) || b.get(k);
    const beforeText = b.get(k)?.text ?? null;
    const afterText = a.get(k)?.text ?? null;
    const isHtml = !!line.html;
    return {
      key: k,
      label: line.label,
      before: beforeText,
      after: afterText,
      beforeShown: isHtml ? plainText(beforeText) : (beforeText ?? ''),
      afterShown: isHtml ? plainText(afterText) : (afterText ?? ''),
      formattingOnly: isHtml
        && (beforeText ?? '') !== (afterText ?? '')
        && plainText(beforeText) === plainText(afterText),
    };
  }).filter(d => (d.before ?? '') !== (d.after ?? ''));
}

// ===== Adopting one line into the master =====
//
// A diff line's key encodes where the text lives in the config, so the same
// key that labels a line can address it. Reading and writing go through this
// one pair, so a key that can be shown can always be applied — and adopting
// touches ONLY that field, leaving everything else in the master block alone.

// The current value of one line, or undefined if that path isn't there any
// more (the master block was restructured since the session edited it).
export function getLineValue(blockType, config, key) {
  const cfg = config || {};
  if (key === 'html') return cfg.html;
  if (key === 'label') return cfg.label;
  if (key === 'caption') return cfg.caption;

  const [kind, a, b] = key.split(':');
  if (kind === 'opt') return cfg.options?.[Number(a)];
  if (kind === 'hdr') return cfg.headers?.[Number(a)];
  if (kind === 'cell') {
    const cell = cfg.rows?.[Number(a)]?.[Number(b)];
    // Answer cells carry no authored text and must never be written through.
    return cell?.kind === 'static' ? cell.text : undefined;
  }
  return undefined;
}

// A copy of the config with one line set. Returns null when the path no longer
// exists — the caller reports that rather than inventing structure, because
// growing a table back to fit an old edit is not adopting a change.
export function setLineValue(blockType, config, key, value) {
  const next = JSON.parse(JSON.stringify(config || {}));

  if (key === 'html') { next.html = value; return next; }
  if (key === 'label') { next.label = value; return next; }
  if (key === 'caption') { next.caption = value; return next; }

  const [kind, a, b] = key.split(':');
  const i = Number(a);
  if (kind === 'opt') {
    if (!Array.isArray(next.options) || i >= next.options.length) return null;
    next.options[i] = value;
    return next;
  }
  if (kind === 'hdr') {
    if (!Array.isArray(next.headers) || i >= next.headers.length) return null;
    next.headers[i] = value;
    return next;
  }
  if (kind === 'cell') {
    const j = Number(b);
    const cell = next.rows?.[i]?.[j];
    if (!cell || cell.kind !== 'static') return null;
    cell.text = value;
    return next;
  }
  return null;
}

// Heat bands. Driven by how many DISTINCT SESSIONS changed a thing, never by
// the raw edit count: one trainer fiddling with a paragraph is not the same
// signal as eight cohorts independently rewording it.
export function heatLevel(sessionCount) {
  const n = Number(sessionCount) || 0;
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n === 2) return 2;
  if (n <= 4) return 3;
  return 4;
}
