// The Print invites flow under the participants header: confirm, progress,
// and done (print again / copy all). `invites` is useSessionInvites().
export default function InvitesBanner({ invites, participantCount }) {
  const {
    invitesPhase, setInvitesPhase, invitesProgress, invitesRows, setInvitesRows,
    invitesError, setInvitesError, invitesCopied, openHandoutWindow, resetAllAndPrintInvites, copyAllInvites,
  } = invites;
  return (
    <>
      {invitesPhase === 'confirm' && (
        <div className="invite-banner warn">
          <span>
            Reset <strong>all {participantCount}</strong> participants' passwords and open fresh
            printable handouts? This invalidates any password you've already shared.
          </span>
          <div className="invite-banner-actions">
            <button className="danger" onClick={resetAllAndPrintInvites}>Reset all &amp; print</button>
            <button className="ghost" onClick={() => setInvitesPhase('idle')}>Cancel</button>
          </div>
        </div>
      )}
      {invitesPhase === 'running' && (
        <p className="prep-notice">Resetting passwords… {invitesProgress.done}/{invitesProgress.total}</p>
      )}
      {invitesPhase === 'done' && (
        <div className="invite-banner">
          <span>
            {invitesRows.length > 0
              ? `Reset ${invitesRows.length} password${invitesRows.length === 1 ? '' : 's'} and opened the printable handouts.`
              : 'No handouts were generated.'}
          </span>
          <div className="invite-banner-actions">
            {invitesRows.length > 0 && (
              <>
                <button className="ghost" onClick={() => openHandoutWindow(invitesRows)}><span className="btn-glyph" aria-hidden>⎙</span> Print again</button>
                <button className="ghost" onClick={copyAllInvites}>{invitesCopied ? 'Copied!' : <><span className="btn-glyph" aria-hidden>⧉</span> Copy all invites</>}</button>
              </>
            )}
            <button className="ghost" onClick={() => { setInvitesPhase('idle'); setInvitesRows([]); setInvitesError(''); }}>Dismiss</button>
          </div>
        </div>
      )}
      {invitesError && <p className="error">{invitesError}</p>}
    </>
  );
}
