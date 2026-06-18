import { useMemo, useState } from 'react';
import { usePrepConsumedRefs } from '../../hooks/usePrepConsumedRefs.js';
import { usePrepConsumption } from '../../hooks/usePrepConsumption.js';
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

export default function PrepGrid({ kits = [], structure = [], kind = 'workbook', onMarkKit = null, onRestock = null }) {
  const { participantsById, sessionsById } = usePrepConsumedRefs(kits);
  const consumed = usePrepConsumption(kits, structure, kind); // { [kitId]: Set<header in use> }
  const inUseKits = Object.keys(consumed).length;

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
    // used with no session = a manual trainer withdrawal (not a closed class)
    if (k.status === 'used' && !k.consumed_session_id) return { main: `Kit #${k.kit_index}`, sub: 'withdrawn' };
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
        {inUseKits > 0 && <span><i className="pg-sw pg-use" />{inUseKits} in use</span>}
        <span><i className="pg-sw pg-spent" />{counts.used} spent</span>
        <span className="pg-legend-total">{total} kits total</span>
      </div>

      {onRestock && counts.available > 0 && (
        <RestockControl columns={columns} availableCount={counts.available} onRestock={onRestock} />
      )}

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
                <button type="button" className="pg-mark-btn" title="Mark withdrawn / spent (consumed off-system)"
                  onClick={() => onMarkKit(k.id, 'used')}>withdraw</button>
              )}
              {onMarkKit && k.status === 'used' && !k.consumed_session_id && (
                <button type="button" className="pg-mark-btn" title="Return this kit to the pool"
                  onClick={() => onMarkKit(k.id, 'available')}>restore</button>
              )}
              {sub && <small>{sub}</small>}
            </td>
            {columns.map((h, i) => {
              const v = k.payload?.[h];
              const empty = v == null || String(v).trim() === '';
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

// Pool-level "re-stock a column": paste fresh values for one exercise; they
// overwrite that column across the unused (available) kits, in order.
function RestockControl({ columns, availableCount, onRestock }) {
  const [open, setOpen] = useState(false);
  const [col, setCol] = useState(columns[0] || '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const willApply = Math.min(lines.length, availableCount);

  async function apply() {
    setBusy(true); setMsg('');
    const { error, count } = await onRestock(col, lines);
    setBusy(false);
    if (error) { setMsg(`Error: ${error.message}`); return; }
    setMsg(`Replaced ${count} unused “${col}” value${count === 1 ? '' : 's'}.`);
    setText('');
  }

  if (!open) {
    return (
      <div className="pg-restock">
        <button type="button" className="pg-restock-open" onClick={() => setOpen(true)}>↻ Restock a column</button>
      </div>
    );
  }
  return (
    <div className="pg-restock pg-restock--open">
      <div className="pg-restock-head">
        <label>Exercise{' '}
          <select value={col} onChange={e => { setCol(e.target.value); setMsg(''); }}>
            {columns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <span className="muted">{availableCount} unused kit{availableCount === 1 ? '' : 's'} in the pool</span>
        <button type="button" className="pg-restock-x" onClick={() => { setOpen(false); setText(''); setMsg(''); }} aria-label="Close">×</button>
      </div>
      <textarea rows={4} value={text} onChange={e => setText(e.target.value)}
        placeholder={`Paste fresh ${col} values — one per line. They overwrite the unused kits in order.`} />
      {msg && <p className="pg-restock-msg">{msg}</p>}
      <div className="pg-restock-actions">
        <button type="button" disabled={busy || !lines.length} onClick={apply}>
          {busy ? 'Applying…' : `Apply to ${willApply} unused`}
        </button>
      </div>
    </div>
  );
}
