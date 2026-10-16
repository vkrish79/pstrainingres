// The app's palette, read from the page rather than typed in.
//
// Stylesheets use var(--midnight) and friends directly. This is for the few
// places that need an actual colour value instead: chart libraries that write
// SVG attributes (where var() does not work) and colour scales worked out in
// JavaScript. Reading the live value means they follow Settings → Branding
// like everything else.
//
// `fallback` is today's default, used before the stylesheet is there (tests,
// or a very early render).
export function paletteColour(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}
