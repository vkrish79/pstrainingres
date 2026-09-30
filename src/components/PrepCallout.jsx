// The purple prep box shown on an exercise — on the participant's workbook and
// assessment, and wherever a trainer sees a participant's exercise.
//
// `items` is calloutItems() from lib/prepAttach.js: the exercise's own value
// followed by any general prep shown with it. One value prints exactly as the
// box always did (heading + value). Two or more print one row each, named by
// their column, so a PNR and an EMD number can be told apart.
//
// Uses the existing .participant-prep-callout styles (dashboard.css).
export default function PrepCallout({ items, heading = 'Pre-work from your trainer' }) {
  if (!items?.length) return null;
  const labelled = items.length > 1;
  return (
    <div className="participant-prep-callout">
      <span className="participant-prep-callout-label">{heading}</span>
      {labelled ? (
        <div className="participant-prep-callout-lines">
          {items.map((it, i) => (
            <div className="participant-prep-callout-line" key={`${it.label || ''}-${i}`}>
              <span className="participant-prep-callout-key">{it.label || 'Prep'}</span>
              <span className="participant-prep-callout-value">{it.content}</span>
            </div>
          ))}
        </div>
      ) : items[0].content}
    </div>
  );
}
