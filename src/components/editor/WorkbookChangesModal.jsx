import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';
import {
  useAllChanges, resolveChangeGroup, resolveSectionChanges, fetchLineDecisions,
} from '../../hooks/useWorkbookEditHeat.js';
import ChangeEntry, { keyOf } from './ChangeEntry.jsx';
import '../../styles/edit-heat.css';

// Every change in THIS workbook, from the top of the editor.
//
// The per-exercise markers answer "what happened to this exercise" but only
// once you have scrolled to it. This is the same information reached the other
// way round: open it from the page header, see everything at once, and jump to
// the exercise you decide needs a real edit.
//
// Reads the same all-workbooks RPC as the change log page and filters to this
// workbook. That over-fetches slightly, and is deliberate: one read path fewer
// to keep in step, and the log is small. If it grows, this wants a workbook
// argument on workbook_changes_all -- not a second query shape.
export default function WorkbookChangesModal({
  workbookId, workbookTitle, onClose, onResolved, onJumpToSection,
}) {
  const { loading, rows, error, refresh } = useAllChanges(true);
  const [lines, setLines] = useState(() => new Map());

  // Line decisions live in their own RPC, so they reload alongside the groups
  // rather than being folded into the shared change_groups return type — that
  // one is applied and working, and worth leaving alone.
  const reloadAll = useCallback(async () => {
    const [, { byGroup }] = await Promise.all([refresh(), fetchLineDecisions(workbookId)]);
    setLines(byGroup);
  }, [refresh, workbookId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { byGroup } = await fetchLineDecisions(workbookId);
      if (!cancelled) setLines(byGroup);
    })();
    return () => { cancelled = true; };
  }, [workbookId]);
  const [showResolved, setShowResolved] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [actionError, setActionError] = useState('');
  const [dirty, setDirty] = useState(false);
  useBodyScrollLock();

  const mine = useMemo(
    () => rows.filter(r => r.master_workbook_id === workbookId),
    [rows, workbookId],
  );
  const open = mine.filter(r => r.is_open);
  const resolved = mine.filter(r => !r.is_open);
  const shown = showResolved ? mine : open;

  // Exercise order, so the modal reads in the same order as the page behind it.
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of shown) {
      const k = r.master_section_id || 'unknown';
      if (!m.has(k)) {
        m.set(k, {
          id: r.master_section_id, title: r.section_title,
          order: r.section_order ?? 9999, openCount: 0, entries: [],
        });
      }
      const g = m.get(k);
      if (r.is_open) g.openCount += 1;
      g.entries.push(r);
    }
    return [...m.values()]
      .sort((a, b) => a.order - b.order)
      .map(g => ({
        ...g,
        entries: g.entries.sort((a, b) => (a.last_changed_at < b.last_changed_at ? 1 : -1)),
      }));
  }, [shown]);

  function close() {
    if (dirty) onResolved?.();
    onClose();
  }

  async function resolveOne(row, status) {
    const k = keyOf(row);
    setBusyKey(k);
    setActionError('');
    const { error: e } = await resolveChangeGroup({
      workbookId,
      sectionId: row.master_section_id,
      blockId: row.master_block_id,
      sessionId: row.session_id,
      actorId: row.actor_id,
      status,
    });
    setBusyKey(null);
    if (e) { setActionError(e); return; }
    setDirty(true);
    await refresh();
  }

  async function resolveExercise(sectionId, status) {
    setBusyKey(`sec:${sectionId}`);
    setActionError('');
    const { error: e } = await resolveSectionChanges({ workbookId, sectionId, status });
    setBusyKey(null);
    if (e) { setActionError(e); return; }
    setDirty(true);
    await refresh();
  }

  function jump(sectionId) {
    close();
    onJumpToSection?.(sectionId);
  }

  return (
    <div className="modal-backdrop visible" onClick={close}>
      <div className="modal-card eh-card eh-card--wide" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Changed in sessions</h2>
            <p className="eh-sub">{workbookTitle || 'This workbook'} — every exercise</p>
          </div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">×</button>
        </header>

        <div className="modal-body">
          {loading && <p className="muted">Loading changes…</p>}
          {error && <p className="error">{error}</p>}
          {actionError && <p className="error">{actionError}</p>}

          {!loading && !error && mine.length === 0 && (
            <p className="muted">No changes recorded in this workbook yet.</p>
          )}

          {!loading && mine.length > 0 && (
            <>
              <div className="eh-summary">
                {open.length > 0 ? (
                  <p>
                    <strong>{open.length}</strong> change{open.length === 1 ? '' : 's'} waiting
                    on a decision, across <strong>{new Set(open.map(r => r.master_section_id)).size}</strong>
                    {' '}exercise{new Set(open.map(r => r.master_section_id)).size === 1 ? '' : 's'}.
                    Adopting a line writes it into this master workbook; dismissing one only
                    records that you decided against it.
                  </p>
                ) : (
                  <p>Everything in this workbook has been reviewed.</p>
                )}
              </div>

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

          {groups.map(g => (
            <div className="cl-section" key={g.id || 'unknown'}>
              <div className="cl-section-head">
                <h3>{g.title}</h3>
                {g.id && (
                  <button type="button" className="link-btn" onClick={() => jump(g.id)}>
                    Go to exercise →
                  </button>
                )}
                {/* Dismissing in bulk writes nothing, so it is safe. There is
                    deliberately no "all adopted": adopting edits the master,
                    and that should be a line someone has actually read. */}
                {g.openCount > 1 && g.id && (
                  <div className="cl-section-bulk">
                    <button
                      type="button" className="ghost"
                      disabled={busyKey === `sec:${g.id}`}
                      onClick={() => resolveExercise(g.id, 'not_needed')}
                    >
                      {busyKey === `sec:${g.id}` ? 'Saving…' : `✕ All ${g.openCount} not needed`}
                    </button>
                  </div>
                )}
              </div>
              {g.entries.map(r => (
                <ChangeEntry
                  key={keyOf(r)}
                  row={r}
                  busy={busyKey === keyOf(r)}
                  onResolve={resolveOne}
                  blockLabel={r.block_order != null ? `Block ${r.block_order + 1}` : null}
                  lineDecisions={lines.get(keyOf(r)) || {}}
                  onChanged={() => { setDirty(true); reloadAll(); onResolved?.(); }}
                />
              ))}
            </div>
          ))}

          {!loading && mine.length > 0 && shown.length === 0 && (
            <p className="muted">Nothing open. Tick “show resolved” to see the history.</p>
          )}
        </div>

        <footer className="modal-foot">
          <button type="button" className="ghost" onClick={close}>Close</button>
          <Link className="eh-foot-link" to="/trainer/changes">Every workbook →</Link>
        </footer>
      </div>
    </div>
  );
}
