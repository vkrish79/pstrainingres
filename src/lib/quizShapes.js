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
// THE FIRST FOUR ARE LOAD-BEARING AND MUST NOT MOVE. A quiz has four answers
// and indexes straight into this list, so reordering these would change what a
// shipped quiz shows the room.
//
// Slots 4 and 5 exist for POLLS, which take up to six answers. They are here
// rather than in a poll-only list so that slot 0 is the triangle in both
// features — a trainer saying "hit the triangle" must be right whatever is on
// the wall. Nothing maps over this array to decide how many slots to render;
// every consumer calls shapeFor(index) with an index it already has, so a quiz
// never sees these two.
//
// SIX IS THE CEILING, and the limit is the room rather than the code. Star and
// plus are instantly nameable and hold their shape at the back of a hall. The
// next ones along — pentagon, hexagon — are neither, and a trainer cannot say
// "hit the hexagon" to sixteen people and be understood.
export const QUIZ_SHAPES = [
  { key: 'triangle', label: 'Triangle', points: '12,3 22,20 2,20' },
  { key: 'diamond', label: 'Diamond', points: '12,2 22,12 12,22 2,12' },
  { key: 'circle', label: 'Circle', circle: true },
  { key: 'square', label: 'Square', points: '3,3 21,3 21,21 3,21' },
  { key: 'star', label: 'Star',
    points: '12,2 14.47,8.6 21.51,8.91 15.99,13.3 17.88,20.09 12,16.2 6.12,20.09 8.01,13.3 2.49,8.91 9.53,8.6' },
  { key: 'plus', label: 'Plus',
    points: '8.5,3 15.5,3 15.5,8.5 21,8.5 21,15.5 15.5,15.5 15.5,21 8.5,21 8.5,15.5 3,15.5 3,8.5 8.5,8.5' },
];

// Never an index out of range: a question with more slots than shapes would
// otherwise render nothing at all rather than something imperfect.
export function shapeFor(i) {
  return QUIZ_SHAPES[i] ?? QUIZ_SHAPES[QUIZ_SHAPES.length - 1];
}
