import { useCallback, useEffect, useState } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';
import {
  fetchEditDetail, resolveChangeGroup, resolveSectionChanges,
} from '../../hooks/useWorkbookEditHeat.js';
import { diffConfigs } from '../../lib/configDiff.js';
import '../../styles/edit-heat.css';

const STATUS_LABEL = {
  adopted: 'Adopted into the master',
  not_needed: 'Not needed in the master',
};

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// A group's identity, matching the key the RPCs use. NULLs are meaningful
// (an edit whose block could not be mapped), so they are kept, not defaulted.
function keyOf(r) {
  return `${r.master_block_id || '-'}|${r.session_id || '-'}|${r.actor_id || '-'}`;
}

// What the field changed, behind one heat marker, and what to do about it.
// One entry per (session, trainer, block) showing the NET change — a trainer
// who saved the same paragraph five times appears once, with the wording they
// ended on.
export default function EditHeatModal({
  workbookId, sectionId, sectionTitle, blockId, blockLabel, onClose, onResolved,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');   // reason on a bulk decision
  const [bulkFor, setBulkFor] = useState(null);   // 'adopted' | 'not_needed'
  const [dirty, setDirty] = useState(false);
  useBodyScrollLock();

  const load = useCallback(async () => {
    const { rows: r, error: e } = await fetchEditDetail(workbookId, sectionId, blockId || null);
    if (e) setError(e);
    setRows(r);
    setLoading(false);
  }, [workbookId, sectionId, blockId]);

  // Re-subscribed whenever "dirty" flips so Escape closes through the same
  // path as the × and the backdrop — all three go via close(), which tells the
  // page to reload its heat only if something was actually resolved. One
  // reload on the way out, not one per click.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') close(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  useEffect(() => { load(); }, [load]);

  function close() {
    if (dirty) onResolved?.();
    onClose();
  }

  async function resolveOne(row, status, note = null) {
    const k = keyOf(row);
    setBusyKey(k);
    setError('');
    const { error: e } = await resolveChangeGroup({
      workbookId,
      sectionId,
      blockId: row.master_block_id,
      sessionId: row.session_id,
      actorId: row.actor_id,
      status,
      note,
    });
    setBusyKey(null);
    if (e) { setError(e); return; }
    setDirty(true);
    await load();
  }

  async function resolveAll(status, note) {
    setBusyKey('__all__');
    setError('');
    const { error: e } = await resolveSectionChanges({ workbookId, sectionId, status, note });
    setBusyKey(null);
    setBulkFor(null);
    setNoteDraft('');
    if (e) { setError(e); return; }
    setDirty(true);
    await load();
  }

  const open = rows.filter(r => r.is_open);
  const resolved = rows.filter(r => !r.is_open);
  const adoptedCount = resolved.filter(r => r.status === 'adopted').length;
  const notNeededCount = resolved.filter(r => r.status === 'not_needed').length;
  const openSessions = new Set(open.map(r => r.session_id)).size;
  const shown = showResolved ? rows : open;

  return (
    <div className="modal-backdrop visible" onClick={close}>
      <div className="modal-card eh-card" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Changed in sessions</h2>
            <p className="eh-sub">{blockLabel ? `${blockLabel} — ` : ''}{sectionTitle}</p>
          </div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">×</button>
        </header>

        <div className="modal-body">
          {loading && <p className="muted">Loading changes…</p>}
          {error && <p className="error">{error}</p>}

          {!loading && rows.length === 0 && !error && (
            <p className="muted">No changes recorded here yet.</p>
          )}

          {!loading && rows.length > 0 && (
            <>
              <div className="eh-summary">
                {open.length > 0 ? (
                  <p>
                    <strong>{open.length}</strong> change{open.length === 1 ? '' : 's'} waiting
                    on a decision, from <strong>{openSessions}</strong> session
                    {openSessions === 1 ? '' : 's'}. Deciding here changes nothing in any
                    workbook — it records what you concluded so the marker stops asking.
                  </p>
                ) : (
                  <p>Everything here has been reviewed.</p>
                )}
                {resolved.length > 0 && (
                  <p className="eh-tally">
                    {adoptedCount > 0 && <span className="eh-pill eh-pill--adopted">{adoptedCount} adopted</span>}
                    {notNeededCount > 0 && <span className="eh-pill eh-pill--notneeded">{notNeededCount} not needed</span>}
                  </p>
                )}
              </div>

              {open.length > 1 && !blockId && (
                bulkFor ? (
                  <div className="eh-bulk-confirm">
                    <span>
                      Mark all {open.length} as <strong>{bulkFor === 'adopted' ? 'adopted' : 'not needed'}</strong>?
                    </span>
                    <input
                      className="form-input eh-note-input"
                      placeholder="Why (optional) — the most useful thing for whoever looks next"
                      value={noteDraft}
                      onChange={e => setNoteDraft(e.target.value)}
                    />
                    <div className="eh-bulk-actions">
                      <button
                        type="button"
                        className="ghost"
                        disabled={busyKey === '__all__'}
                        onClick={() => resolveAll(bulkFor, noteDraft.trim() || null)}
                      >
                        {busyKey === '__all__' ? 'Saving…' : 'Confirm'}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => { setBulkFor(null); setNoteDraft(''); }}
                      >Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="eh-bulk">
                    <span className="muted">Clear the whole exercise:</span>
                    <button type="button" className="ghost" onClick={() => setBulkFor('adopted')}>
                      ✓ All adopted
                    </button>
                    <button type="button" className="ghost" onClick={() => setBulkFor('not_needed')}>
                      ✕ All not needed
                    </button>
                  </div>
                )
              )}

              {resolved.length > 0 && (
                <label className="eh-toggle">
                  <input
                    type="checkbox"
                    checked={showResolved}
                    onChange={e => setShowResolved(e.target.checked)}
                  />
                  <span>Show {resolved.length} resolved</span>
                </label>
              )}
            </>
          )}

          {shown.map(r => {
            const k = keyOf(r);
            const diffs = diffConfigs(r.block_type, r.before_config, r.after_config);
            const busy = busyKey === k;
            return (
              <article className={`eh-entry${r.is_open ? '' : ' eh-entry--resolved'}`} key={k}>
                <header className="eh-entry-head">
                  <span className="eh-session">{r.session_name || 'Deleted session'}</span>
                  {r.city_code && <span className="eh-chip">{r.city_code}</span>}
                  {!r.is_open && (
                    <span className={`eh-pill eh-pill--${r.status === 'adopted' ? 'adopted' : 'notneeded'}`}>
                      {r.status === 'adopted' ? '✓ Adopted' : '✕ Not needed'}
                    </span>
                  )}
                  <span className="eh-when">{formatWhen(r.last_changed_at)}</span>
                </header>
                <div className="eh-meta">
                  <span>{r.actor_name || 'Unknown trainer'}</span>
                  {Number(r.edit_count) > 1 && (
                    <span className="muted"> · {r.edit_count} saves, net change shown</span>
                  )}
                </div>

                {diffs.length === 0 ? (
                  <p className="muted eh-nodiff">Changed outside the editable text.</p>
                ) : (
                  <ul className="eh-diffs">
                    {diffs.map(d => (
                      <li key={d.key} className="eh-diff">
                        <span className="eh-diff-label">{d.label}</span>
                        {d.formattingOnly ? (
                          <span className="eh-formatting">Formatting only — same wording</span>
                        ) : (
                          <div className="eh-diff-pair">
                            {/* "Before" rather than "Master": if two trainers
                                edited the same clone block, the second one's
                                starting point was the first one's wording. */}
                            <div className="eh-was">
                              <span className="eh-tag">Before</span>
                              <span>{d.beforeShown || <em className="muted">(empty)</em>}</span>
                            </div>
                            <div className="eh-now">
                              <span className="eh-tag">After</span>
                              <span>{d.afterShown || <em className="muted">(empty)</em>}</span>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {!r.is_open && (
                  <p className="eh-review-meta">
                    {STATUS_LABEL[r.status] || r.status}
                    {r.reviewed_by_name ? ` by ${r.reviewed_by_name}` : ''}
                    {r.reviewed_at ? ` · ${formatWhen(r.reviewed_at)}` : ''}
                    {r.note ? <span className="eh-review-note">“{r.note}”</span> : null}
                  </p>
                )}

                <div className="eh-entry-actions">
                  {r.is_open ? (
                    <>
                      <button
                        type="button" className="ghost" disabled={busy}
                        onClick={() => resolveOne(r, 'adopted')}
                      >
                        {busy ? 'Saving…' : '✓ Adopted'}
                      </button>
                      <button
                        type="button" className="ghost" disabled={busy}
                        onClick={() => resolveOne(r, 'not_needed')}
                      >
                        ✕ Not needed
                      </button>
                    </>
                  ) : (
                    <button
                      type="button" className="ghost" disabled={busy}
                      onClick={() => resolveOne(r, 'open')}
                    >
                      {busy ? 'Saving…' : '↩ Reopen'}
                    </button>
                  )}
                </div>
              </article>
            );
          })}

          {!loading && rows.length > 0 && shown.length === 0 && (
            <p className="muted">Nothing open. Tick “show resolved” to see the history.</p>
          )}
        </div>

        <footer className="modal-foot">
          <button type="button" className="ghost" onClick={close}>Close</button>
          <span className="muted eh-foot-hint">
            Nothing here edits a workbook. To adopt a change for real, edit the master above.
          </span>
        </footer>
      </div>
    </div>
  );
}
