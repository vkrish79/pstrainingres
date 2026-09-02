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
const EMPTY_EXPECTED = { sectionIds: new Set(), labels: [] };

export default function PrepDrawer({ open, onClose, sections, prep, standalone = [], expected = EMPTY_EXPECTED, className = '' }) {
  const expectedSections = expected?.sectionIds || EMPTY_EXPECTED.sectionIds;
  const expectedLabels = expected?.labels || EMPTY_EXPECTED.labels;

  const contentFor = s => (prep[s.id]?.content || '').trim();
  // Anything with a value, plus anything the template expects — in workbook order.
  const rows = sections.filter(s => contentFor(s) || expectedSections.has(s.id));

  // Standalone: the items that exist, then template labels still unfilled.
  const haveLabels = new Set(standalone.map(s => s.label));
  const missingLabels = expectedLabels.filter(l => !haveLabels.has(l));
  const standaloneRows = [
    ...standalone.map(s => ({ key: s.id ?? s.label, label: s.label, content: s.content })),
    ...missingLabels.map(l => ({ key: `missing-${l}`, label: l, content: '' })),
  ];

  const hasAny = rows.length > 0 || standaloneRows.length > 0;

  return (
    <aside
      className={`prep-drawer ${className} ${open ? 'open' : ''}`}
      role="dialog"
      aria-label="Your prep"
      aria-hidden={!open}
    >
      <header className="prep-drawer-head">
        <span className="prep-drawer-head-label">Prep</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close prep">×</button>
      </header>
      <div className="prep-drawer-body">
        {!hasAny ? (
          <p className="prep-modal-empty">No prep has been assigned to you yet.</p>
        ) : (
          <div className="prep-modal-list">
            {rows.map(s => {
              const content = contentFor(s);
              return (
                <div key={s.id} className={`prep-modal-item ${content ? '' : 'prep-modal-item--pending'}`}>
                  <h4>{s.title}</h4>
                  {content ? (
                    <div className="prep-modal-content">{content}</div>
                  ) : (
                    <div className="prep-modal-pending">Not assigned yet</div>
                  )}
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
