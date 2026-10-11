// The "are you sure?" for a Settings table row, asked in the page, directly
// under the row it is about. It replaces the browser's own confirm() box,
// which looked like another app and froze the tab while it was up (live
// polling, idle sign-out timers and realtime all stop behind it).
//
// The button says what it does ("Reset password", "Delete vendor"), never
// "OK". `colSpan` is the table's column count, so the strip spans the row.
export default function ConfirmRow({ colSpan, message, confirmLabel, onConfirm, onCancel, busy = false }) {
  return (
    <tr className="settings-confirm-row">
      <td colSpan={colSpan}>
        <div className="settings-confirm" role="group" aria-label="Confirm">
          <span className="settings-confirm-text">{message}</span>
          <span className="settings-confirm-actions">
            <button type="button" className="settings-confirm-go" onClick={onConfirm} disabled={busy}>
              {busy ? 'Working…' : confirmLabel}
            </button>
            <button type="button" className="settings-confirm-keep" onClick={onCancel} disabled={busy}>Keep</button>
          </span>
        </div>
      </td>
    </tr>
  );
}
