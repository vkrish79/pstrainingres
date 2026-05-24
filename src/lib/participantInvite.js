// Share artifacts handed to newly-enrolled participants:
//   - buildInviteText / buildAllInvitesText: plain text to paste into whatever
//     channel the trainer already uses with the cohort (WhatsApp / Teams / email).
//     Most participants are username-only (synthesized per-session email), so a
//     pasteable message — not an email feature — is the primary channel.
//   - buildHandoutHtml: a self-contained, brand-styled HTML document for a new
//     window, so it prints as a polished per-participant slip independent of the
//     app's workbook-oriented print stylesheet.
//
// Temp passwords are one-use: the server sets must_change_password, so the very
// first sign-in forces a reset. That's why it's fine to surface them in a copied
// message, a printed slip, or to reprint via the dashboard reset flow.

export function formatDateRange(starts, ends) {
  if (!starts && !ends) return '';
  const fmt = (s) => (s
    ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : '');
  if (starts && ends) return `${fmt(starts)} – ${fmt(ends)}`;
  return fmt(starts || ends);
}

// A successfully-onboarded row that's worth handing credentials for.
export function isShareable(row) {
  return row?.status === 'created' || row?.status === 'enrolled_existing';
}

// One participant's invite as plain text. `created` rows carry a fresh temp
// password; `enrolled_existing` rows reuse the account's existing password.
export function buildInviteText(row, ctx) {
  const name = (row.full_name || '').trim();
  const lines = [];
  lines.push(name ? `Hi ${name},` : 'Hi,');
  lines.push(`You're enrolled in "${ctx.sessionName}"${ctx.dateRange ? ` (${ctx.dateRange})` : ''}.`);
  lines.push('');
  lines.push('To join the training workbook:');
  lines.push(`  1. Open: ${ctx.joinUrl}`);
  lines.push(`  2. Username: ${row.username}`);
  if (row.temp_password) {
    lines.push(`  3. Temporary password: ${row.temp_password}`);
    lines.push('');
    lines.push("You'll be asked to set your own password on first sign-in.");
  } else {
    lines.push('  3. Password: use your existing password.');
  }
  return lines.join('\n');
}

export function buildAllInvitesText(rows, ctx) {
  return rows.map((r) => buildInviteText(r, ctx)).join('\n\n———\n\n');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const HANDOUT_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #1e3c5a; background: #f4f2ee; padding: 18px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .toolbar {
    position: sticky; top: 0; z-index: 1;
    display: flex; align-items: center; gap: 14px;
    padding: 11px 14px; margin: 0 auto 18px; max-width: 720px;
    background: #fff; border: 1px solid #e5e2dc; border-radius: 9px;
    font-size: 13px; color: #6b6b6b; box-shadow: 0 2px 8px rgba(30,60,90,0.06);
  }
  .toolbar button {
    font: inherit; font-weight: 600; cursor: pointer; color: #fff;
    background: #1e3c5a; border: none; padding: 8px 18px; border-radius: 6px;
  }
  .toolbar button:hover { background: #162d45; }
  .card {
    position: relative; overflow: hidden; background: #fff;
    border: 1px solid #e5e2dc; border-radius: 16px;
    margin: 0 auto 18px; max-width: 720px;
    box-shadow: 0 8px 24px rgba(30,60,90,0.08);
    page-break-inside: avoid; break-inside: avoid;
  }
  .card-head {
    display: flex; justify-content: space-between; align-items: center; gap: 16px;
    padding: 20px 26px; color: #fff;
    background: linear-gradient(135deg, #1e3c5a 0%, #2a4d6e 100%);
    border-bottom: 3px solid #b5985a;
  }
  .brand { display: flex; align-items: center; gap: 11px; }
  .brand-mark {
    width: 40px; height: 40px; border-radius: 9px; background: #b5985a;
    color: #fff; font-weight: 800; font-size: 16px; letter-spacing: 0.5px;
    display: inline-flex; align-items: center; justify-content: center; flex: none;
  }
  .brand-text { display: flex; flex-direction: column; line-height: 1.15; }
  .brand-text b { font-size: 15px; }
  .brand-text small { font-size: 10px; text-transform: uppercase; letter-spacing: 0.09em; opacity: 0.82; }
  .sess { text-align: right; min-width: 0; }
  .sess-name { font-weight: 700; font-size: 15px; }
  .sess-dates { font-size: 12px; opacity: 0.85; margin-top: 2px; }
  .card-body { padding: 24px 26px 6px; }
  .greet { font-size: 17px; margin-bottom: 18px; }
  .greet b { font-weight: 700; }
  .steps { display: flex; flex-direction: column; gap: 16px; }
  .step { display: flex; gap: 15px; align-items: flex-start; }
  .num {
    flex: none; width: 27px; height: 27px; border-radius: 50%;
    background: #faf6ec; border: 1px solid #e0d4b3; color: #8b7342;
    font-weight: 700; font-size: 13px; margin-top: 1px;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .cred-label {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em;
    color: #9a958c; font-weight: 700; margin-bottom: 4px;
  }
  .cred-link {
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 14px; color: #1e3c5a; word-break: break-all;
  }
  .cred-user {
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 17px; font-weight: 600; color: #1e3c5a;
  }
  .cred-pass {
    display: inline-block;
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 23px; font-weight: 700; letter-spacing: 1.5px; color: #1e3c5a;
    background: #faf6ec; border: 1.5px dashed #d8c79b; border-radius: 9px;
    padding: 7px 16px; margin-top: 2px;
  }
  .cred-pass.small { font-size: 15px; font-weight: 600; letter-spacing: 0; }
  .cred-note { font-size: 12px; color: #6b6b6b; margin-top: 7px; }
  .card-foot {
    margin-top: 16px; padding: 13px 26px; border-top: 1px solid #f0ede7;
    font-size: 11px; color: #9a958c; display: flex; gap: 6px; align-items: center;
  }
  .card-foot .lock { color: #b5985a; }
  @media print {
    body { background: #fff; padding: 0; }
    .no-print { display: none !important; }
    .card {
      box-shadow: none; border-color: #d8d4cc; max-width: none;
      margin: 0 0 14px; border-radius: 12px;
    }
    @page { margin: 14mm; }
  }
`;

function handoutCard(row, ctx) {
  const name = escapeHtml((row.full_name || '').trim() || row.username);
  const passBlock = row.temp_password
    ? `<div class="cred-label">Temporary password</div>
         <div class="cred-pass">${escapeHtml(row.temp_password)}</div>
         <div class="cred-note">You'll set your own password on first sign-in.</div>`
    : `<div class="cred-label">Password</div>
         <div class="cred-pass small">Use your existing password</div>`;
  return `
    <section class="card">
      <header class="card-head">
        <div class="brand">
          <span class="brand-mark">PS</span>
          <span class="brand-text"><b>pstrainingres</b><small>Training resources</small></span>
        </div>
        <div class="sess">
          <div class="sess-name">${escapeHtml(ctx.sessionName)}</div>
          ${ctx.dateRange ? `<div class="sess-dates">${escapeHtml(ctx.dateRange)}</div>` : ''}
        </div>
      </header>
      <div class="card-body">
        <div class="greet">Welcome, <b>${name}</b></div>
        <div class="steps">
          <div class="step"><span class="num">1</span><div><div class="cred-label">Open this link</div><div class="cred-link">${escapeHtml(ctx.joinUrl)}</div></div></div>
          <div class="step"><span class="num">2</span><div><div class="cred-label">Username</div><div class="cred-user">${escapeHtml(row.username)}</div></div></div>
          <div class="step"><span class="num">3</span><div>${passBlock}</div></div>
        </div>
      </div>
      <footer class="card-foot"><span class="lock">🔒</span> Keep this slip private — it's your personal access to the training workbook.</footer>
    </section>`;
}

// Self-contained HTML document for a print window. Auto-opens the print dialog
// on load; a manual Print button is the fallback if that's suppressed.
export function buildHandoutHtml(rows, ctx) {
  const cards = rows.map((r) => handoutCard(r, ctx)).join('\n');
  const count = rows.length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Participant handouts — ${escapeHtml(ctx.sessionName)}</title>
<style>${HANDOUT_CSS}</style>
</head>
<body>
<div class="toolbar no-print">
  <button type="button" onclick="window.print()">🖨 Print</button>
  <span>${count} handout${count === 1 ? '' : 's'} — print or "Save as PDF" from the dialog.</span>
</div>
${cards}
<script>window.addEventListener('load', function () { setTimeout(function () { try { window.print(); } catch (e) {} }, 350); });</script>
</body>
</html>`;
}
