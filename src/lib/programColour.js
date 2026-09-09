// One colour per programme type, the same on every screen.
//
// Modelled on myLearning Hub's shared courseColour() — a fixed palette indexed
// by the thing's id, so a course is the same colour on the training plan grid
// and the trainer schedule. The point of putting it in one place is that the
// calendar bar, the list swatch and the card tag cannot disagree about what
// colour "Refresher" is; three views quietly using three palettes is worse
// than having no colour at all.
//
// Keyed on PROGRAMME TYPE rather than on the session or the programme.
// A trainer scanning a month is asking "what kind of thing is running", and
// the type is already selected, already shown on the card, and small enough a
// set that the colours stay distinguishable. Colouring per programme would
// give a hundred near-identical hues.

// Muted, low-chroma, and deliberately clear of the app's gold accent, which is
// doing structural work (rules, headings, the active pill). These have to sit
// under white text as a calendar bar and beside body text as a 3px swatch, so
// they are chosen dark enough for both.
export const PROGRAM_PALETTE = [
  '#2f6b8f', // blue
  '#7d5ba6', // violet
  '#2f7f63', // green
  '#a8683a', // amber-brown
  '#8a5b6e', // plum
  '#4a6b8a', // slate
];

// A session with no programme type still has to draw as something.
export const UNTYPED_COLOUR = '#6b7280';

// UUIDs, not integers, so MLH's `id % length` cannot be used directly.
// djb2 — small, stable, and good enough to spread a handful of ids across six
// buckets. It must be STABLE across reloads and machines: a colour that moved
// between sessions would be actively misleading.
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function programColour(programTypeId) {
  if (!programTypeId) return UNTYPED_COLOUR;
  return PROGRAM_PALETTE[hash(String(programTypeId)) % PROGRAM_PALETTE.length];
}

// The colour for a session row, from whatever the session query returned.
export function sessionColour(session) {
  return programColour(session?.program?.program_type?.id);
}
