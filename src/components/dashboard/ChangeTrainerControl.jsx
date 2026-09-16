import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { ROLES } from '../../lib/roles.js';

// Session-header control to reassign the trainer. Shown only to super-tier and
// vendor managers. Eligible trainers are scoped to the session's vendor (the
// reassignment never moves a session across vendors); super-delivered sessions
// (vendor_id null) reassign among super trainers. The actual write + auth check
// happens in the set_session_trainer RPC via `onChange`.
// `startEditing` + `onDone`: opened from a menu rather than its own Change
// button. It starts in the editor, and hands back to the caller on Save or
// Cancel instead of collapsing to the "Trainer: X  Change" label.
export default function ChangeTrainerControl({ sessionVendorId, currentTrainer, onChange, startEditing = false, onDone }) {
  const [editing, setEditing] = useState(startEditing);
  const [options, setOptions] = useState([]);
  const [pick, setPick] = useState(startEditing ? (currentTrainer?.id || '') : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editing) return undefined;
    let cancelled = false;
    (async () => {
      let q = supabase.from('profiles').select('id, full_name, email, role').order('full_name');
      if (sessionVendorId) {
        q = q.eq('vendor_id', sessionVendorId).in('role', [ROLES.VENDOR_MANAGER, ROLES.VENDOR_TRAINER, 'trainer']);
      } else {
        // Super-delivered session: only other super trainers share its (null) vendor.
        q = q.is('vendor_id', null).in('role', [ROLES.SUPER_ADMIN, ROLES.SUPER_TRAINER]);
      }
      const { data } = await q;
      if (!cancelled) setOptions(data || []);
    })();
    return () => { cancelled = true; };
  }, [editing, sessionVendorId]);

  function open() {
    setError('');
    setPick(currentTrainer?.id || '');
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setError('');
    onDone?.();
  }

  async function save() {
    const chosen = options.find(o => o.id === pick);
    if (!chosen) { setError('Pick a trainer.'); return; }
    setBusy(true);
    setError('');
    const { error: e } = await onChange({ id: chosen.id, full_name: chosen.full_name || chosen.email });
    setBusy(false);
    if (e) { setError(e.message); return; }
    setEditing(false);
    onDone?.();
  }

  if (!editing) {
    return (
      <span className="change-trainer">
        <span className="change-trainer-label">Trainer: <strong>{currentTrainer?.full_name || 'Unassigned'}</strong></span>
        <button type="button" className="ghost-link" onClick={open}>Change</button>
      </span>
    );
  }

  return (
    <span className="change-trainer editing">
      <select
        className="form-input"
        value={pick}
        onChange={e => setPick(e.target.value)}
        disabled={busy}
        aria-label="New trainer"
      >
        <option value="" disabled>Select trainer…</option>
        {options.map(o => (
          <option key={o.id} value={o.id}>
            {o.full_name || o.email}{o.role === ROLES.VENDOR_MANAGER ? ' (Manager)' : ''}
          </option>
        ))}
      </select>
      <button type="button" onClick={save} disabled={busy || !pick}>{busy ? 'Saving…' : 'Save'}</button>
      <button type="button" className="ghost" onClick={cancel} disabled={busy}>Cancel</button>
      {options.length === 0 && <span className="muted">No other trainers in this vendor.</span>}
      {error && <span className="error">{error}</span>}
    </span>
  );
}
