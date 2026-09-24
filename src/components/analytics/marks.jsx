// Small shared marks for the Analytics page: a percentage ring and a
// completion sparkline. Both are hand-drawn SVG rather than recharts — they
// are single values, not plots, and recharts brings a whole chart frame.

const MIDNIGHT = '#1e3c5a';
const CRIT = '#c2503c';

// A ring reads a percentage at a glance; a bar of one value does not.
export function Ring({ value, size = 46, label }) {
  const r = (size - 7) / 2;
  const c = 2 * Math.PI * r;
  const has = value != null;
  const stroke = has && value < 50 ? CRIT : MIDNIGHT;
  return (
    <svg
      className="an-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      role="img" aria-label={label || (has ? `${Math.round(value)}%` : 'no figure')}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--an-track)" strokeWidth="5" />
      {has && (
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={stroke} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${c * Math.max(0.001, value / 100)} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      <text x="50%" y="50%" dy=".35em" textAnchor="middle" className={size < 40 ? 'an-ring-t sm' : 'an-ring-t'}>
        {has ? `${Math.round(value)}%` : '—'}
      </text>
    </svg>
  );
}

// Completion session by session, oldest first. A 50% guide line gives the
// wiggle a meaning; without it a sparkline is decoration.
export function Spark({ values, width = 160, height = 30 }) {
  const v = values.filter(x => x != null);
  if (v.length < 2) return <span className="an-muted-sm">Too few sessions for a trend</span>;
  const x = i => 3 + (i * (width - 6)) / (v.length - 1);
  const y = a => height - 4 - (a / 100) * (height - 8);
  const d = v.map((a, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(a).toFixed(1)}`).join('');
  return (
    <svg className="an-spark" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2={width} y1={y(50)} y2={y(50)} stroke="#f0d6cf" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <path d={`${d}L${x(v.length - 1)} ${height}L3 ${height}Z`} fill="rgba(30,60,90,.07)" />
      <path d={d} fill="none" stroke={MIDNIGHT} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export const pctText = v => (v == null ? '—' : `${Math.round(v)}%`);
