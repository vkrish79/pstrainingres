import { useState } from 'react';
import { SkeletonTable } from '../Skeleton.jsx';
import { useRetention } from '../../hooks/useRetention.js';

// Settings → Data retention. How long closed-session detail is kept before the
// nightly job slims it. Modelled on MLH's admin retention screen.
//
// Each row saves on its own: each is a separate policy with its own floor, and
// a change to one must never ride along with an unrelated edit to another.
// Super admins edit; super trainers see the same table read-only.

function approx(days) {
  if (!Number.isFinite(days)) return '';
  if (days >= 365) {
    const y = days / 365;
    return `≈ ${Number.isInteger(y) ? y : y.toFixed(1)} year${y === 1 ? '' : 's'}`;
  }
  const m = Math.round(days / 30);
  return `≈ ${m} month${m === 1 ? '' : 's'}`;
}

function describeRun(run) {
  if (!run) return 'The job has not run yet.';
  const when = new Date(run.finished_at || run.started_at).toLocaleString('en-GB');
  if (run.status === 'failure') return `Last run ${when} — failed: ${run.error || 'unknown error'}`;
  if (run.status === 'running') return `Running since ${when}.`;
  const d = run.detail || {};
  const bits = [];
  const n = k => (d[k] && typeof d[k] === 'object' ? d[k].done : 0);
  if (n('closed_session_detail')) bits.push(`${n('closed_session_detail')} slimmed`);
  if (n('closed_session_copies')) bits.push(`${n('closed_session_copies')} copies removed`);
  if (n('analytics_names')) bits.push(`${n('analytics_names')} anonymised`);
  const failures = Array.isArray(d.failures) ? d.failures.length : 0;
  return `Last run ${when} — ${bits.length ? bits.join(', ') : 'nothing was due'}`
    + (failures ? ` · ${failures} session${failures === 1 ? '' : 's'} failed and will be retried` : '');
}

export default function RetentionSettings() {
  const { data, error, save } = useRetention();
  const [draft, setDraft] = useState({});        // { [policy_key]: { days, enabled } }
  const [saving, setSaving] = useState(null);
  const [rowMsg, setRowMsg] = useState({});      // { [policy_key]: { ok|error: text } }

  const canEdit = !!data?.can_edit;
  const valueOf = r => draft[r.policy_key] ?? { days: r.retention_days, enabled: r.enabled };
  const dirty = r => { const d = valueOf(r); return d.days !== r.retention_days || d.enabled !== r.enabled; };
  const setVal = (r, patch) => setDraft(p => ({ ...p, [r.policy_key]: { ...valueOf(r), ...patch } }));

  async function onSave(r) {
    const d = valueOf(r);
    // The database enforces the same floor and the job clamps to it again;
    // checking here too means the reader is told why before a round trip.
    if (!Number.isInteger(d.days) || d.days < r.min_days) {
      setRowMsg(m => ({ ...m, [r.policy_key]: { error: `Must be at least ${r.min_days} days` } }));
      return;
    }
    setSaving(r.policy_key);
    const { error: e } = await save(r.policy_key, d.days, d.enabled);
    setSaving(null);
    if (e) { setRowMsg(m => ({ ...m, [r.policy_key]: { error: e.message } })); return; }
    setDraft(p => { const n = { ...p }; delete n[r.policy_key]; return n; });
    setRowMsg(m => ({ ...m, [r.policy_key]: { ok: 'Saved' } }));
    setTimeout(() => setRowMsg(m => { const n = { ...m }; delete n[r.policy_key]; return n; }), 2500);
  }

  return (
    <section className="editor-card">
      <h2 className="section-title" style={{ marginTop: 0 }}>Data retention</h2>
      <p className="muted" style={{ marginTop: '-0.25rem' }}>
        How long detail is kept after a session closes. A nightly job slims anything older.
      </p>
      <div className="ret-kept">
        <strong>Analytics figures are never deleted</strong> — session counts, completion, dropouts,
        scores and pass/fail stay for good, as do the session record and Session changes history.
        Slimmed sessions stay in the archive, marked as archived.
      </div>

      {error && <p className="error">{error}</p>}
      {!data && !error && <SkeletonTable rows={3} label="Loading retention settings…" />}

      {data && (
        <>
          {data.cron_scheduled === false && (
            <p className="ret-warn">
              ⚠ The nightly job is not scheduled, so nothing is being slimmed. Re-run the last section of
              the data-retention SQL.
            </p>
          )}
          {!canEdit && <p className="muted">Only a super admin can change these periods.</p>}

          <div className="ret-scroll">
            <table className="participants-table ret-table">
              <thead>
                <tr>
                  <th>Record type</th>
                  <th className="ret-right">Keep for</th>
                  <th>Active</th>
                  <th>Last changed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.policies.map(r => {
                  const d = valueOf(r);
                  const low = Number.isInteger(d.days) && d.days < r.min_days;
                  const msg = rowMsg[r.policy_key];
                  return (
                    <tr key={r.policy_key} className={d.enabled ? '' : 'ret-off'}>
                      <td>
                        <div className="ret-label">{r.label}</div>
                        <div className="ret-note">{r.note}</div>
                        {r.enabled && r.due_now > 0 && (
                          <div className="ret-due">
                            Next run: {r.due_now} session{r.due_now === 1 ? '' : 's'} at the saved setting
                          </div>
                        )}
                      </td>
                      <td className="ret-right">
                        <input
                          type="number"
                          className={`form-input ret-days${low ? ' ret-days-bad' : ''}`}
                          value={Number.isFinite(d.days) ? d.days : ''}
                          min={r.min_days}
                          max={3650}
                          disabled={!canEdit}
                          aria-label={`${r.label}: days to keep`}
                          onChange={e => setVal(r, { days: parseInt(e.target.value, 10) })}
                        />
                        <span className="ret-unit">days</span>
                        <div className="ret-note">
                          {low ? `Minimum ${r.min_days} days` : `${approx(d.days)} · default ${r.default_days} · min ${r.min_days}`}
                        </div>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!d.enabled}
                          disabled={!canEdit}
                          aria-label={`${r.label}: active`}
                          onChange={e => setVal(r, { enabled: e.target.checked })}
                        />
                      </td>
                      <td className="ret-note">
                        {r.updated_at
                          ? `${new Date(r.updated_at).toLocaleDateString('en-GB')}${r.updated_by_name ? ` · ${r.updated_by_name}` : ''}`
                          : 'Not yet changed'}
                      </td>
                      <td className="ret-right">
                        {canEdit && dirty(r) && (
                          <button type="button" disabled={saving === r.policy_key || low} onClick={() => onSave(r)}>
                            {saving === r.policy_key ? 'Saving…' : 'Save'}
                          </button>
                        )}
                        {msg?.ok && <span className="ret-ok">{msg.ok}</span>}
                        {msg?.error && <div className="error ret-err">{msg.error}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="muted ret-run">
            {describeRun(data.last_run)}
            {data.cron_scheduled ? ' · runs nightly at 02:00 UTC' : ''}
          </p>
        </>
      )}
    </section>
  );
}

