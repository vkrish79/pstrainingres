// A streak, drawn rather than spelled out. "2 in a row" was a pill of small
// text competing with the name beside it; a flame is read at a glance from the
// back of a room, which is the only place this screen is ever looked at from.
//
// An SVG and not the 🔥 emoji: the emoji is a different picture on every
// platform, cannot take the colour of a streak getting hotter, and is rendered
// by the font at whatever weight the font feels like.
//
// The number stays. A flame alone says "on a run" but not how long a run, and
// the difference between two and six is the whole interest of it.
const TIERS = [
  { from: 6, name: 'hot' },    // red-hot
  { from: 4, name: 'warm' },   // orange
  { from: 2, name: 'lit' },    // amber — a streak starts at two
];

export default function QuizFlame({ streak }) {
  const tier = TIERS.find(t => streak >= t.from)?.name ?? 'lit';
  return (
    <span
      className={`qflame t-${tier}`}
      title={`${streak} correct in a row`}
      aria-label={`${streak} correct in a row`}
    >
      <svg className="qflame-svg" viewBox="0 0 24 26" aria-hidden="true" focusable="false">
        <path className="qflame-outer" d="M12 1C12 1 5 8.6 5 15.2 5 19.5 8.1 23 12 23s7-3.5 7-7.8C19 8.6 12 1 12 1z" />
        <path className="qflame-inner" d="M12 10.6c0 0-3.1 3.5-3.1 6.3C8.9 19 10.3 21 12 21s3.1-2 3.1-4.1C15.1 14.1 12 10.6 12 10.6z" />
      </svg>
      <span className="qflame-n">{streak}</span>
    </span>
  );
}
