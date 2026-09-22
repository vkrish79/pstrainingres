import {
  addCriterion, criteriaTotal, normaliseGuidance, removeCriterion, updateCriterion,
} from '../../lib/markingCriteria.js';

// The criteria a manual question is marked against, authored with the question.
//
// A real marking scheme is a list, not a single number: the ARDW score card
// breaks "create the booking" into nine criteria worth 25 between them, with
// notes like "1 for each name" and "0.5 for each meal". Writing that down here
// is what lets the instructor mark criterion by criterion instead of inventing
// a total in their head.
//
// The criteria ARE what the question is worth — `points` is written from their
// sum whenever they change, so there is no total to keep in step by hand and no
// way for the two to drift apart. That is why there is no marks box on this
// panel: the sum is shown, not edited.
//
// There is deliberately no way to write a deduction rule. The instructor gives
// each criterion all of its marks, none of them, or a typed figure — which can
// already express every "deduct N" and "deduct all of it" in a paper scheme,
// with the comment carrying the reason.
export default function MarkingCriteriaEditor({ guidance, onChange }) {
  const g = normaliseGuidance(guidance);
  const total = criteriaTotal(g);
  const hasAny = g.criteria.length > 0;

  // Most manual questions will never have criteria, and an assessment can carry
  // thirty of them. So the empty state is one line with no box around it —
  // repeated down a long panel, anything more reads as noise rather than an
  // invitation.
  if (!hasAny) {
    return (
      <div className="mc-editor is-empty">
        <button type="button" className="ghost" onClick={() => onChange(addCriterion(g))}>
          + Add marking criteria
        </button>
        <span className="mc-hint">or leave it and mark this question as a whole</span>
      </div>
    );
  }

  // No title bar, no column headings, no separate total row: with thirty manual
  // questions in a paper, every row this costs is paid thirty times. The
  // placeholders name the columns and the total sits on the button row.
  return (
    <div className="mc-editor">
      {(
        <div className="mc-table-wrap">
          <table className="mc-table">
            <tbody>
              {g.criteria.map(c => (
                <tr key={c.id}>
                  <td>
                    <input
                      type="text"
                      className="form-input"
                      value={c.label}
                      placeholder="e.g. Name"
                      aria-label="Criterion name"
                      onChange={e => onChange(updateCriterion(g, c.id, { label: e.target.value }))}
                    />
                  </td>
                  <td className="mc-r">
                    <input
                      type="number"
                      className="form-input mc-marks"
                      min="0"
                      step="0.5"
                      value={c.marks}
                      aria-label={`Marks for ${c.label || 'this criterion'}`}
                      onChange={e => onChange(updateCriterion(g, c.id, { marks: e.target.value }))}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-input"
                      value={c.note}
                      placeholder="optional — e.g. 1 for each name"
                      aria-label={`Note for ${c.label || 'this criterion'}`}
                      onChange={e => onChange(updateCriterion(g, c.id, { note: e.target.value }))}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="mc-remove"
                      title={`Remove ${c.label || 'this criterion'}`}
                      onClick={() => onChange(removeCriterion(g, c.id))}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mc-actions">
        <button type="button" className="ghost" onClick={() => onChange(addCriterion(g))}>
          + Add a criterion
        </button>
        <span className="mc-total" title="What this question is worth — it follows the criteria">
          {total} mark{total === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}
