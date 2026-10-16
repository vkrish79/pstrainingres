import { useState } from 'react';

// How many exercises show before "Show all".
const FOLDED = 4;

// "How it went": the confidence taps (Got it / Not sure / Lost) summed up in
// the cockpit rail, under Needs you. The last few exercises as bars, newest
// first ("Show all" for the rest of the day), then the people behind the red. Built from confidenceSummary(); the
// heat board's "How it went" row is still where the whole day is.
//
// summary — confidenceSummary() result, or null (nothing tapped: no card)
// onPick(pid) — select a person, as Needs you does
// onOpenBoard() — the heat board
// onSpotlight({sectionId, title}) — optional; offered when an exercise needs a recap
export default function ConfidenceCard({ summary, onPick, onOpenBoard, onSpotlight }) {
  const [showAll, setShowAll] = useState(false);
  if (!summary) return null;
  const { recent, struggling, latestLost, silent } = summary;
  const shown = showAll ? recent : recent.slice(0, FOLDED);
  const hidden = recent.length - FOLDED;
  const newest = recent[0];
  const recap = recent.find(e => e.recap);
  const notes = newest.notesList || [];

  const person = p => (
    <button key={p.id} type="button" className="conf-card-person" onClick={() => onPick(p.id)} data-tip={`Select ${p.name}`}>
      {p.name}
    </button>
  );
  const list = people => people.flatMap((p, i) => (i ? [', ', person(p)] : [person(p)]));

  return (
    <section className="cockpit-card conf-card" aria-labelledby="conf-card-title">
      <h3 className="cockpit-card-title" id="conf-card-title">How it went</h3>
      <ul className={`conf-card-rows${showAll ? ' is-all' : ''}`}>
        {shown.map(e => {
          const t = e.total || 1;
          return (
            <li key={e.section.id} className="conf-card-row">
              <span className="conf-card-ex" data-tip={e.section.title}>{shortTitle(e.section.title)}</span>
              <span
                className="conf-card-bar"
                role="img"
                aria-label={`${e.section.title}: ${e.got} got it, ${e.unsure} not sure, ${e.lost} lost`}
                data-tip={`${e.got} got it · ${e.unsure} not sure · ${e.lost} lost`}
              >
                <i className="is-got" style={{ width: `${(e.got / t) * 100}%` }} />
                <i className="is-unsure" style={{ width: `${(e.unsure / t) * 100}%` }} />
                <i className="is-lost" style={{ width: `${(e.lost / t) * 100}%` }} />
              </span>
              <span className="conf-card-n">
                {e.got}/{e.total}
                {e.recap && <span className="conf-card-flag">Recap</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <button type="button" className="conf-card-more" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
          {showAll ? 'Show fewer' : `Show all ${recent.length}`}
        </button>
      )}

      {struggling.length > 0 && (
        <p className="conf-card-line is-bad">{list(struggling)} said Lost twice running</p>
      )}
      {latestLost.length > 0 && (
        <p className="conf-card-line is-bad">{list(latestLost)} said Lost on {newest.section.title}</p>
      )}
      {struggling.length === 0 && latestLost.length === 0 && (
        <p className="conf-card-line">Nobody said Lost on {newest.section.title}.</p>
      )}
      {notes.length > 0 && (
        <p className="conf-card-line is-muted">
          Notes on {newest.section.title}: {notes.slice(0, 3).map(n => `“${n.text}”${n.n > 1 ? ` ×${n.n}` : ''}`).join(', ')}
        </p>
      )}
      {silent.length > 0 && (
        <p className="conf-card-line is-muted">
          No taps yet: {list(silent.slice(0, 3))}{silent.length > 3 ? ` +${silent.length - 3} more` : ''}
        </p>
      )}

      <div className="conf-card-actions">
        <button type="button" className="ghost btn-sm" onClick={onOpenBoard}>Open heat board</button>
        {recap && onSpotlight && (
          <button type="button" className="ghost btn-sm" onClick={() => onSpotlight({ sectionId: recap.section.id, title: recap.section.title })}>
            Spotlight {shortTitle(recap.section.title)}
          </button>
        )}
      </div>
    </section>
  );
}

// "Exercise 11" -> "Ex 11"; anything else is left alone and truncated by CSS.
function shortTitle(title = '') {
  return title.replace(/^exercise\s+/i, 'Ex ');
}
