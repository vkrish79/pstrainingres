import { useEffect, useState } from 'react';
import { splitGeneralPrep } from '../../lib/prepAttach.js';
import '../../styles/prep.css';

// Narrow right slide-in drawer showing all of a participant's prep: exercise-
// linked prep grouped by exercise, plus standalone "General / pre-work" items.
// PUSHES the page canvas (no overlay/backdrop) — the parent toggles a body
// class for that. Closes via the × button or Esc (handled by the parent).
// `prep` is keyed by section_id -> { content }; `standalone` is [{ label, content }].
//
// `expected` ({ sectionIds: Set, labels: [] }) is what the workbook's prep template
// says SHOULD have prep. Those entries are listed even with no value yet, as a
// muted placeholder — prep is often stocked after a class is created, and without
// the placeholder an exercise still waiting for its PNR is indistinguishable from
// one that never needed prep. Empty `expected` (or a workbook with no template)
// falls back to listing only prep that exists.
const EMPTY_EXPECTED = { sectionIds: new Set(), labels: [], attached: {}, ownLabels: {} };

// How long the slide takes (must match `transition` in prep.css). Used to hold
// off hiding the drawer from the keyboard until it has finished sliding out —
// making it `inert` the moment `open` flips would take it out of the page
// mid-animation.
const SLIDE_MS = 300;

export default function PrepDrawer({ open, onClose, sections, prep, standalone = [], expected = EMPTY_EXPECTED, className = '' }) {
  const expectedSections = expected?.sectionIds || EMPTY_EXPECTED.sectionIds;
  const expectedLabels = expected?.labels || EMPTY_EXPECTED.labels;
  const attached = expected?.attached || EMPTY_EXPECTED.attached;
  const ownLabels = expected?.ownLabels || EMPTY_EXPECTED.ownLabels;

  const contentFor = s => (prep[s.id]?.content || '').trim();

  // Every general item, filled or still expected — then the ones the template
  // shows WITH an exercise are taken out of the general list and put on it.
  const haveLabels = new Set(standalone.map(s => s.label));
  const missingLabels = expectedLabels.filter(l => !haveLabels.has(l));
  const allGeneral = [
    ...standalone.map(s => ({ key: s.id ?? s.label, label: s.label, content: s.content })),
    ...missingLabels.map(l => ({ key: `missing-${l}`, label: l, content: '' })),
  ];
  const { bySection: withExercise, general: standaloneRows } = splitGeneralPrep(allGeneral, attached);

  // Anything with a value, anything the template expects, and any exercise with
  // general prep shown on it — in workbook order.
  const rows = sections.filter(s => contentFor(s) || expectedSections.has(s.id) || withExercise[s.id]?.length);
  // An exercise's values: its own (if it has one), then the attached ones.
  const valuesFor = s => [
    ...(contentFor(s) || expectedSections.has(s.id)
      ? [{ key: `own-${s.id}`, label: ownLabels[s.id] || null, content: contentFor(s) }]
      : []),
    ...(withExercise[s.id] || []),
  ];

  const hasAny = rows.length > 0 || standaloneRows.length > 0;

  // "4 of 5 ready" — how much of this participant's prep has actually arrived,
  // counted per VALUE: an exercise showing a PNR and an EMD number is two.
  // `total` counts the placeholders too, which is the whole point: an exercise
  // still waiting for its PNR should be visibly outstanding, not absent.
  const filled = v => !!String(v?.content ?? '').trim();
  const rowValues = rows.flatMap(valuesFor);
  const total = rowValues.length + standaloneRows.length;
  const ready = rowValues.filter(filled).length + standaloneRows.filter(filled).length;
  const pct = total ? Math.round((ready / total) * 100) : 0;

  // Keyboard-hide only once the slide-out has finished. Gating this on `open`
  // alone pulls the drawer out of the page while it is still on screen.
  const [settledClosed, setSettledClosed] = useState(!open);
  useEffect(() => {
    if (open) { setSettledClosed(false); return undefined; }
    const t = setTimeout(() => setSettledClosed(true), SLIDE_MS + 40);
    return () => clearTimeout(t);
  }, [open]);

  return (
    <aside
      className={`prep-drawer ${className} ${open ? 'open' : ''}`}
      role="dialog"
      aria-label="Your prep"
      aria-hidden={settledClosed}
      inert={settledClosed}
    >
      {/* Takes the exercise rail's header shape — label, count, bar — so the two
          headers are the same height and the first prep row lines up with the
          first exercise. Matching by construction, not by a padding that goes
          stale the next time the rail's header changes. */}
      <header className="prep-drawer-head">
        <div className="prep-drawer-head-cap">
          <span className="prep-drawer-head-label">Prep</span>
          {total > 0 && <span className="prep-drawer-head-count">{ready} of {total} ready</span>}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close prep">×</button>
        </div>
        <div className={`prep-drawer-head-bar${ready === total ? ' is-done' : ''}`}>
          <i style={{ width: `${pct}%` }} />
        </div>
      </header>
      <div className="prep-drawer-body">
        {!hasAny ? (
          <p className="prep-modal-empty">No prep has been assigned to you yet.</p>
        ) : (
          <div className="prep-modal-list">
            {rows.map(s => {
              const values = valuesFor(s);
              // One value: exactly as it always was. Two or more: each named by
              // its column, so a PNR and an EMD number can be told apart.
              const labelled = values.length > 1;
              const anyFilled = values.some(filled);
              return (
                <div key={s.id} className={`prep-modal-item ${anyFilled ? '' : 'prep-modal-item--pending'}`}>
                  <h4>{s.title}</h4>
                  {values.map(v => (
                    <div key={v.key} className="prep-modal-value">
                      {labelled && <span className="prep-modal-value-label">{v.label || 'Prep'}</span>}
                      {filled(v) ? (
                        <div className="prep-modal-content">{v.content}</div>
                      ) : (
                        <div className="prep-modal-pending">Not assigned yet</div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
            {standaloneRows.length > 0 && (
              <>
                <div className="prep-modal-group-label">General / pre-work</div>
                {standaloneRows.map(s => (
                  <div key={s.key} className={`prep-modal-item ${s.content ? '' : 'prep-modal-item--pending'}`}>
                    <h4>{s.label}</h4>
                    {s.content ? (
                      <div className="prep-modal-content">{s.content}</div>
                    ) : (
                      <div className="prep-modal-pending">Not assigned yet</div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
