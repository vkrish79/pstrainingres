// The four answer identities.
//
// A SHAPE, not a letter. In a room the trainer says "hit the triangle" and it
// works across the projector and every handset — where "hit B" needs everyone
// to have the same mental order, and a participant scanning four boxes for a
// small letter is slower than one spotting a shape.
//
// Shape and colour together, never colour alone: roughly one man in twelve
// cannot separate the red from the green, and on a projector at the back of a
// room the colours drift anyway.
//
// The order is fixed and shared by every surface — editor, projector and
// handset all index into this list, so slot 0 is the triangle everywhere. If
// they ever disagreed, a trainer would be pointing at one shape while the room
// pressed another.
export const QUIZ_SHAPES = [
  { key: 'triangle', label: 'Triangle', points: '12,3 22,20 2,20' },
  { key: 'diamond', label: 'Diamond', points: '12,2 22,12 12,22 2,12' },
  { key: 'circle', label: 'Circle', circle: true },
  { key: 'square', label: 'Square', points: '3,3 21,3 21,21 3,21' },
];

// Never an index out of range: a question with more slots than shapes would
// otherwise render nothing at all rather than something imperfect.
export function shapeFor(i) {
  return QUIZ_SHAPES[i] ?? QUIZ_SHAPES[QUIZ_SHAPES.length - 1];
}
