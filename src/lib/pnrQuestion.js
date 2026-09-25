// PNR build / modification questions.
//
// These are the practical scenarios an Amadeus certification paper is made of:
// "create this PNR with these optional elements", "divide it and reissue". The
// candidate does the work in Amadeus; the examiner marks what they produced
// against a written scheme.
//
// A PNR question is NOT a new block type. It is the manual question the app
// already has — block_type 'field', input_type 'long_text', marking_mode
// 'manual', key NULL, guidance holding the criteria — carrying one extra object
// in its config:
//
//   config.pnr = { scenario, sector_rbd_original, sector_rbd_new,
//                  passengers, macro, prep_needed }
//
// Those six fields are the ARDW score card's STRUCTURE sheet, which is how this
// kind of exam is actually specified: the scenario in prose, then the sectors and
// booking classes before and after, who is travelling, any macro, and whether the
// question needs a PNR prepared in advance.
//
// Keeping it a `field` rather than inventing block_type='pnr' is what makes the
// whole feature cheap, and it is worth spelling out why, because "add a new type"
// is the obvious move and it is the expensive one:
//
//   • isManuallyMarkable is literally isFillableBlock, and `field` already
//     passes — so a PNR question is markable by hand for free.
//   • isScorableBlock already excludes long_text, so it is correctly kept out of
//     auto-marking with no edit.
//   • expectedInputs returns 1 for `field` already. A new block type would have
//     returned 0 and silently dropped out of the progress maths.
//   • Block.jsx already routes `field` to FieldBlock; close-session already
//     snapshots block_type and config wholesale, so config.pnr survives a close.
//   • The shipped rubric editor and marking list already treat it as manual.
//
// A new block type would have needed a widened SQL CHECK and a case adding to
// eight separate hand-maintained type lists, every one of them a place to be
// forgotten.

import { round1 } from './markingCriteria.js';

// The ARDW score card's own wording for question 1 — "PNR creation with optional
// elements" — nine criteria summing to 25. Seeded when a PNR question is created
// so the trainer starts from a real scheme and edits it, rather than from an
// empty table. Every field is editable afterwards; nothing here is fixed.
export const ARDW_STARTER_CRITERIA = [
  { id: 'c1', label: 'Name', marks: 4, note: '1 for each name' },
  { id: 'c2', label: 'Itinerary', marks: 2, note: '1 for each segment' },
  { id: 'c3', label: 'Contact', marks: 2, note: '1 for each contact — automatic notification must be selected' },
  { id: 'c4', label: 'Email', marks: 1, note: '' },
  { id: 'c5', label: 'Meals', marks: 2, note: '0.5 for each meal — name and segment select' },
  { id: 'c6', label: 'Remarks', marks: 1, note: 'Historical remark as required by the scenario' },
  { id: 'c7', label: 'Baggage', marks: 2, note: '' },
  { id: 'c8', label: 'Theory question', marks: 7, note: '1 mark for each question' },
  { id: 'c9', label: 'Ticket issuance', marks: 4, note: '1 mark for each ticket with the correct form of payment' },
];

export const PNR_FIELDS = [
  { key: 'scenario', label: 'Scenario', placeholder: 'PNR creation with optional elements' },
  { key: 'sector_rbd_original', label: 'Sector / RBD (original)', placeholder: 'AUH-LHR-AUH (M)' },
  { key: 'sector_rbd_new', label: 'Sector / RBD (new)', placeholder: 'AUH-LHR//MAN-AUH (H/D)' },
  { key: 'passengers', label: 'Passengers', placeholder: '2A 1C 1Inf' },
  { key: 'macro', label: 'Macro', placeholder: 'Optional' },
];

export function emptyPnrScenario() {
  return {
    scenario: '',
    sector_rbd_original: '',
    sector_rbd_new: '',
    passengers: '',
    macro: '',
    prep_needed: false,
  };
}

// A PNR question is a long-text field carrying a `pnr` object. Checked by shape
// rather than by a stored flag so it cannot disagree with what is actually there:
// strip config.pnr and it stops being one, which is the correct behaviour.
export function isPnrQuestion(block) {
  return !!block
    && block.block_type === 'field'
    && block.config?.input_type === 'long_text'
    && !!block.config?.pnr
    && typeof block.config.pnr === 'object'
    && !Array.isArray(block.config.pnr);
}

// jsonb holds whatever was written into it, including by an older build. Read
// defensively and hand back all six fields so nothing downstream has to check
// again. Mirrors normaliseGuidance's approach for the same reason.
export function normalisePnr(pnr) {
  const p = pnr && typeof pnr === 'object' && !Array.isArray(pnr) ? pnr : {};
  const text = (v) => (typeof v === 'string' ? v : '');
  return {
    scenario: text(p.scenario),
    sector_rbd_original: text(p.sector_rbd_original),
    sector_rbd_new: text(p.sector_rbd_new),
    passengers: text(p.passengers),
    macro: text(p.macro),
    prep_needed: p.prep_needed === true,
  };
}

// The scenario lines worth showing, in blueprint order, skipping the empties —
// most questions leave "new" and "macro" blank, and printing "Macro: —" on every
// one of them is noise on a page a candidate is being timed against.
export function pnrSummaryRows(pnr) {
  const p = normalisePnr(pnr);
  return PNR_FIELDS
    .filter(f => f.key !== 'scenario' && p[f.key].trim() !== '')
    .map(f => ({ key: f.key, label: f.label, value: p[f.key].trim() }));
}

// The config for a newly created PNR question.
export function newPnrConfig() {
  return {
    label: '',
    input_type: 'long_text',
    pnr: emptyPnrScenario(),
  };
}

export function starterGuidance() {
  return { criteria: ARDW_STARTER_CRITERIA.map(c => ({ ...c })) };
}

export function starterCriteriaTotal() {
  return round1(ARDW_STARTER_CRITERIA.reduce((s, c) => s + c.marks, 0));
}
