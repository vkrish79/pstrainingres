// A medal on a ribbon, standing on the plinth where the bare numeral used to.
//
// Drawn in the dark navy of the background rather than in gold, silver and
// bronze. That looks backwards written down, and is the only thing that works:
// the plinth underneath is ALREADY the metal, so a gold medal on a gold step
// is a medal nobody can see. The metal moves to the rim and the numeral, which
// is where it reads — a dark disc with a bright edge, which is what a medal
// photographed against a bright background actually looks like.
const DISC = '#16304d';

export default function QuizMedal({ place }) {
  return (
    <svg
      className={`qmedal m${place}`}
      viewBox="0 0 48 64"
      role="img"
      aria-label={`Place ${place}`}
    >
      {/* Two tails, at slightly different weights, so the ribbon has a front
          and a back rather than reading as a flat V. */}
      <path d="M14 1 L23 1 L27 27 L18 29 Z" fill={DISC} opacity="0.92" />
      <path d="M34 1 L25 1 L21 27 L30 29 Z" fill={DISC} opacity="0.72" />
      <circle cx="24" cy="43" r="17" fill={DISC} />
      <circle cx="24" cy="43" r="17" fill="none" strokeWidth="3" className="qmedal-rim" />
      <text
        x="24"
        y="43"
        textAnchor="middle"
        dominantBaseline="central"
        className="qmedal-num"
      >
        {place}
      </text>
    </svg>
  );
}
