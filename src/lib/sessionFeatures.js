// What a class uses. Each session keeps the features switched OFF in
// sessions.features_off; NULL or an empty list means everything on, which is
// every session made before this existed.
//
// "Off" hides a feature on screen. Nothing already collected is deleted, so
// switching it back on brings everything back.
//
// `needs` — switched off with the workbook, because it sits on exercises.
// `room`  — one of the in-class interactions ("Untick all room interactions").
export const FEATURES = [
  { key: 'workbook', group: 'work', name: 'Workbook exercises' },
  { key: 'prep', group: 'work', name: 'Prep drawer', needs: 'workbook' },
  { key: 'materials', group: 'work', name: 'Materials' },
  { key: 'assessment', group: 'work', name: 'Assessment' },
  { key: 'quiz', group: 'room', name: 'Live quiz' },
  { key: 'polls', group: 'room', name: 'Live polls' },
  { key: 'review', group: 'room', name: 'Go over answers', needs: 'workbook' },
  { key: 'spotlight', group: 'room', name: 'Spotlight', needs: 'workbook' },
  { key: 'hand', group: 'room', name: 'Raise hand' },
  { key: 'confidence', group: 'room', name: 'Confidence tap', needs: 'workbook' },
  { key: 'pulse', group: 'room', name: 'End-of-day pulse' },
  { key: 'amadeus', group: 'room', name: 'Amadeus screen share' },
];

export const FEATURE_BY_KEY = Object.fromEntries(FEATURES.map(f => [f.key, f]));

// Is this feature on, given the stored off-list? A feature that needs the
// workbook is off whenever the workbook is.
export function featureOn(off, key) {
  const list = off || [];
  if (list.includes(key)) return false;
  const needs = FEATURE_BY_KEY[key]?.needs;
  return needs ? !list.includes(needs) : true;
}

// One object of booleans, so a component reads `on.quiz` rather than calling
// featureOn everywhere.
export function featureFlags(off) {
  return Object.fromEntries(FEATURES.map(f => [f.key, featureOn(off, f.key)]));
}

// The names of what is off, for the closed report's one line and the
// drawer's summary. A feature that is off only because the workbook is says so.
export function offNames(off) {
  const list = off || [];
  return FEATURES
    .filter(f => !featureOn(list, f.key))
    .map(f => (!list.includes(f.key) && f.needs ? `${f.name} (needs workbook)` : f.name));
}
