import { useMemo } from 'react';
import { usePrepConsumedRefs } from '../../hooks/usePrepConsumedRefs.js';
import '../../styles/prep-grid.css';

// Excel-like, colour-coded view of a prep pool. Rows = kits (→ participant once
// drawn), columns = prep-template exercises, cell = the PNR/ticket text, painted
// by kit.status: available 🟢 (pool) / allocated 🟠 / used 🔴 (class closed).
// Phase 1: three colours. The live in-use burn-down (🔶) is a later phase.
//
// Props:
//   kits      — from useContentPrep: [{ id, kit_index, status, payload, consumed_* }]
//   structure — parent.prep_template: [{ header, section_id }] (column order)
const STATUS_ORDER = ['available', 'allocated', 'used'];
const GROUP_LABEL = {
  available: '🟢 In the pool — not yet drawn',
  allocated: '🟠 Allocated — class in progress',
  used: '🔴 Class closed — spent',
};
const STATUS_CLASS = { available: 'pg-pool', allocated: 'pg-alloc', used: 'pg-spent' };

export default function PrepGrid({ kits = [], structure = [] }) {
  const { participantsById, sessionsById } = usePrepConsumedRefs(kits);

  // Columns: prefer the template order; fall back to the union of payload keys.
  const columns = useMemo(() => {
    if (structure.length) return structure.map(c => c.header);
    const seen = new Set();
    for (const k of kits) for (const key of Object.keys(k.payload || {})) seen.add(key);
    return [...seen];
  }, [structure, kits]);

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

  function rowLabel(k) {
    if (k.status === 'available') return { main: `Kit #${k.kit_index}`, sub: null };
    const p = k.consumed_participant_id ? participantsById[k.consumed_participant_id] : null;
    const s = k.consumed_session_id ? sessionsById[k.consumed_session_id] : null;
    const main = p?.full_name || s?.name || `Kit #${k.kit_index}`;
    const sub = p?.full_name && s?.name ? s.name : (p?.full_name && s?.join_code ? s.join_code : null);
    return { main, sub };
  }

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
        <span><i className="pg-sw pg-spent" />{counts.used} spent</span>
        <span className="pg-legend-total">{total} kits total</span>
      </div>

      <div className="pg-scroll">
        <table className="pg-table">
          <thead>
            <tr>
              <th className="pg-rowhead">Kit / Participant</th>
              {columns.map((h, i) => <th key={i} title={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <GroupRows
                key={g.status} group={g} columns={columns}
                rowLabel={rowLabel} statusClass={STATUS_CLASS[g.status]}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupRows({ group, columns, rowLabel, statusClass }) {
  return (
    <>
      <tr className="pg-divider"><td colSpan={columns.length + 1}><span className="pg-divider-label">{GROUP_LABEL[group.status]}</span></td></tr>
      {group.rows.map(k => {
        const { main, sub } = rowLabel(k);
        return (
          <tr key={k.id}>
            <td className="pg-rowhead">{main}{sub && <small>{sub}</small>}</td>
            {columns.map((h, i) => {
              const v = k.payload?.[h];
              const empty = v == null || String(v).trim() === '';
              return (
                <td key={i} className={`pg-cell ${statusClass} ${empty ? 'pg-empty' : ''}`}>
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
