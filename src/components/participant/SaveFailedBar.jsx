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
// `sentNotice`: how many waiting answers just went through (useQueuedSaves),
//           shown briefly as "✓ All sent" once nothing is waiting.
//
// A retryable answer is not lost: it is kept on this laptop (lib/answerQueue.js)
// and sent by itself when the connection is back, even after a reload. So it
// reads as WAITING, in amber, and tells the participant to keep working. Only a
// refused answer, which will be refused every time, reads as failed.
const WHY = {
  offline: "The connection dropped. They're kept on this laptop and will send by themselves when it's back, so keep working.",
  slow: "The server is slow to answer. They're kept on this laptop and will keep trying by themselves, so keep working.",
  other: "Something went wrong sending them. They're kept on this laptop and will keep trying by themselves.",
};
const REFUSED = {
  workbook: "It wasn't accepted — this session may have been closed for answers. Tell your trainer.",
  assessment: "It wasn't accepted — the assessment may have closed or been locked. Tell your trainer.",
};

export default function SaveFailedBar({ failures, blocks, sections, onRetry, where = 'workbook', nameOf = null, sentNotice = 0 }) {
  const ids = Object.keys(failures || {});
  if (ids.length === 0) {
    if (!sentNotice) return null;
    return (
      <div className="save-failed-bar is-sent" role="status">
        <span className="sfb-head">✓ {sentNotice === 1 ? 'Your answer was sent.' : `All ${sentNotice} answers sent.`}</span>
      </div>
    );
  }

  // Name the exercise the most recent failure sits in.
  const first = failures[ids[ids.length - 1]];
  const lastId = ids[ids.length - 1];
  const block = blocks.find(b => b.id === lastId);
  const title = nameOf ? nameOf(lastId) : sections.find(s => s.id === block?.section_id)?.title;
  const where_ = title ? ` in ${nameOf ? title : `"${title}"`}` : '';
  const waiting = ids.filter(id => failures[id].retry).length;
  const allRefused = waiting === 0;

  const head = allRefused
    ? (ids.length === 1 ? `Your last answer${where_} didn't save.` : `${ids.length} answers didn't save.`)
    : (waiting === 1 ? `Your answer${where_} is waiting to send.` : `${waiting} answers are waiting to send.`);
  const why = allRefused ? REFUSED[where] : WHY[first.kind === 'refused' ? 'other' : first.kind];

  return (
    <div className={`save-failed-bar${allRefused ? '' : ' is-waiting'}`} role="alert">
      <span className="sfb-head">{head}</span>
      <span className="sfb-why">{why}</span>
      {!allRefused && (
        <button type="button" className="sfb-retry" onClick={onRetry}>Send now</button>
      )}
    </div>
  );
}
