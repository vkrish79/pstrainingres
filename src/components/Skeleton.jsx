// Skeletons: the shape of what is coming, shimmering, instead of the words
// "Loading workbook…".
//
// Same idea as MLH's shared skeleton.css — one `.skel-bone` shimmer, and small
// components that arrange bones into the shape of the page about to appear.
// Kept to four shapes on purpose: a skeleton that is a pixel-perfect twin of
// its page is a second copy of that page to maintain, and it stops being
// accurate the first time either one changes.
//
// Every one of them is aria-hidden with a polite "Loading…" for screen
// readers: a wall of decorative boxes is noise to anyone not looking at it.

function Bone({ w, h = 12, r = 4, style }) {
  return <span className="skel-bone" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

function Frame({ label = 'Loading…', className = '', children }) {
  return (
    <div className="skel" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className={className} aria-hidden="true">{children}</div>
    </div>
  );
}

// Stacked lines, for inside a card. Widths vary so it reads as text, not bars.
function Lines({ rows }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <Bone key={i} w={`${[92, 78, 85, 64, 73][i % 5]}%`} style={{ marginBottom: 10 }} />
      ))}
    </>
  );
}
export function SkeletonLines({ rows = 3, label }) {
  return <Frame label={label} className="skel-lines"><Lines rows={rows} /></Frame>;
}

// Rows of a managed list or a roster.
function Table({ rows, cols }) {
  return (
    <>
      <div className="skel-row skel-row-head">
        {Array.from({ length: cols }, (_, c) => <Bone key={c} w={c === 1 ? '40%' : '14%'} h={10} />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="skel-row">
          {Array.from({ length: cols }, (_, c) => (
            <Bone key={c} w={c === 1 ? `${55 + ((r * 7) % 30)}%` : '14%'} h={12} />
          ))}
        </div>
      ))}
    </>
  );
}
export function SkeletonTable({ rows = 5, cols = 4, label }) {
  return <Frame label={label} className="skel-table"><Table rows={rows} cols={cols} /></Frame>;
}

// The card grid the session, workbook, quiz and program lists all land in.
function Cards({ count }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skel-card">
          <Bone w={`${60 + ((i * 11) % 30)}%`} h={15} />
          <Bone w="45%" h={11} style={{ marginTop: 10 }} />
          <Bone w="30%" h={10} style={{ marginTop: 8 }} />
        </div>
      ))}
    </>
  );
}
export function SkeletonCards({ count = 6, label }) {
  return <Frame label={label} className="skel-cards"><Cards count={count} /></Frame>;
}

// A whole page: the hero, then whatever the page is made of. `body` takes any
// of the shapes above — default is cards.
export function SkeletonPage({ body = 'cards', rows = 5, label = 'Loading…' }) {
  return (
    <main className="page">
      <Frame label={label} className="skel-page">
        <div className="skel-hero">
          <Bone w={170} h={22} r={6} />
          <Bone w={260} h={12} style={{ marginTop: 12 }} />
        </div>
        {body === 'cards' && <div className="skel-cards"><Cards count={rows} /></div>}
        {body === 'table' && <div className="skel-table"><Table rows={rows} cols={4} /></div>}
        {body === 'lines' && <div className="skel-lines"><Lines rows={rows} /></div>}
      </Frame>
    </main>
  );
}
