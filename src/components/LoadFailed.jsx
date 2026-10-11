// The one card a page shows when reading its data failed.
//
// WHY A CARD AND NOT AN EMPTY LIST. A hook that swallows its error hands the
// page an empty array, and the page then says "No workbooks yet." — which is a
// claim about the trainer's library, made on the strength of a dropped
// connection. This says what actually happened, that nothing was changed, and
// offers the one thing worth doing about it.
//
// `what` finishes the sentence "Couldn't load …" ("your workbooks", "this
// pool"). `error` is the raw Supabase error or message, shown small and muted:
// useless to most trainers, but it is what anyone diagnosing it asks for first.
export default function LoadFailed({ what, error, onRetry }) {
  const detail = typeof error === 'string' ? error : error?.message;
  return (
    <div className="load-failed" role="alert">
      <p className="load-failed-title">Couldn't load {what}</p>
      <p className="load-failed-body">
        Reading them failed, usually because the connection dropped. Nothing was changed.
      </p>
      {detail && <p className="load-failed-detail">{detail}</p>}
      {onRetry && (
        <button type="button" className="load-failed-retry" onClick={onRetry}>Retry</button>
      )}
    </div>
  );
}
