import { useState } from 'react';

// Withdraw a question, with a reason that cannot be skipped.
//
// Inline rather than a browser dialog — this project never uses window.confirm
// or prompt. The reason box opens in place, Withdraw stays disabled until
// something is typed, and Escape backs out.
//
// The reason is not decoration: it goes into the question's config, which means
// it travels through the content-change log and lands in Session changes with
// the withdrawal itself. Someone reading the log a month later gets the why,
// not just the what.
export default function WithdrawQuestion({ withdrawn, withdrawal, busy, error, onWithdraw, onRestore }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');

  const canSubmit = reason.trim().length > 0 && !busy;

  function cancel() {
    setAsking(false);
    setReason('');
  }

  async function submit() {
    if (!canSubmit) return;
    const res = await onWithdraw(reason.trim());
    if (!res?.error) cancel();
  }

  if (withdrawn) {
    return (
      <div className="withdraw-state">
        <span className="withdraw-badge">Withdrawn</span>
        {withdrawal?.reason && (
          <span className="withdraw-reason" title="Why this question was withdrawn">
            “{withdrawal.reason}”
          </span>
        )}
        {withdrawal?.by && <span className="withdraw-by">— {withdrawal.by}</span>}
        <button className="ghost" disabled={busy} onClick={onRestore}>
          {busy ? 'Working…' : 'Put back'}
        </button>
        {error && <span className="error withdraw-error">{error}</span>}
      </div>
    );
  }

  if (!asking) {
    return (
      <button
        className="ghost danger withdraw-open"
        onClick={() => setAsking(true)}
        title="Take this question out of play — participants stop seeing it and it stops counting"
      >
        Withdraw
      </button>
    );
  }

  return (
    <div className="withdraw-ask">
      <label className="withdraw-label" htmlFor="withdraw-reason">
        Why is this question being withdrawn? <span className="withdraw-required">required</span>
      </label>
      <div className="withdraw-ask-row">
        <input
          id="withdraw-reason"
          className="form-input"
          autoFocus
          value={reason}
          placeholder="e.g. the scenario doesn't match this cohort's fleet"
          onChange={e => setReason(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') cancel();
          }}
        />
        <button disabled={!canSubmit} onClick={submit}>
          {busy ? 'Withdrawing…' : 'Withdraw'}
        </button>
        <button className="ghost" disabled={busy} onClick={cancel}>Cancel</button>
      </div>
      <p className="withdraw-hint">
        Participants stop seeing this question and it leaves the marks total on both sides,
        so nobody is penalised. Answers already given are kept. This is recorded in
        Session changes with your reason.
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
