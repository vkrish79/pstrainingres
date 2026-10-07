import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase.js';
import { prepareQuizImage, signedQuizFileUrl } from './quizImages.js';

// Pictures in workbooks and assessments — screenshots that came in with a Word
// import. They live in the PRIVATE workbook-images bucket (readable by anyone
// signed in, uploadable by super trainers and above; see
// RUN-THIS-IN-SUPABASE-workbook-images.txt) and are reached through short-lived
// signed URLs. A block stores only the storage PATH:
//
//   prose:  <img data-wb-image="imports/…/img3-….webp" alt="">   (no src)
//   table:  { kind: 'image', images: ['imports/…'], text?: 'caption' }
//
// so a block's config stays small and a signed URL is never saved anywhere.
export const WORKBOOK_IMAGE_BUCKET = 'workbook-images';

export function signedWorkbookImageUrl(path) {
  return signedQuizFileUrl(WORKBOOK_IMAGE_BUCKET, path);
}

// The prose HTML with each <img data-wb-image> given its signed src.
//
// The URL is put INTO the HTML string rather than set on the DOM node: React
// can replace a block's innerHTML (StrictMode's double mount did, leaving the
// src on a detached copy), and a string it renders itself cannot be lost that
// way. The HTML changes once, when the URLs arrive, so each picture loads once.
// A picture that cannot be signed gets class wb-img-missing.
export function useSignedWorkbookHtml(html) {
  const [urls, setUrls] = useState({});   // path -> signed url, or false if it failed
  const paths = useMemo(
    () => [...new Set([...(html || '').matchAll(/data-wb-image="([^"]+)"/g)].map(m => m[1]))],
    [html],
  );
  const key = paths.join('|');

  useEffect(() => {
    let alive = true;
    paths.forEach((path) => {
      signedWorkbookImageUrl(path)
        .then(({ data, error }) => { if (alive) setUrls(u => ({ ...u, [path]: error || !data ? false : data })); })
        .catch(() => { if (alive) setUrls(u => ({ ...u, [path]: false })); });
    });
    return () => { alive = false; };
    // key stands for paths: re-sign only when the set of pictures changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!paths.length) return html || '';
  return (html || '').replace(/data-wb-image="([^"]+)"/g, (attr, path) => {
    const url = urls[path];
    if (url === false) return `${attr} class="wb-img-missing"`;
    if (url) return `src="${url.replace(/"/g, '&quot;')}" ${attr}`;
    return attr;
  });
}

// ── on import ──────────────────────────────────────────────────────────
// Uploads every picture the parsed workbook actually uses and returns a copy
// of `parsed` with each pending key replaced by its storage path. A picture
// that cannot be uploaded (an old Word EMF/WMF drawing, say, which a browser
// cannot read) is dropped and counted in `skipped`, rather than failing the
// whole import.
//
// Uploaded objects are never deleted by the app: a workbook copied for a
// session shares the same path, exactly as quiz pictures do.
export async function uploadImportedImages(parsed) {
  const byKey = new Map((parsed.images || []).map(i => [i.key, i]));
  const used = new Set();
  for (const s of parsed.sections) {
    for (const b of s.blocks) {
      if (b.block_type === 'prose') {
        for (const m of (b.config?.html || '').matchAll(/data-wb-pending="([^"]+)"/g)) used.add(m[1]);
      } else if (b.block_type === 'table') {
        for (const row of b.config?.rows || []) for (const cell of row) {
          if (cell?.kind === 'image') (cell.images || []).forEach(k => used.add(k));
        }
      }
    }
  }

  const folder = `imports/${crypto.randomUUID()}`;
  const paths = new Map();
  let skipped = 0;
  for (const key of used) {
    const img = byKey.get(key);
    if (!img) { skipped += 1; continue; }
    const file = new File([img.bytes], key, { type: img.contentType });
    const prepared = await prepareQuizImage(file);
    if (prepared.error) { skipped += 1; continue; }
    const { blob, contentType, ext } = prepared.data;
    const path = `${folder}/${key}.${ext}`;
    const { error } = await supabase.storage
      .from(WORKBOOK_IMAGE_BUCKET)
      .upload(path, blob, { contentType, upsert: false });
    if (error) throw new Error(`Uploading a picture failed: ${error.message}`);
    paths.set(key, path);
  }

  const sections = parsed.sections.map(s => ({
    ...s,
    blocks: s.blocks.flatMap((b) => {
      if (b.block_type === 'prose') {
        let html = (b.config?.html || '').replace(/<img\b[^>]*data-wb-pending="([^"]+)"[^>]*>/g, (tag, key) => (
          paths.has(key) ? tag.replace(`data-wb-pending="${key}"`, `data-wb-image="${paths.get(key)}"`) : ''
        ));
        // A paragraph that held only a picture that could not be kept is
        // now empty; drop the block rather than import a blank one.
        if (!html.replace(/<[^>]+>/g, '').trim() && !html.includes('data-wb-image')) return [];
        return [{ ...b, config: { ...b.config, html } }];
      }
      if (b.block_type === 'table') {
        const rows = (b.config?.rows || []).map(row => row.map((cell) => {
          if (cell?.kind !== 'image') return cell;
          const images = (cell.images || []).filter(k => paths.has(k)).map(k => paths.get(k));
          if (images.length) return { ...cell, images };
          // Nothing kept: fall back to the cell's wording, as before.
          const { images: _drop, kind: _k, ...rest } = cell;
          return { ...rest, kind: 'static', text: cell.text || '' };
        }));
        return [{ ...b, config: { ...b.config, rows } }];
      }
      return [b];
    }),
  }));

  const { images: _images, ...rest } = parsed;
  return { parsed: { ...rest, sections }, uploaded: paths.size, skipped };
}
