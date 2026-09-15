// How big a question's picture is drawn.
//
// THREE SIZES, NOT A SLIDER. A trainer sizing a picture is answering "does
// this need the room's attention or is it a reference?", which has about three
// honest answers — and a percentage would invite fiddling with a number whose
// effect they cannot see until the quiz is on a wall.
//
// The value is display only. Drop-pin coordinates are fractions of the
// picture, so they mean the same thing at every size; nothing here can move an
// answer.
// The sizes ENLARGE a picture as well as shrink it, which is the whole point —
// a 148px map asked for at medium used to draw at 148px in a box four times
// that tall. The cost of that is worth saying where the choice is made: a
// picture smaller than the size chosen is stretched, and stretching shows.
export const QUIZ_SCALES = [
  { key: 's', label: 'S', title: 'Small — a reference beside the question' },
  { key: 'm', label: 'M', title: 'Medium — the usual size' },
  { key: 'l', label: 'L', title: 'Large — the picture is the question. A small picture will look soft blown up this far; upload a bigger one if it does' },
];

// A class suffix rather than an inline height: the right size depends on WHERE
// the picture is (a wall, a phone, the editor), and only the stylesheet knows
// that. This says which of the three it is and nothing about how tall.
export function scaleClass(value) {
  const key = QUIZ_SCALES.some(s => s.key === value) ? value : 'm';
  return `is-${key}`;
}
