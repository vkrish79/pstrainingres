import { useCallback, useEffect, useState } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';
import {
  fetchEditDetail, resolveChangeGroup, resolveSectionChanges, fetchLineDecisions,
} from '../../hooks/useWorkbookEditHeat.js';
import ChangeEntry, { keyOf } from './ChangeEntry.jsx';
import '../../styles/edit-heat.css';

// What the field changed, behind one heat marker, and what to do about it.
// One entry per (session, trainer, block) showing the NET change — a trainer
// who saved the same paragraph five times appears once, with the wording they
// ended on.
export default function EditHeatModal({
  workbookId, sectionId, sectionTitle, blockId, blockLabel, onClose, onResolved,
}) {
  const [rows, setRows] = useState([]);
  const [lines, setLines] = useState(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');   // reason on a bulk decision
  const [bulkFor, setBulkFor] = useState(null);   // 'adopted' | 'not_needed'
  const [dirty, setDirty] = useState(false);
  useBodyScrollLock();

  const load = useCallback(async () => {
    const [{ rows: r, error: e }, { byGroup }] = await Promise.all([
      fetchEditDetail(workbookId, sectionId, blockId || null),
      fetchLineDecisions(workbookId),
    ]);
    if (e) setError(e);
    setRows(r);
    setLines(byGroup);
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
                    {openSessions === 1 ? '' : 's'}. Adopting a line writes it into the master;
                    dismissing one only records that you decided against it.
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
                      Mark all {open.length} as <strong>not needed</strong>?
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
                    {/* Dismissing in bulk is safe — it writes nothing. There is
                        deliberately no "all adopted" here: adopting edits the
                        master, and that should be a line you have looked at. */}
                    <span className="muted">Dismiss the whole exercise:</span>
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

          {shown.map(r => (
            <ChangeEntry
              key={keyOf(r)}
              row={r}
              busy={busyKey === keyOf(r)}
              onResolve={resolveOne}
              workbookId={workbookId}
              sectionId={sectionId}
              lineDecisions={lines.get(keyOf(r)) || {}}
              onChanged={() => { setDirty(true); load(); onResolved?.(); }}
            />
          ))}

          {!loading && rows.length > 0 && shown.length === 0 && (
            <p className="muted">Nothing open. Tick “show resolved” to see the history.</p>
          )}
        </div>

        <footer className="modal-foot">
          <button type="button" className="ghost" onClick={close}>Close</button>
          <span className="muted eh-foot-hint">
            Adopting writes that line into the master workbook, live to enrolled participants.
          </span>
        </footer>
      </div>
    </div>
  );
}
