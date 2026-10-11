import { useEffect, useState } from 'react';

// The one save chip every editor shows, driven by useSaveTracker.
//
// Three states, in order of what matters most:
//   failed  — "Couldn't save the title · Retry" (or · Reload when the save
//             cannot be replayed). Announced as an alert: work is not safe.
//   saving  — "Saving…"
//   saved   — "✓ Saved · 2 min ago", once anything has saved this visit.
// Nothing at all before the first save: "Saved" on a page nobody has touched
// would be a claim about work that was never done.
//
// `onReload` is offered on a failure that cannot be retried (a move made
// against an order that may since have changed).
export default function SaveStatus({ tracker, onReload, className = '' }) {
  const { pending, failures, savedAt } = tracker;
  const now = useNow(savedAt ? 30_000 : null);

  if (failures.length > 0) {
    const f = failures[failures.length - 1];
    const more = failures.length - 1;
    return (
      <span className={`save-status is-failed ${className}`} role="alert" data-tip={f.message}>
        Couldn't save {f.label}{more > 0 ? ` (+${more} more)` : ''}
        {f.retry ? (
          <button type="button" className="save-status-action" onClick={f.retry}>Retry</button>
        ) : onReload ? (
          <button type="button" className="save-status-action" onClick={onReload}>Reload</button>
        ) : null}
      </span>
    );
  }

  return (
    <span className={`save-status ${pending ? 'is-saving' : savedAt ? 'is-saved' : 'is-idle'} ${className}`} role="status" aria-live="polite">
      {pending ? 'Saving…' : savedAt ? `✓ Saved · ${ago(now - savedAt)}` : ''}
    </span>
  );
}

function ago(ms) {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} h ago`;
}

// Re-renders every `interval` ms so "2 min ago" keeps up; null stops it.
function useNow(interval) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!interval) return undefined;
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}
