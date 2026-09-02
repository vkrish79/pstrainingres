import { useMemo } from 'react';
import { usePrepConsumedRefs } from '../../hooks/usePrepConsumedRefs.js';
import { usePrepConsumption } from '../../hooks/usePrepConsumption.js';
import { STATUS_ORDER, GROUP_LABEL, STATUS_CLASS, buildKitColumns, kitRowLabel } from './kitRows.js';
import '../../styles/prep-grid.css';

// Colour-coded READ view of a prep pool. Rows = kits (→ participant once drawn),
// columns = prep-template exercises, cell = the PNR/ticket text, painted by
// kit.status: available 🟢 (pool) / allocated 🟠 / used 🔴 (class closed), with
// the live in-use burn-down (🔶) deepening cells the participant has worked.
//
// Deliberately not editable. Every prep value change goes through the bulk edit
// sheet (PrepEditGrid) instead, so there is exactly ONE surface that writes kit
// payloads — one place for the allocated-kit warning, the participant mirror and
// the change count to live.
//
// Props:
//   kits      — from useContentPrep: [{ id, kit_index, status, payload, consumed_* }]
//   structure — parent.prep_template: [{ header, section_id }] (column order)
//   onMarkKit(kitId, status) — withdraw / restore; a status change, not a prep edit
//   onBulkEdit() — opens the bulk edit sheet
export default function PrepGrid({ kits = [], structure = [], kind = 'workbook', onMarkKit = null, onBulkEdit = null }) {
  const { participantsById, sessionsById } = usePrepConsumedRefs(kits);
  const consumed = usePrepConsumption(kits, structure, kind); // { [kitId]: Set<header in use> }
  const inUseKits = Object.keys(consumed).length;

  const columns = useMemo(() => buildKitColumns(structure, kits), [structure, kits]);

  const counts = useMemo(() => {
    const c = { available: 0, allocated: 0, used: 0 };
    for (const k of kits) if (k.status in c) c[k.status]++;
    return c;
  }, [kits]);

  // Group kits by status, each group sorted by kit_index.
  const groups = useMemo(() => STATUS_ORDER.map(status => ({
    status,
    rows: kits.filter(k => k.status === status).sort((a, b) => a.kit_index - b.kit_index),
  })).filter(g => g.rows.length), [kits]);

  if (!kits.length) return null;
  const total = kits.length;
  const pct = n => (total ? (n / total) * 100 : 0);

  const rowLabel = k => kitRowLabel(k, participantsById, sessionsById);

  return (
    <div className="prep-grid">
      <div className="pg-bar" aria-hidden>
        <span className="pg-seg pg-seg-pool" style={{ width: `${pct(counts.available)}%` }} />
        <span className="pg-seg pg-seg-alloc" style={{ width: `${pct(counts.allocated)}%` }} />
        <span className="pg-seg pg-seg-spent" style={{ width: `${pct(counts.used)}%` }} />
      </div>
      <div className="pg-legend">
        <span><i className="pg-sw pg-pool" />{counts.available} unused</span>
        <span><i className="pg-sw pg-alloc" />{counts.allocated} allocated</span>
        {inUseKits > 0 && <span><i className="pg-sw pg-use" />{inUseKits} in use</span>}
        <span><i className="pg-sw pg-spent" />{counts.used} spent</span>
        <span className="pg-legend-total">{total} kits total</span>
      </div>

      {onBulkEdit && (
        <>
          <p className="pg-edit-hint">
            This view is read-only. Use <strong>Bulk edit</strong> to change prep — drag to select a block,
            paste a column straight from Excel, and review the changes before saving.
          </p>
          <div className="pg-tools">
            <button type="button" className="pg-bulk-btn" onClick={onBulkEdit}>
              ✎ Bulk edit / paste a column
            </button>
          </div>
        </>
      )}

      <div className="pg-scroll">
        <table className="pg-table">
          <thead>
            <tr>
              <th className="pg-rowhead">Kit / Participant</th>
              {columns.map((h, i) => <th key={i}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <GroupRows
                key={g.status} group={g} columns={columns}
                rowLabel={rowLabel} statusClass={STATUS_CLASS[g.status]} consumed={consumed} onMarkKit={onMarkKit}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupRows({ group, columns, rowLabel, statusClass, consumed, onMarkKit }) {
  return (
    <>
      <tr className="pg-divider"><td colSpan={columns.length + 1}><span className="pg-divider-label">{GROUP_LABEL[group.status]}</span></td></tr>
      {group.rows.map(k => {
        const { main, sub } = rowLabel(k);
        return (
          <tr key={k.id}>
            <td className="pg-rowhead">
              {main}
              {onMarkKit && k.status === 'available' && (
                <button type="button" className="pg-mark-btn"
                  onClick={() => onMarkKit(k.id, 'used')}>withdraw</button>
              )}
              {onMarkKit && k.status === 'used' && !k.consumed_session_id && (
                <button type="button" className="pg-mark-btn"
                  onClick={() => onMarkKit(k.id, 'available')}>restore</button>
              )}
              {sub && <small>{sub}</small>}
            </td>
            {columns.map((h, i) => {
              const v = k.payload?.[h];
              const empty = v == null || String(v).trim() === '';
              // An allocated cell the participant has already worked deepens to 🔶.
              const cls = group.status === 'allocated' && consumed?.[k.id]?.has(h) ? 'pg-use' : statusClass;
              return (
                <td key={i} className={`pg-cell ${cls} ${empty ? 'pg-empty' : ''}`}>
                  {empty ? '—' : String(v)}
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
