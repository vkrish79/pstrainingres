// "Marked Trainee 4 as helped · Undo" — one per hand marked helped in the last
// few seconds (useHelpRequests holds the call back so Undo can cancel it).
// Bottom centre of the window, clear of the sidebar and the cockpit rail.
export default function HelpedToasts({ pending, participants, onUndo }) {
  if (!pending.length) return null;
  return (
    <div className="helped-toasts" role="status" aria-live="polite">
      {pending.map(r => {
        const name = participants.find(p => p.id === r.participant_id)?.full_name || 'Someone';
        return (
          <div key={r.id} className="helped-toast">
            <span>Marked <strong>{name}</strong> as helped</span>
            <button type="button" className="helped-toast-undo" onClick={() => onUndo(r.id)}>Undo</button>
          </div>
        );
      })}
    </div>
  );
}
