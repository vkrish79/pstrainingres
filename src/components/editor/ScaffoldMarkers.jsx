import { heatLevel } from '../../lib/configDiff.js';
import { PREP_REVEAL_EVENT } from '../../lib/prepTemplateEdit.js';

// The two markers ContentEditorScaffold puts on headings and rows. Moved out of
// the scaffold, unchanged.

// A heat marker. Intensity comes from DISTINCT SESSIONS still awaiting a
// decision, not the raw edit count — one trainer fiddling with a paragraph is
// noise; five cohorts independently rewording the same line is the signal.
//
// Once everything is resolved the marker goes quiet but does NOT disappear:
// it becomes a tick that still opens the history. Removing it entirely would
// make the record unreachable the moment you finished reviewing it.
export function HeatChip({ entry, onClick, extraClass = '' }) {
  if (!entry) return null;
  const openCount = entry.openSessions || 0;
  const total = entry.totalSessions || 0;
  if (!openCount && !total) return null;

  const cls = extraClass ? ` ${extraClass}` : '';
  if (!openCount) {
    return (
      <button
        type="button"
        className={`heat-chip heat-chip--done${cls}`}
        onClick={onClick}
        aria-label={`Reviewed — show the ${total} recorded session change${total === 1 ? '' : 's'}`}
      >
        ✓
      </button>
    );
  }

  const label =
    `${openCount} session${openCount === 1 ? '' : 's'} reworded this`
    + ` (${entry.openTrainers} trainer${entry.openTrainers === 1 ? '' : 's'}) — review the changes`;
  return (
    <button
      type="button"
      className={`heat-chip heat-l${heatLevel(openCount)}${cls}`}
      onClick={onClick}
      aria-label={label}
    >
      <span className="heat-dot" aria-hidden />
      {openCount}
    </button>
  );
}

// The prep marker on a heading. It says this exercise depends on prep — which
// nothing on the exercise used to — and it is a way back to the one place that
// is set. The Prep template card may be collapsed, so rather than look for the
// tile here, ask the card to open and show it.
export function PrepChip({ sectionId }) {
  const jump = () => {
    window.dispatchEvent(new CustomEvent(PREP_REVEAL_EVENT, { detail: { sectionId } }));
  };
  return (
    <button
      type="button"
      className="prep-chip"
      onClick={jump}
      data-tip="Set in the Prep template card — click to go to it"
    >
      <span className="prep-chip-dot" aria-hidden />
      Needs prep
    </button>
  );
}
