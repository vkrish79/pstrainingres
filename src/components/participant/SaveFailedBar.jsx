// The participant's "your answer did not save" message, shared by the
// workbook and the assessment so the two cannot word it differently.
//
// Sits inside the page's sticky bar (actions bar / exam bar) as a full-width
// row, so it stays in view however far down the page the participant is.
//
// failures: { [blockId]: { kind, retry } } from useWorkbook /
//           useParticipantAssessment (see lib/saveErrors.js for the kinds).
// `where`:  'workbook' | 'assessment' — only changes the refused wording.
// `nameOf`: blockId → what the participant calls the place it sits in. The
//           default is the section title, which is right for a workbook; an
//           assessment numbers its questions on screen and passes its own.
const WHY = {
  offline: "The connection dropped. Your answer is still on this screen.",
  slow: "The server took too long to answer. Your answer is still on this screen.",
  other: "Something went wrong saving it. Your answer is still on this screen.",
};
const REFUSED = {
  workbook: "It wasn't accepted — this session may have been closed for answers. Tell your trainer.",
  assessment: "It wasn't accepted — the assessment may have closed or been locked. Tell your trainer.",
};

export default function SaveFailedBar({ failures, blocks, sections, onRetry, where = 'workbook', nameOf = null }) {
  const ids = Object.keys(failures || {});
  if (ids.length === 0) return null;

  // Name the exercise the most recent failure sits in.
  const first = failures[ids[ids.length - 1]];
  const lastId = ids[ids.length - 1];
  const block = blocks.find(b => b.id === lastId);
  const title = nameOf ? nameOf(lastId) : sections.find(s => s.id === block?.section_id)?.title;
  const anyRetry = ids.some(id => failures[id].retry);
  const allRefused = ids.every(id => failures[id].kind === 'refused');

  const head = ids.length === 1
    ? `Your last answer${title ? ` in ${nameOf ? title : `"${title}"`}` : ''} didn't save.`
    : `${ids.length} answers didn't save.`;
  const why = allRefused ? REFUSED[where] : WHY[first.kind === 'refused' ? 'other' : first.kind];

  return (
    <div className="save-failed-bar" role="alert">
      <span className="sfb-head">{head}</span>
      <span className="sfb-why">{why}</span>
      {anyRetry && (
        <button type="button" className="sfb-retry" onClick={onRetry}>Try again</button>
      )}
    </div>
  );
}
