import { useMemo, useState } from 'react';
import { buildAllInvitesText, buildHandoutHtml, buildInviteText } from '../lib/participantInvite.js';
import { formatRange } from '../lib/sessionDates.js';

// The session's join link and participant invites: copy the link, reset
// everyone's password and print handouts, and one person's invite after a
// single reset (resetResult is the page's per-person reset state).
export function useSessionInvites({ session, participants, resetParticipantPassword, resetResult }) {
  const [joinCopied, setJoinCopied] = useState(false);
  // Bulk "reset all & print invites": regenerates every participant's password
  // and opens the printable handouts. Destructive (invalidates already-shared
  // passwords), so it's gated behind a confirm step.
  const [invitesPhase, setInvitesPhase] = useState('idle'); // idle | confirm | running | done
  const [invitesProgress, setInvitesProgress] = useState({ done: 0, total: 0 });
  const [invitesRows, setInvitesRows] = useState([]);
  const [invitesError, setInvitesError] = useState('');
  const [invitesCopied, setInvitesCopied] = useState(false);
  const [copiedRowInvite, setCopiedRowInvite] = useState(null); // participant id

  const joinUrl = session?.join_code
    ? `${window.location.origin}/join/${session.join_code}`
    : '';

  async function copyJoinUrl() {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setJoinCopied(true);
      setTimeout(() => setJoinCopied(false), 1500);
    } catch {
      // clipboard blocked — fall back to selecting the text
    }
  }

  // Shared context for the invite/handout builders.
  const inviteCtx = useMemo(() => ({
    sessionName: session?.name || 'the training session',
    joinUrl,
    dateRange: formatRange(session?.starts_at, session?.ends_at),
  }), [session?.name, session?.starts_at, session?.ends_at, joinUrl]);

  function openHandoutWindow(rows) {
    const win = window.open('', '_blank');
    if (!win) { setInvitesError('Pop-up blocked — allow pop-ups for this site to print handouts.'); return; }
    win.document.open();
    win.document.write(buildHandoutHtml(rows, inviteCtx));
    win.document.close();
  }

  // Reset every enrolled participant's password (one call each — the edge fn
  // returns username + full_name + the fresh temp password) and open the
  // printable handouts. Sequential to stay gentle on the auth admin API.
  async function resetAllAndPrintInvites() {
    if (participants.length === 0) return;
    setInvitesError('');
    setInvitesPhase('running');
    setInvitesProgress({ done: 0, total: participants.length });
    // Open the print window NOW, while still inside the click gesture — opening
    // it after the awaits below would be outside the gesture and pop-up blockers
    // would block it. We fill it in once the resets finish. If it's blocked
    // anyway, the "Print again" button (a fresh gesture) is the fallback.
    const win = window.open('', '_blank');
    if (win) {
      win.document.open();
      win.document.write('<!doctype html><meta charset="utf-8"><title>Preparing handouts…</title><body style="font-family:system-ui,sans-serif;color:#1e3c5a;padding:28px">Preparing handouts…</body>');
      win.document.close();
    }
    const rows = [];
    const failures = [];
    for (const p of participants) {
      const { data, error: err } = await resetParticipantPassword(p.id);
      if (err || !data?.temp_password) {
        failures.push(p.full_name || p.id);
      } else {
        rows.push({
          username: data.username,
          full_name: data.full_name || p.full_name || '',
          temp_password: data.temp_password,
          status: 'created',
        });
      }
      setInvitesProgress(prev => ({ ...prev, done: prev.done + 1 }));
    }
    setInvitesRows(rows);
    if (failures.length) {
      setInvitesError(`Couldn't reset ${failures.length} participant(s): ${failures.join(', ')}.`);
    }
    setInvitesPhase('done');
    if (rows.length > 0) {
      if (win) {
        win.document.open();
        win.document.write(buildHandoutHtml(rows, inviteCtx));
        win.document.close();
      } else {
        setInvitesError(prev => prev || 'Pop-up blocked — use "Print again" to open the handouts.');
      }
    } else if (win) {
      win.close();
    }
  }

  async function copyAllInvites() {
    try {
      await navigator.clipboard.writeText(buildAllInvitesText(invitesRows, inviteCtx));
      setInvitesCopied(true);
      setTimeout(() => setInvitesCopied(false), 1500);
    } catch { setInvitesError('Could not copy to the clipboard.'); }
  }

  // Build a single handout/invite row from a just-reset participant: the reset
  // result carries the fresh password + username; full_name comes from the row.
  function inviteRowFromReset(p) {
    const r = resetResult[p.id] || {};
    return { username: r.username, full_name: p.full_name || '', temp_password: r.temp_password, status: 'created' };
  }

  async function copyRowInvite(p) {
    try {
      await navigator.clipboard.writeText(buildInviteText(inviteRowFromReset(p), inviteCtx));
      setCopiedRowInvite(p.id);
      setTimeout(() => setCopiedRowInvite(c => (c === p.id ? null : c)), 1500);
    } catch { /* clipboard blocked — leave the visible password as fallback */ }
  }

  function printRowHandout(p) {
    openHandoutWindow([inviteRowFromReset(p)]);
  }

  return {
    joinUrl, joinCopied, copyJoinUrl,
    invitesPhase, setInvitesPhase, invitesProgress, invitesRows, setInvitesRows,
    invitesError, setInvitesError, invitesCopied, copiedRowInvite,
    openHandoutWindow, resetAllAndPrintInvites, copyAllInvites, copyRowInvite, printRowHandout,
  };
}
