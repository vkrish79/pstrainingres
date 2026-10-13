// One participant's marks on one question, part by part, with the question's
// total — what a marker reads before going through the parts.
//
// `tally` is questionTally() (lib/questionTally.js). Until every part has a
// mark the total says "so far": a half-marked question must read as
// unfinished, never as a low score. A part whose criteria are only partly
// judged shows how far it has got ("4 of 7").
//
// labelOf(blockId) → "1(a)"; anchorOf(blockId) → the element id of that part's
// answer, so a chip takes you to it.
export default function QuestionScoreStrip({ heading = null, tally, labelOf, anchorOf }) {
  function jump(blockId) {
    const el = document.getElementById(anchorOf(blockId));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <div className={`qss ${tally.complete ? 'is-final' : ''}`}>
      <div className="qss-top">
        {heading && <span className="qss-heading">{heading}</span>}
        <span className="qss-total num">
          {tally.soFar}
          <small>{tally.complete ? ` of ${tally.possible}` : ` so far, of ${tally.possible}`}</small>
        </span>
      </div>
      <div className="qss-chips">
        {tally.parts.map(p => (
          <button
            key={p.blockId}
            type="button"
            className={`qss-chip is-${p.chip}${p.auto ? ' is-auto' : ''}`}
            onClick={() => jump(p.blockId)}
            data-tip={p.auto ? 'Marked automatically' : p.chip === 'open' ? 'Still to mark' : 'Marked by hand'}
          >
            <span className="qss-chip-l">{labelOf(p.blockId)}</span>
            <b className="num">{p.chip === 'open' && !p.of ? '—' : Math.round(p.earned * 10) / 10}/{p.possible}</b>
            {p.chip === 'open' && p.of > 0 && <span className="qss-chip-sub">{p.done} of {p.of}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
