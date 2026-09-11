import { supabase } from './supabase.js';

export const QUIZ_IMAGE_BUCKET = 'quiz-images';

// The longest edge we keep. A projector is 1920 wide and the picture never
// occupies all of it, so anything above this is detail nobody in the room can
// see — paid for in the one place it hurts, the gap between a question opening
// and the picture arriving on the wall.
const MAX_EDGE = 1600;

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// Two hours. The obvious ten minutes — what program-materials uses for a PDF
// someone clicks once — expires in the middle of a quiz, and the failure is
// silent: a broken image on the wall at question nine.
const SIGNED_TTL_SECONDS = 60 * 120;

// Re-signing on every render would be a network round trip per repaint, and
// the projector repaints five times a second while a question is open.
const urlCache = new Map();       // path -> { url, expiresAt }

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
    img.src = url;
  });
}

function toBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

// Shrink and re-encode before upload. Trainers paste screenshots straight off
// a phone, and a 4MB PNG is both slower to send and slower to arrive on the
// projector than the 150KB WebP that looks identical at viewing distance.
//
// An ANIMATED gif is passed through untouched — a canvas would flatten it to
// its first frame, and silently turning someone's animation into a still is
// worse than uploading a slightly large file.
export async function prepareQuizImage(file) {
  if (!file) return { error: new Error('Pick a picture first.') };
  if (!ACCEPTED.includes(file.type)) {
    return { error: new Error('Pictures must be PNG, JPEG, WebP or GIF.') };
  }
  if (file.type === 'image/gif') {
    if (file.size > 8 * 1024 * 1024) return { error: new Error('That GIF is over 8MB — too big to upload.') };
    return { data: { blob: file, contentType: 'image/gif', ext: 'gif' } };
  }

  let img;
  try { img = await loadImage(file); } catch (e) { return { error: e }; }

  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  // WebP first: a GDS screenshot is mostly flat colour and small text, which
  // is exactly where JPEG's ringing shows and WebP's does not. JPEG is the
  // fallback for a browser that cannot encode WebP — toBlob hands back null
  // rather than throwing when it does not know the type.
  let blob = await toBlob(canvas, 'image/webp', 0.9);
  let contentType = 'image/webp';
  let ext = 'webp';
  if (!blob) {
    blob = await toBlob(canvas, 'image/jpeg', 0.88);
    contentType = 'image/jpeg';
    ext = 'jpg';
  }
  if (!blob) return { error: new Error('That picture could not be prepared for upload.') };

  return { data: { blob, contentType, ext } };
}

export async function signedQuizImageUrl(path) {
  if (!path) return { data: null };
  const hit = urlCache.get(path);
  if (hit && hit.expiresAt > Date.now()) return { data: hit.url };

  const { data, error } = await supabase.storage
    .from(QUIZ_IMAGE_BUCKET)
    .createSignedUrl(path, SIGNED_TTL_SECONDS);
  if (error) return { error: new Error(error.message) };

  urlCache.set(path, {
    url: data.signedUrl,
    // Re-sign well before the real expiry, so a URL is never handed out with
    // seconds left on it.
    expiresAt: Date.now() + SIGNED_TTL_SECONDS * 1000 * 0.8,
  });
  return { data: data.signedUrl };
}

// Cache hygiene when a question stops pointing at a path. Every upload gets
// its own timestamped path, so a replacement can never collide with a cached
// URL — this is for the entry left behind, not for correctness.
export function forgetQuizImageUrl(path) {
  if (path) urlCache.delete(path);
}
