// The Room tab's Table view. `participantActions(p)` renders a row's ⋯ and
// its confirms, shared with the Selected card.
export default function ParticipantsTable({
  participants, progressFor, presenceFor, selectedParticipantId, pickParticipant,
  reading, hands, prepEnabled, hasPrep, participantActions,
}) {
  return (
    <table className="participants-table">
      <thead>
        <tr><th>Name</th><th>Progress</th><th>On now</th><th>Last activity</th>{!reading && <th></th>}</tr>
      </thead>
      <tbody>
        {participants.map(p => {
          const { answered, total, lastTs } = progressFor(p.id);
          const pct = total ? Math.round((answered / total) * 100) : 0;
          const isSel = p.id === selectedParticipantId;
          const isDropout = !!p.deactivated_at;
          return (
            <tr key={p.id} className={`${isSel ? 'selected' : ''}${isDropout ? ' deactivated' : ''}`}
                onClick={() => pickParticipant(p.id)}>
              <td>
                {!p.deactivated_at && hands[p.id] && <span className="hand-tag" title="Asked for help">✋</span>}
                {p.full_name || '(unnamed)'}
                {isDropout && <span className="dropout-tag">Dropped out</span>}
                {!isDropout && prepEnabled && !hasPrep(p.id) && <span className="no-prep-tag" title="No prep allocated yet">No prep</span>}
                {isDropout && (
                  <div className="dropout-reason">
                    {p.deactivation_reason}
                    <span className="dropout-meta">
                      {' '}— {p.deactivated_by_name ? `${p.deactivated_by_name}, ` : ''}
                      {new Date(p.deactivated_at).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </td>
              <td>
                <div className="progress-cell">
                  <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                  <span className="progress-text">{answered} / {total}</span>
                </div>
              </td>
              <td>
                {(() => {
                  const { state, label } = presenceFor(p.id, lastTs);
                  return (
                    <span className={`presence ${state}`}>
                      <span className={`presence-dot ${state}`} />
                      <span className="presence-label">{label}</span>
                    </span>
                  );
                })()}
              </td>
              <td>{lastTs ? new Date(lastTs).toLocaleString() : '—'}</td>
              {!reading && (
              <td onClick={e => e.stopPropagation()} className="row-actions">
                {participantActions(p)}
              </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
