// Settings → Branding: the app's colours, published by a super admin and
// applied on every page.
//
// HOW A PALETTE REACHES THE SCREEN
// 1. index.html runs a tiny script before the app loads. It applies the
//    palette this browser last saw (localStorage), or the one being tried in
//    this tab (sessionStorage), so the old colours never flash.
// 2. On start, loadPublishedPalette() reads the newest published row and
//    applies and remembers it, so the next visit starts right.
// The palette is set as inline custom properties on <html>, which beat the
// defaults in index.css. Every stylesheet reads those properties (the X7
// groundwork), so nothing else needs to know.
//
// Keep KEYS and the cache keys in step with index.html's inline script.
import { supabase } from './supabase.js';

export const KEYS = ['midnight', 'midnight-hover', 'gold', 'gold-dark', 'qasr', 'bg', 'card', 'text', 'muted', 'border'];

// Today's palette (index.css). "Reset to the default colours" publishes this.
export const DEFAULTS = {
  midnight: '#1e3c5a', 'midnight-hover': '#162d45', gold: '#b5985a', 'gold-dark': '#8b7342', qasr: '#c9bea6',
  bg: '#f8f7f4', card: '#ffffff', text: '#1a1a1a', muted: '#8a8a8a', border: '#e5e2dc',
};

export const CACHE_KEY = 'brand-palette-v1';   // localStorage: last published
export const TRY_KEY = 'brand-try-v1';         // sessionStorage: being tried in this tab

export const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

// Only known keys with valid codes; anything else falls back to the default.
export function cleanPalette(p) {
  const out = {};
  for (const k of KEYS) out[k] = isHex(p?.[k]) ? p[k].toLowerCase() : DEFAULTS[k];
  return out;
}

export function applyPalette(p) {
  const root = document.documentElement;
  const clean = cleanPalette(p);
  for (const k of KEYS) root.style.setProperty(`--${k}`, clean[k]);
}

function read(store, key) {
  try { const v = store.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function write(store, key, value) {
  try { if (value) store.setItem(key, JSON.stringify(value)); else store.removeItem(key); } catch { /* private mode: fine */ }
}

export const tryingPalette = () => read(sessionStorage, TRY_KEY);

// "Try it just for me": this tab only, until stopped or the tab closes.
export function startTrying(p) {
  write(sessionStorage, TRY_KEY, cleanPalette(p));
  applyPalette(p);
  window.dispatchEvent(new Event('brand-try-change'));
}
export function stopTrying() {
  write(sessionStorage, TRY_KEY, null);
  applyPalette(read(localStorage, CACHE_KEY) || DEFAULTS);
  window.dispatchEvent(new Event('brand-try-change'));
}

// Newest published row, or null when nothing is published yet.
//   -> { row, missing } — missing: the SQL has not been applied yet.
export async function fetchPublished() {
  const { data, error } = await supabase
    .from('app_branding')
    .select('id, palette, published_by_name, published_at')
    .order('published_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (error) {
    const missing = ['42P01', 'PGRST205'].includes(error.code) || /does not exist|could not find the table/i.test(error.message);
    return { row: null, missing, error: missing ? null : error };
  }
  return { row: data?.[0] || null, missing: false };
}

// App start: apply what is published (unless this tab is trying something)
// and remember it for the next page load.
export async function loadPublishedPalette() {
  const { row } = await fetchPublished();
  const palette = row ? cleanPalette(row.palette) : null;
  write(localStorage, CACHE_KEY, palette);
  if (!tryingPalette()) applyPalette(palette || DEFAULTS);
  return palette;
}

// After a publish: this browser shows it straight away.
export function adoptPublished(palette) {
  write(localStorage, CACHE_KEY, cleanPalette(palette));
  write(sessionStorage, TRY_KEY, null);
  applyPalette(palette);
  window.dispatchEvent(new Event('brand-try-change'));
}

// ── colour maths for the Branding tab ──
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const toHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// The hovered main colour, when the admin lets it be worked out: today's pair
// (#1e3c5a → #162d45) is about a quarter darker.
export const darker = (h, f = 0.25) => toHex(rgb(h).map(v => v * (1 - f)));

function luminance(h) {
  const c = rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
// WCAG contrast ratio, 1 to 21.
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// The pairs that carry words. `fix` names the colour to change if it fails.
// Quiet text is held to 3:1 (secondary text), the rest to 4.5:1.
export const READABILITY = [
  { fg: '#ffffff', bg: 'midnight', what: 'White words on the main colour', where: 'Buttons, sidebar, top bar', fix: 'midnight' },
  { fg: 'text', bg: 'bg', what: 'Text on the page background', where: 'Every page', fix: 'text' },
  { fg: 'text', bg: 'card', what: 'Text on cards', where: 'Tiles, panels, the report', fix: 'text' },
  { fg: 'midnight', bg: 'card', what: 'Headings on cards', where: 'Names, numbers, titles', fix: 'midnight' },
  { fg: 'gold-dark', bg: 'card', what: 'Accent words on cards', where: 'Links, gold labels', fix: 'gold-dark' },
  { fg: 'muted', bg: 'card', what: 'Quiet text on cards', where: 'Hints and dates', fix: 'muted', min: 3 },
];
export function readability(p) {
  const v = k => (k.startsWith('#') ? k : p[k]);
  return READABILITY.map(c => {
    const ratio = contrast(v(c.fg), v(c.bg));
    return { ...c, ratio, pass: ratio >= (c.min || 4.5), fgHex: v(c.fg), bgHex: v(c.bg) };
  });
}
