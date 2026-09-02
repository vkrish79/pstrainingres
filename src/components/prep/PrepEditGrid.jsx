import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrepConsumedRefs } from '../../hooks/usePrepConsumedRefs.js';
import { usePrepConsumption } from '../../hooks/usePrepConsumption.js';
import {
  buildKitRows, buildKitColumns, kitRowLabel, fillDown, clearRange, rangeToTsv, selectionRect,
  GROUP_LABEL, STATUS_CLASS,
} from './kitRows.js';
import '../../styles/prep-grid.css';

// Bulk edit of EXISTING kits, driven like a spreadsheet: click selects, drag
// selects a block, type or double-click to edit, paste fills from the block's
// top-left. The row set is fixed — these are real kits, so a paste never invents
// one.
//
// Fixing one exercise across 50 kits is the case this exists for: click that
// column, paste the 50 values straight out of Excel, save once.
//
// Cells are NOT always-on inputs. A focused input swallows the mouse drag for its
// own text selection, so there would be no way to select a range; Excel resolves
// this the same way — click selects, typing (or F2 / double-click) edits.
//
// Rows are snapshotted on mount so a realtime refresh mid-edit can't move the
// grid under the trainer's hands. EVERY interaction mutates the draft only —
// Save stays the single write path, so even a range clear surfaces in the change
// count and still passes through the allocated-kit warning.
//
// props: kits, structure, kind, busy,
//   onSubmit(changes) -> { count, failed } — changes are [{ kitId, header, value }]
//   onCancel()
export default function PrepEditGrid({ kits = [], structure = [], kind = 'workbook', onSubmit, onCancel, busy = false }) {
  const { participantsById, sessionsById } = usePrepConsumedRefs(kits);
  // Live, so the in-use count in the save warning reflects the moment of saving —
  // a participant may have started an exercise while this sheet was open.
  const consumed = usePrepConsumption(kits, structure, kind);

  const [rows] = useState(() => buildKitRows(kits));
  const liveById = useMemo(() => new Map(kits.map(k => [k.id, k])), [kits]);
  const columns = useMemo(() => buildKitColumns(structure, kits), [structure, kits]);

  const [baseline, setBaseline] = useState(
    () => rows.map(r => columns.map(h => String(r.kit.payload?.[h] ?? ''))),
  );
  const [draft, setDraft] = useState(() => baseline.map(row => [...row]));

  // Selection is anchor + focus in RENDER-row indices — the same indexing fillDown
  // walks. The rectangle highlights in full (spent rows included, as Excel would);
  // only editable rows are ever written.
  const [sel, setSel] = useState({ anchorRow: 0, anchorCol: 0, focusRow: 0, focusCol: 0 });
  const [editing, setEditing] = useState(null); // { r, c, value }
  const draggingRef = useRef(false);
  const gridRef = useRef(null);

  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [overflow, setOverflow] = useState(0);

  const rect = useMemo(() => selectionRect(sel), [sel]);
  const lastRow = rows.length - 1;
  const lastCol = columns.length - 1;
  const clamp = (v, max) => Math.max(0, Math.min(v, max));

  useEffect(() => {
    function up() { draggingRef.current = false; }
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  function touched() { setNotice(''); setConfirming(false); }

  function selectCell(r, c, extend) {
    const rr = clamp(r, lastRow), cc = clamp(c, lastCol);
    setSel(prev => (extend
      ? { ...prev, focusRow: rr, focusCol: cc }
      : { anchorRow: rr, anchorCol: cc, focusRow: rr, focusCol: cc }));
  }

  function moveTo(r, c, extend) {
    setEditing(null);
    selectCell(r, c, extend);
  }

  function beginEdit(r, c, seed) {
    if (!rows[r]?.editable) return; // spent kits are read-only
    setEditing({ r, c, value: seed !== undefined ? seed : draft[r][c] });
  }

  function commitEdit(move) {
    if (!editing) return;
    const { r, c, value } = editing;
    setDraft(prev => prev.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row)));
    setEditing(null);
    touched(); setOverflow(0);
    if (move === 'down') selectCell(clamp(r + 1, lastRow), c, false);
    else if (move === 'right') selectCell(r, clamp(c + 1, lastCol), false);
  }

  // Spreadsheet paste: \n = rows, \t = columns, landing at the selection's
  // top-left. Row separators vary by source — Excel gives CRLF, some apps bare CR
  // — so normalise both to LF first; stripping CR without translating it would
  // collapse a CR-only column into one giant cell.
  const handlePaste = useCallback(e => {
    if (editing) return; // the cell input handles its own paste
    const text = e.clipboardData?.getData('text') || '';
    const NL = String.fromCharCode(10), CR = String.fromCharCode(13), TAB = String.fromCharCode(9);
    const normalised = text.split(CR + NL).join(NL).split(CR).join(NL);
    if (!normalised) return;
    e.preventDefault();

    let body = normalised;
    while (body.endsWith(NL)) body = body.slice(0, -1);
    const matrix = body.split(NL).map(line => line.split(TAB));
    const top = rect?.top ?? 0;
    const left = rect?.left ?? 0;

    setDraft(prev => {
      const { next, used } = fillDown(prev, rows, top, left, matrix, columns.length);
      setOverflow(matrix.length - used);
      return next;
    });
    touched();
  }, [editing, rect, rows, columns.length]);

  const handleCopy = useCallback(e => {
    if (editing || !rect) return;
    e.clipboardData?.setData('text/plain', rangeToTsv(draft, rect, columns.length));
    e.preventDefault();
  }, [editing, rect, draft, columns.length]);

  function handleKeyDown(e) {
    if (editing) return;
    const r = sel.focusRow, c = sel.focusCol;
    const ext = e.shiftKey;

    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); moveTo(r - 1, c, ext); return;
      case 'ArrowDown': e.preventDefault(); moveTo(r + 1, c, ext); return;
      case 'ArrowLeft': e.preventDefault(); moveTo(r, c - 1, ext); return;
      case 'ArrowRight': e.preventDefault(); moveTo(r, c + 1, ext); return;
      case 'Tab': e.preventDefault(); moveTo(r, c + (e.shiftKey ? -1 : 1), false); return;
      case 'Enter':
      case 'F2': e.preventDefault(); beginEdit(r, c); return;
      case 'Escape': e.preventDefault(); selectCell(r, c, false); return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        setDraft(prev => clearRange(prev, rows, rect, columns.length));
        touched(); setOverflow(0);
        return;
      default: break;
    }
    // A printable key starts editing and replaces, exactly as Excel does.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      e.preventDefault();
      beginEdit(r, c, e.key);
    }
  }

  // Only cells that actually changed, in render order.
  const changes = useMemo(() => {
    const out = [];
    draft.forEach((row, r) => {
      if (!rows[r].editable) return;
      row.forEach((val, c) => {
        if (val.trim() === baseline[r][c].trim()) return;
        out.push({ kitId: rows[r].kit.id, header: columns[c], value: val, rowIndex: r, colIndex: c });
      });
    });
    return out;
  }, [draft, baseline, rows, columns]);

  const changedCells = useMemo(() => new Set(changes.map(ch => ch.rowIndex + ':' + ch.colIndex)), [changes]);

  // What the trainer is warned about before the write lands. Status is read LIVE:
  // a kit claimed while this sheet was open is allocated for real, even though the
  // frozen row snapshot still calls it available.
  const impact = useMemo(() => {
    let allocated = 0, inUse = 0;
    const participants = new Set();
    for (const ch of changes) {
      const kit = liveById.get(ch.kitId) || rows[ch.rowIndex].kit;
      if (kit.status !== 'allocated') continue;
      allocated++;
      if (kit.consumed_participant_id) participants.add(kit.consumed_participant_id);
      if (consumed?.[kit.id]?.has(ch.header)) inUse++;
    }
    return { allocated, inUse, participants: participants.size };
  }, [changes, rows, liveById, consumed]);

  async function save() {
    setError(''); setNotice('');
    const applied = changes;
    const payload = applied.map(({ kitId, header, value }) => ({ kitId, header, value }));
    const { count, failed } = await onSubmit(payload);
    setConfirming(false);

    // Advance the baseline only for cells that landed; a failed cell stays flagged
    // as an outstanding change so the trainer can retry just those.
    const failedSet = new Set((failed || []).map(f => f.kitId + '::' + f.header));
    setBaseline(prev => {
      const next = prev.map(row => [...row]);
      for (const ch of applied) {
        if (failedSet.has(ch.kitId + '::' + ch.header)) continue;
        next[ch.rowIndex][ch.colIndex] = draft[ch.rowIndex][ch.colIndex];
      }
      return next;
    });

    if (failed?.length) {
      setError('Saved ' + count + ' of ' + payload.length + '. ' + failed.length + ' still unsaved — ' + failed[0].message);
      return;
    }
    setNotice('Saved ' + count + ' change' + (count === 1 ? '' : 's') + '.');
  }

  function attemptSave() {
    if (!changes.length) { setError('Nothing changed yet.'); return; }
    if (impact.allocated > 0) { setConfirming(true); return; }
    save();
  }

  function revert() {
    setDraft(baseline.map(row => [...row]));
    setEditing(null); setOverflow(0); setConfirming(false); setNotice(''); setError('');
  }

  const inRect = (r, c) => !!rect && r >= rect.top && r <= rect.bottom && c >= rect.left && c <= rect.right;

  return (
    <div className="prep-paste prep-edit-grid">
      <div className="prep-paste-head">
        <div>
          <h3 className="prep-detail-title" style={{ margin: 0 }}>Edit prep in bulk</h3>
          <p className="muted" style={{ margin: '0.25rem 0 0' }}>
            Works like a spreadsheet — <strong>drag to select</strong> a block, <strong>paste</strong> from
            Excel to fill from the top-left, <strong>Ctrl+C</strong> to copy, <strong>Delete</strong> to clear.
            Type or double-click to edit a cell. Spent kits are read-only. Only what you change is saved.
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Close">×</button>
      </div>

      {overflow > 0 && (
        <p className="prep-warn">
          ⚠ {overflow} pasted value{overflow === 1 ? '' : 's'} had no kit to land on — the pool ends before
          the paste does. Add more kits first if you need them.
        </p>
      )}

      <div
        className="pg-scroll pg-sheet"
        ref={gridRef}
        tabIndex={0}
        role="grid"
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCopy={handleCopy}
      >
        <table className="pg-table prep-paste-table">
          <thead>
            <tr>
              <th className="pg-rowhead">Kit / Participant</th>
              {columns.map((h, i) => <th key={i}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const { main, sub } = kitRowLabel(row.kit, participantsById, sessionsById);
              return (
                <Fragment key={row.kit.id}>
                  {row.firstOfGroup && (
                    <tr className="pg-divider">
                      <td colSpan={columns.length + 1}>
                        <span className="pg-divider-label">{GROUP_LABEL[row.status]}</span>
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td className="pg-rowhead">
                      {main}
                      {sub && <small>{sub}</small>}
                    </td>
                    {columns.map((h, c) => {
                      const isEditing = !!editing && editing.r === r && editing.c === c;
                      const isInUse = row.status === 'allocated' && consumed?.[row.kit.id]?.has(h);
                      const cls = [
                        'pg-cell',
                        isInUse ? 'pg-use' : STATUS_CLASS[row.status],
                        row.editable ? '' : 'pg-readonly',
                        changedCells.has(r + ':' + c) ? 'pg-changed' : '',
                        inRect(r, c) ? 'pg-sel' : '',
                        sel.focusRow === r && sel.focusCol === c ? 'pg-active' : '',
                      ].filter(Boolean).join(' ');

                      if (isEditing) {
                        return (
                          <td key={c} className={`${cls} pg-editcell`}>
                            <input
                              className="pg-edit"
                              autoFocus
                              value={editing.value}
                              disabled={busy}
                              onChange={e => setEditing({ r, c, value: e.target.value })}
                              onBlur={() => commitEdit(null)}
                              onKeyDown={e => {
                                // The grid handler drives navigation; while typing
                                // it must not see these keys.
                                e.stopPropagation();
                                if (e.key === 'Enter') { e.preventDefault(); commitEdit('down'); }
                                else if (e.key === 'Tab') { e.preventDefault(); commitEdit('right'); }
                                else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
                              }}
                            />
                          </td>
                        );
                      }
                      return (
                        <td
                          key={c}
                          className={cls}
                          onMouseDown={e => {
                            // preventDefault stops the browser starting a text
                            // drag, which fights the range selection.
                            e.preventDefault();
                            gridRef.current?.focus();
                            draggingRef.current = true;
                            selectCell(r, c, e.shiftKey);
                          }}
                          onMouseEnter={() => { if (draggingRef.current) selectCell(r, c, true); }}
                          onDoubleClick={() => beginEdit(r, c)}
                        >
                          {draft[r][c] || <span className="pg-cell-blank">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirming && (
        <div className="prep-edit-confirm">
          <p className="prep-edit-confirm-text">
            ⚠ {impact.allocated} of these {changes.length} change{changes.length === 1 ? '' : 's'} are on{' '}
            <strong>allocated</strong> kits, affecting {impact.participants} participant
            {impact.participants === 1 ? '' : 's'}
            {impact.inUse > 0 && (
              <> — {impact.inUse} in an exercise they have <strong>already worked</strong></>
            )}.
            {kind === 'workbook' && ' Their prep updates immediately.'}
          </p>
          <div className="prep-edit-confirm-actions">
            <button type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save anyway'}</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="prep-paste-foot">
        <span className="prep-paste-count">
          <strong>{changes.length}</strong> change{changes.length === 1 ? '' : 's'}
        </span>
        <button type="button" className="ghost btn-sm" disabled={busy || !changes.length} onClick={revert}>
          Revert edits
        </button>
        <span style={{ flex: 1 }} />
        {notice && <span className="prep-notice">{notice}</span>}
        {error && <span className="error">{error}</span>}
        {!confirming && (
          <button type="button" disabled={busy || !changes.length} onClick={attemptSave}>
            {busy ? 'Saving…' : `Save ${changes.length} change${changes.length === 1 ? '' : 's'}`}
          </button>
        )}
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>Close</button>
      </div>
    </div>
  );
}
