import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fillDown, clearRange, rangeToTsv, selectionRect } from '../prep/kitRows.js';
import { useBusyOverlay } from '../../contexts/BusyOverlayContext.jsx';
import '../../styles/prep-grid.css';

// Session-scoped prep sheet: rows = participants, columns = prep exercises,
// cells = each participant's current prep (a PNR / ticket). Driven like the
// Prep page's "Edit prep in bulk" sheet (PrepEditGrid) and sharing its pure
// helpers: click selects, drag selects a block, type or double-click edits,
// paste fills from the selected cell, Delete clears.
//
// EVERY interaction changes the draft only; Save is the one write path. Each
// changed cell goes through saveOne, so it lands in participant_prep (live to
// the participant's drawer) and is written back to the pool kit, exactly as
// the per-participant editor does. A cleared cell saves as a delete.
//
// This replaced a modal that replaced one exercise's column at a time. A
// column re-issue is now a paste into that column's top cell.
//
// LIVE UPDATES. prep refreshes over realtime while the sheet is open. A cell
// the trainer has not touched follows the live value; a cell they have edited
// keeps their edit, so a co-editor's save can never wipe typing in progress.
//
// props: participants [{id, full_name}], sections [{id, title, order_index}],
//   prep { [participantId]: { [sectionId]: { content } } },
//   blocks [{id, section_id}], answers { [participantId]: { [blockId]: { value } } },
//   onSave({participantId, sectionId, content}, {reload}) -> {error?, poolWarning?},
//   onReload() — one reload after a batch, onDirtyChange(bool)
export default function SessionPrepGrid({
  participants = [], sections = [], prep = {}, blocks = [], answers = {}, onSave, onReload, onDirtyChange,
}) {
  const { run: runBusy } = useBusyOverlay();

  // Numeric-aware, so Trainee2 comes before Trainee10. A paste fills rows in
  // this order, and it is the order a trainer's own spreadsheet is in.
  const people = useMemo(
    () => [...participants].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', undefined, { numeric: true, sensitivity: 'base' })),
    [participants],
  );

  const columns = useMemo(() => {
    const ids = new Set();
    for (const p of participants) for (const sid of Object.keys(prep[p.id] || {})) ids.add(sid);
    return sections
      .filter(s => ids.has(s.id))
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  }, [participants, sections, prep]);

  const live = useMemo(
    () => people.map(p => columns.map(s => String(prep[p.id]?.[s.id]?.content ?? ''))),
    [people, columns, prep],
  );

  // Shape key: the sheet is rebuilt when a row or column comes or goes, which
  // only happens when someone is added or prep is first allocated.
  const shape = people.map(p => p.id).join(',') + '|' + columns.map(s => s.id).join(',');
  const [baseline, setBaseline] = useState(live);
  const [draft, setDraft] = useState(live);
  const shapeRef = useRef(shape);
  useEffect(() => {
    if (shapeRef.current !== shape) {
      shapeRef.current = shape;
      setBaseline(live); setDraft(live);
      return;
    }
    // Same shape: untouched cells follow the live value, edited ones stay.
    setDraft(prevDraft => prevDraft.map((row, r) => row.map((v, c) => (v === baseline[r]?.[c] ? live[r][c] : v))));
    setBaseline(live);
    // `baseline` is read, not followed: this runs for new live data only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, shape]);

  // Which exercises each participant has already worked: any non-empty answer
  // on a block in that exercise. Answers are live, so this is too.
  const worked = useMemo(() => {
    const sectionOf = {};
    for (const b of blocks) sectionOf[b.id] = b.section_id;
    const out = {};
    for (const [pid, byBlock] of Object.entries(answers || {})) {
      for (const [bid, a] of Object.entries(byBlock || {})) {
        const sid = sectionOf[bid];
        if (!sid || a?.value == null || String(a.value).trim() === '') continue;
        (out[pid] ||= new Set()).add(sid);
      }
    }
    return out;
  }, [blocks, answers]);

  const rows = useMemo(() => people.map(() => ({ editable: true })), [people]);
  const [sel, setSel] = useState({ anchorRow: 0, anchorCol: 0, focusRow: 0, focusCol: 0 });
  const [editing, setEditing] = useState(null); // { r, c, value }
  const draggingRef = useRef(false);
  const gridRef = useRef(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [poolWarning, setPoolWarning] = useState('');
  const [overflow, setOverflow] = useState(0);

  const rect = useMemo(() => selectionRect(sel), [sel]);
  const lastRow = people.length - 1;
  const lastCol = columns.length - 1;
  const clamp = (v, max) => Math.max(0, Math.min(v, max));

  useEffect(() => {
    function up() { draggingRef.current = false; }
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const changes = useMemo(() => {
    const out = [];
    draft.forEach((row, r) => row.forEach((val, c) => {
      if (val.trim() === (baseline[r]?.[c] ?? '').trim()) return;
      out.push({ r, c, participant: people[r], section: columns[c], value: val.trim() });
    }));
    return out;
  }, [draft, baseline, people, columns]);
  const changed = useMemo(() => new Set(changes.map(ch => ch.r + ':' + ch.c)), [changes]);

  useEffect(() => { onDirtyChange?.(changes.length > 0); }, [changes.length, onDirtyChange]);

  const impact = useMemo(() => {
    const onWorked = changes.filter(ch => worked[ch.participant.id]?.has(ch.section.id));
    return {
      worked: onWorked.length,
      people: new Set(onWorked.map(ch => ch.participant.id)).size,
      removed: changes.filter(ch => !ch.value).length,
    };
  }, [changes, worked]);

  function touched() { setNotice(''); setError(''); setPoolWarning(''); setConfirming(false); }

  function selectCell(r, c, extend) {
    const rr = clamp(r, lastRow), cc = clamp(c, lastCol);
    setSel(prev => (extend
      ? { ...prev, focusRow: rr, focusCol: cc }
      : { anchorRow: rr, anchorCol: cc, focusRow: rr, focusCol: cc }));
  }
  function moveTo(r, c, extend) { setEditing(null); selectCell(r, c, extend); }
  function beginEdit(r, c, seed) {
    if (busy) return;
    setEditing({ r, c, value: seed !== undefined ? seed : draft[r][c] });
  }
  function commitEdit(move) {
    if (!editing) return;
    const { r, c, value } = editing;
    setDraft(prev => prev.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row)));
    setEditing(null);
    touched(); setOverflow(0);
    if (move === 'down') selectCell(r + 1, c, false);
    else if (move === 'right') selectCell(r, c + 1, false);
    gridRef.current?.focus();
  }

  // Spreadsheet paste, same rules as PrepEditGrid: CRLF or bare CR become LF,
  // \t splits columns, and the block lands at the selection's top-left.
  const handlePaste = useCallback(e => {
    if (editing || busy) return;
    const text = e.clipboardData?.getData('text') || '';
    const NL = String.fromCharCode(10), CR = String.fromCharCode(13), TAB = String.fromCharCode(9);
    let body = text.split(CR + NL).join(NL).split(CR).join(NL);
    if (!body) return;
    e.preventDefault();
    while (body.endsWith(NL)) body = body.slice(0, -1);
    const matrix = body.split(NL).map(line => line.split(TAB));
    setDraft(prev => {
      const { next, used } = fillDown(prev, rows, rect?.top ?? 0, rect?.left ?? 0, matrix, columns.length);
      setOverflow(matrix.length - used);
      return next;
    });
    touched();
  }, [editing, busy, rect, rows, columns.length]);

  const handleCopy = useCallback(e => {
    if (editing || !rect) return;
    e.clipboardData?.setData('text/plain', rangeToTsv(draft, rect, columns.length));
    e.preventDefault();
  }, [editing, rect, draft, columns.length]);

  function handleKeyDown(e) {
    if (editing) return;
    const r = sel.focusRow, c = sel.focusCol, ext = e.shiftKey;
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
        if (busy) return;
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

  async function save() {
    setConfirming(false); setError(''); setNotice(''); setPoolWarning('');
    setBusy(true);
    const batch = changes;
    const landed = [];
    let failed = null, warned = '';
    await runBusy('Saving prep…', async () => {
      // One at a time: saveOne also writes each value back into its pool kit,
      // and two writes into the same kit at once would race.
      for (const ch of batch) {
        const res = await onSave(
          { participantId: ch.participant.id, sectionId: ch.section.id, content: ch.value },
          { reload: false },
        );
        if (res?.error) { failed = { ch, message: res.error.message }; break; }
        if (res?.poolWarning) warned = res.poolWarning;
        landed.push(ch);
      }
      await onReload?.();
    });
    // Advance the baseline only for cells that landed, so a failed cell (and
    // everything after it) stays flagged for a retry.
    setBaseline(prev => {
      const next = prev.map(row => [...row]);
      for (const ch of landed) next[ch.r][ch.c] = ch.value;
      return next;
    });
    setDraft(prev => {
      const next = prev.map(row => [...row]);
      for (const ch of landed) next[ch.r][ch.c] = ch.value;
      return next;
    });
    setBusy(false);
    if (warned) setPoolWarning(warned);
    if (failed) {
      setError(`Saved ${landed.length} of ${batch.length}. ${batch.length - landed.length} still unsaved: ${failed.message}`);
      return;
    }
    setNotice(`Saved ${landed.length} change${landed.length === 1 ? '' : 's'}. Participants see it now.`);
  }

  function attemptSave() {
    if (!changes.length) return;
    if (impact.worked > 0) { setConfirming(true); return; }
    save();
  }

  function revert() {
    setDraft(baseline.map(row => [...row]));
    setEditing(null); setOverflow(0); touched();
  }

  if (!participants.length) return <p className="muted">No participants in this session yet.</p>;
  if (!columns.length) return <p className="muted">No prep has been allocated to participants yet.</p>;

  const inRect = (r, c) => !!rect && r >= rect.top && r <= rect.bottom && c >= rect.left && c <= rect.right;
  const n = changes.length;

  return (
    <div className="prep-grid session-prep-sheet">
      <p className="pg-edit-hint">
        Works like a spreadsheet. <strong>Drag to select</strong> a block, <strong>paste</strong> from Excel to fill
        from the selected cell, <strong>Ctrl+C</strong> to copy, <strong>Delete</strong> to clear. Type or
        double-click to edit; Enter moves down, Tab moves right. Nothing is saved until you press Save.
      </p>
      <div className="sps-legend">
        <span><i className="sps-sw sps-sw-alloc" />Current prep</span>
        <span><i className="sps-sw sps-sw-use" />Already worked by the participant</span>
        <span><i className="sps-sw sps-sw-chg" />Changed, not saved yet</span>
      </div>

      {overflow > 0 && (
        <p className="prep-warn">
          ⚠ {overflow} pasted row{overflow === 1 ? '' : 's'} had no participant to land on. Check you copied the right block.
        </p>
      )}

      <div
        className="pg-scroll pg-sheet"
        ref={gridRef}
        tabIndex={0}
        role="grid"
        aria-label="Prep for every participant"
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCopy={handleCopy}
      >
        <table className="pg-table">
          <thead>
            <tr>
              <th className="pg-rowhead">Participant</th>
              {columns.map(s => <th key={s.id}>{s.title}</th>)}
            </tr>
          </thead>
          <tbody>
            {people.map((p, r) => (
              <tr key={p.id}>
                <td className="pg-rowhead">{p.full_name || '(unnamed)'}</td>
                {columns.map((s, c) => {
                  const isEditing = !!editing && editing.r === r && editing.c === c;
                  const isChanged = changed.has(r + ':' + c);
                  const cls = [
                    'pg-cell',
                    worked[p.id]?.has(s.id) ? 'pg-use' : 'pg-alloc',
                    isChanged ? 'pg-changed' : '',
                    inRect(r, c) ? 'pg-sel' : '',
                    sel.focusRow === r && sel.focusCol === c ? 'pg-active' : '',
                  ].filter(Boolean).join(' ');

                  if (isEditing) {
                    return (
                      <td key={s.id} className={`${cls} pg-editcell`}>
                        <input
                          className="pg-edit"
                          autoFocus
                          autoComplete="off"
                          value={editing.value}
                          aria-label={`${s.title} prep for ${p.full_name || 'participant'}`}
                          onChange={e => setEditing({ r, c, value: e.target.value })}
                          onBlur={() => commitEdit(null)}
                          onKeyDown={e => {
                            // The grid handler drives navigation; while typing
                            // it must not see these keys.
                            e.stopPropagation();
                            if (e.key === 'Enter') { e.preventDefault(); commitEdit('down'); }
                            else if (e.key === 'Tab') { e.preventDefault(); commitEdit('right'); }
                            else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); gridRef.current?.focus(); }
                          }}
                        />
                      </td>
                    );
                  }
                  const v = draft[r]?.[c] ?? '';
                  const was = baseline[r]?.[c] ?? '';
                  return (
                    <td
                      key={s.id}
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
                      {v.trim() || (isChanged
                        ? <span className="sps-removed">Removed</span>
                        : <span className="pg-cell-blank">—</span>)}
                      {isChanged && was && <span className="sps-was">{was}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirming && (
        <div className="prep-edit-confirm">
          <p className="prep-edit-confirm-text">
            ⚠ {impact.worked} of these {n} change{n === 1 ? '' : 's'} {impact.worked === 1 ? 'is' : 'are'} on an
            exercise {impact.people === 1 ? 'the participant has' : `${impact.people} participants have`}{' '}
            <strong>already worked</strong>. Their prep updates immediately.
            {impact.removed > 0 && <> {impact.removed} cell{impact.removed === 1 ? '' : 's'} will be <strong>removed</strong>.</>}
          </p>
          <div className="prep-edit-confirm-actions">
            <button type="button" disabled={busy} onClick={save}>Save anyway</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
      {poolWarning && <p className="prep-warn">⚠ {poolWarning}</p>}

      <div className="prep-paste-foot sps-foot">
        <span className="prep-paste-count"><strong>{n}</strong> change{n === 1 ? '' : 's'}</span>
        <button type="button" className="ghost btn-sm" disabled={busy || !n} onClick={revert}>Revert edits</button>
        <span style={{ flex: 1 }} />
        {notice && <span className="prep-notice" role="status">{notice}</span>}
        {error && <span className="error" role="alert">{error}</span>}
        {!confirming && (
          <button type="button" disabled={busy || !n} onClick={attemptSave}>
            {busy ? 'Saving…' : n ? `Save ${n} change${n === 1 ? '' : 's'}` : 'Save changes'}
          </button>
        )}
      </div>
    </div>
  );
}
