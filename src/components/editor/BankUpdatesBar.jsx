import { useState } from 'react';
import { useBusyOverlay } from '../../contexts/BusyOverlayContext.jsx';

// "The bank has changed these questions." Offered, never applied on its own.
//
// Modelled on the criteria-push bar in AssessmentAnswerKeyPanel, because it is
// the same kind of statement: something upstream moved, here is what it would
// touch, you decide. A silent auto-update would rewrite a paper somebody is
// about to schedule.
//
// It refreshes the TEMPLATE. Sessions already scheduled hold their own deep copy
// and are untouched — that is the existing snapshot model, and the bar says so
// rather than letting anyone infer otherwise.
export default function BankUpdatesBar({ stale, orphaned, onResync }) {
  const { run: runBusy } = useBusyOverlay();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);

  if (stale.length === 0 && orphaned.length === 0) return null;

  async function apply(ids) {
    setBusy(true); setError(''); setNotice('');
    const { data, error: e } = await runBusy(
      `Refreshing ${ids.length} question${ids.length === 1 ? '' : 's'} from the bank…`,
      () => onResync(ids),
    );
    setBusy(false);
    if (e) { setError(e.message); return; }
    setNotice(`Refreshed ${data} question${data === 1 ? '' : 's'} from the bank.`);
  }

  return (
    <section className="editor-card bank-updates">
      {stale.length > 0 && (
        <div className="bank-updates-head">
          <span className="bank-updates-dot" aria-hidden />
          <strong>
            {stale.length} question{stale.length === 1 ? '' : 's'} changed in the question bank
          </strong>
          <button
            type="button"
            className="ghost"
            onClick={() => setOpen(o => !o)}
          >
            {open ? 'Hide' : 'Which?'}
          </button>
          <button
            type="button"
            disabled={busy}
            data-tip="Replaces the wording, the answer key and the marking scheme of these questions with the bank's current version"
            onClick={() => apply(stale.map(s => s.section_id))}
          >
            {busy ? 'Refreshing…' : 'Take the bank’s version'}
          </button>
        </div>
      )}

      {open && stale.length > 0 && (
        <ul className="bank-updates-list">
          {stale.map(s => (
            <li key={s.section_id}>
              <span>{s.section_title}</span>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => apply([s.section_id])}
              >
                Refresh this one
              </button>
            </li>
          ))}
        </ul>
      )}

      {stale.length > 0 && (
        <p className="hint">
          This updates this assessment only. Sessions already scheduled keep the copy they were
          given — that has always been true of a scheduled paper, and is why editing one mid-course
          cannot surprise a room.
        </p>
      )}

      {orphaned.length > 0 && (
        <p className="hint">
          {orphaned.length} question{orphaned.length === 1 ? ' is' : 's are'} no longer linked to the
          bank — the bank version was deleted. {orphaned.length === 1 ? 'It' : 'They'} still work
          here and can be edited normally; there is just nothing left to refresh from.
        </p>
      )}

      {notice && <p className="prep-notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
