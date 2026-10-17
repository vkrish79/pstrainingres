import { Fragment, useEffect, useMemo, useState } from 'react';
import { SkeletonTable } from '../Skeleton.jsx';
import KebabMenu from '../KebabMenu.jsx';
import { supabase } from '../../lib/supabase.js';
import { useStaff } from '../../hooks/useStaff.js';
import { useVendors } from '../../hooks/useVendors.js';
import { generateTempPassword } from '../../lib/passwords.js';
import { roleLabel as appRoleLabel } from '../../lib/roles.js';
import {
  SettingsFrame, Glance, FilterChips, SearchBox, SettingsList, ListRow, ListGroup, ListEmpty,
  RowConfirm, SlideOver, Field, useSettingsToast, plural,
} from './SettingsFrame.jsx';

// Settings → Staff. Everyone who can sign in to run or manage sessions.
//
// Vendor staff are managed here: creating one mints an account and a
// temporary password, which is shown in a panel that can't be missed.
// The in-house team (super admins and super trainers) is listed too, read-only,
// so this is the one place to see who has access; their roles are not set here.
const ROLE_OPTIONS = [
  { value: 'vendor_trainer', label: 'Vendor trainer' },
  { value: 'vendor_manager', label: 'Vendor manager' },
];
const HOUSE_ROLES = ['super_admin', 'super_trainer'];
const COLS = 'minmax(0, 1.4fr) minmax(0, 1.6fr) 130px 120px 150px 40px';

function roleLabel(role) {
  if (role === 'vendor_manager') return 'Vendor manager';
  if (role === 'vendor_trainer' || role === 'trainer') return 'Vendor trainer';
  return appRoleLabel(role) || role;
}
const since = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function StaffSettings() {
  const { loading, error, staff, createStaff, updateStaffVendor, resetStaffPassword, deleteStaff } = useStaff();
  const { vendors, loading: vendorsLoading } = useVendors();
  const toast = useSettingsToast();

  // In-house team, read-only.
  const [house, setHouse] = useState([]);
  useEffect(() => {
    let live = true;
    supabase.from('profiles').select('id, full_name, email, role, must_change_password, created_at')
      .in('role', HOUSE_ROLES).order('created_at', { ascending: true })
      .then(({ data }) => { if (live) setHouse(data || []); });
    return () => { live = false; };
  }, []);

  const [filter, setFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [q, setQ] = useState('');
  const [panel, setPanel] = useState(null); // { mode: 'add' } | { mode: 'vendor', person }
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [rowError, setRowError] = useState('');
  const [creds, setCreds] = useState(null); // { kind: 'created' | 'reset', email, full_name, temp_password, role }
  const [confirming, setConfirming] = useState(null); // { kind, id }
  const [confirmBusy, setConfirmBusy] = useState(false);

  const people = useMemo(() => [
    ...staff.map(s => ({ ...s, group: 'vendor' })),
    ...house.map(s => ({ ...s, group: 'house' })),
  ], [staff, house]);
  const text = q.trim().toLowerCase();
  const shown = people.filter(s =>
    (filter === 'all' || (filter === 'wait' ? s.must_change_password : s.group === filter))
    && (vendorFilter === 'all'
      || (vendorFilter === 'house' ? s.group === 'house'
        : vendorFilter === 'unassigned' ? s.group === 'vendor' && !s.vendor_id
          : s.vendor_id === vendorFilter))
    && `${s.full_name || ''} ${s.email || ''} ${roleLabel(s.role)}`.toLowerCase().includes(text));
  const waiting = people.filter(s => s.must_change_password);

  function openAdd() {
    setPanel({ mode: 'add' }); setPanelError('');
    setForm({ vendorId: vendorFilter !== 'all' && vendorFilter !== 'house' && vendorFilter !== 'unassigned' ? vendorFilter : '', role: 'vendor_trainer', email: '', fullName: '', password: generateTempPassword() });
  }
  function openVendor(person) { setPanel({ mode: 'vendor', person }); setPanelError(''); setForm({ vendorId: person.vendor_id || '' }); }
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const emailOk = /^\S+@\S+\.\S+$/.test(form.email || '');

  async function save() {
    setPanelError('');
    if (panel.mode === 'vendor') {
      if (!form.vendorId) { setPanelError('Pick a vendor.'); return; }
      setBusy(true);
      const { error: err } = await updateStaffVendor(panel.person.id, form.vendorId);
      setBusy(false);
      if (err) { setPanelError(err.message); return; }
      toast.show(`Moved ${panel.person.full_name || panel.person.email} to ${vendors.find(v => v.id === form.vendorId)?.name || 'the vendor'}`);
      setPanel(null);
      return;
    }
    if (!form.vendorId) { setPanelError('Pick a vendor.'); return; }
    if (!emailOk) { setPanelError('Enter their email address.'); return; }
    if (!form.fullName.trim()) { setPanelError('Enter their full name.'); return; }
    if ((form.password || '').length < 8) { setPanelError('The temporary password needs at least 8 characters.'); return; }
    setBusy(true);
    const { data, error: err } = await createStaff({
      email: form.email.trim(), full_name: form.fullName.trim(), temp_password: form.password, role: form.role, vendor_id: form.vendorId,
    });
    setBusy(false);
    if (err) { setPanelError(err.message); return; }
    setCreds({ kind: 'created', email: data.email, full_name: data.full_name, temp_password: form.password, role: data.role });
    setPanel(null);
  }

  async function runConfirmed(s) {
    setConfirmBusy(true); setRowError('');
    if (confirming.kind === 'reset') {
      const pw = generateTempPassword();
      const { data, error: err } = await resetStaffPassword(s.id, pw);
      if (err) setRowError(err.message);
      else setCreds({ kind: 'reset', email: data.email, full_name: data.full_name, temp_password: pw });
    } else {
      const { error: err } = await deleteStaff(s.id);
      if (err) setRowError(err.message); else toast.show(`Deleted ${s.full_name || s.email}`);
    }
    setConfirmBusy(false);
    setConfirming(null);
  }
  function confirmText(s) {
    const who = `${s.full_name || s.email} (${s.email})`;
    return confirming.kind === 'reset'
      ? `Reset the password for ${who}? Their current password stops working, and you get a new temporary one to share with them.`
      : `Permanently delete ${who}? This removes their login and profile; they can no longer sign in, and the email is freed for a new invite. This cannot be undone.`;
  }

  const row = s => (
    <Fragment key={s.id}>
      <ListRow>
        <span className="stl-name">{s.full_name || s.email || '—'}<small>Since {since(s.created_at)}</small></span>
        <span className="stl-uses">{s.email || '—'}</span>
        <span className={`stl-pill is-role`}>{roleLabel(s.role)}</span>
        <span className="stl-uses">{s.group === 'house' ? 'In-house' : (s.vendors?.name || <span className="is-none">Unassigned</span>)}</span>
        <span className={`stl-pill ${s.must_change_password ? 'is-wait' : 'is-on'}`}>{s.must_change_password ? 'Awaiting first login' : 'Active'}</span>
        <span className="stl-actions">
          {s.group === 'vendor' && (
            <KebabMenu
              label={`Actions for ${s.full_name || s.email}`}
              items={[
                { label: 'Change vendor…', glyph: '⇄', onClick: () => openVendor(s) },
                { label: 'Reset password…', glyph: '⟲', onClick: () => { setRowError(''); setConfirming({ kind: 'reset', id: s.id }); } },
                { separator: true },
                { label: 'Delete staff member…', glyph: '✕', danger: true, onClick: () => { setRowError(''); setConfirming({ kind: 'delete', id: s.id }); } },
              ]}
            />
          )}
        </span>
      </ListRow>
      {confirming?.id === s.id && (
        <RowConfirm
          message={confirmText(s)}
          confirmLabel={confirming.kind === 'reset' ? 'Reset password' : 'Delete staff member'}
          onConfirm={() => runConfirmed(s)}
          onCancel={() => setConfirming(null)}
          busy={confirmBusy}
        />
      )}
    </Fragment>
  );
  const vendorRows = shown.filter(s => s.group === 'vendor');
  const houseRows = shown.filter(s => s.group === 'house');

  return (
    <SettingsFrame
      title="Staff"
      note="Everyone who can sign in to run or manage sessions. Adding a vendor trainer or manager creates their login and a temporary password to hand over; they change it at first login. The in-house team is shown for reference."
      addLabel="+ Add staff member"
      onAdd={openAdd}
      glance={!loading && !error && (
        <>
          <Glance label="People" value={people.length} hint={`${house.length} in-house · ${staff.length} vendor`} />
          <Glance label="Awaiting first login" value={waiting.length} hint={waiting.map(s => s.full_name || s.email).join(', ') || 'Nobody'} alert />
          <Glance label="Super trainers" value={house.filter(s => s.role === 'super_trainer').length} hint={`plus ${plural(house.filter(s => s.role === 'super_admin').length, 'super admin')}`} />
        </>
      )}
      notice={creds && (
        <div className="stl-creds" role="status">
          <span>
            <strong>{creds.kind === 'created' ? 'Created.' : 'Password reset.'}</strong>{' '}
            Share these with <em>{creds.full_name}</em>{creds.role ? ` (${roleLabel(creds.role)})` : ''}. They change the password at first login.
          </span>
          <span className="stl-creds-row"><code>{creds.email}</code><code>{creds.temp_password}</code></span>
          <button type="button" className="ghost" onClick={() => setCreds(null)}>Done</button>
        </div>
      )}
      toolbar={(
        <>
          <FilterChips
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: 'All', count: people.length },
              { id: 'house', label: 'In-house', count: house.length },
              { id: 'vendor', label: 'Vendor staff', count: staff.length },
              { id: 'wait', label: 'Not signed in yet', count: waiting.length },
            ]}
          />
          <SearchBox value={q} onChange={setQ} placeholder="Find a name or email…" />
          <span className="stl-spacer" />
          <select className="form-input" value={vendorFilter} onChange={e => setVendorFilter(e.target.value)} aria-label="Filter by vendor">
            <option value="all">All vendors</option>
            <option value="house">In-house</option>
            <option value="unassigned">Unassigned</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </>
      )}
    >
      {loading && <SkeletonTable rows={4} label="Loading staff…" />}
      {error && <p className="error">{error}</p>}
      {!loading && !error && (
        <SettingsList columns={COLS} head={['Name', 'Email', 'Role', 'Vendor', 'Status', '']}>
          {shown.length === 0 && <ListEmpty>{people.length ? 'Nobody matches.' : 'No staff yet. Add the first one.'}</ListEmpty>}
          {vendorRows.length > 0 && <ListGroup title="Vendor staff" />}
          {vendorRows.map(row)}
          {houseRows.length > 0 && <ListGroup title="In-house team · shown for reference" />}
          {houseRows.map(row)}
        </SettingsList>
      )}
      {rowError && <p className="error">{rowError}</p>}
      {panel?.mode === 'add' && (
        <SlideOver
          title="Add a staff member"
          sub="Creates their login. Everything here is required."
          onClose={() => setPanel(null)}
          onSubmit={save}
          submitLabel="Add staff member"
          busy={busy}
          error={panelError}
        >
          <Field id="st-staff-vendor" label="Vendor">
            <select id="st-staff-vendor" className="form-input" value={form.vendorId} onChange={e => set('vendorId', e.target.value)} disabled={vendorsLoading} required>
              <option value="" disabled>{vendorsLoading ? 'Loading…' : 'Select a vendor…'}</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
            </select>
          </Field>
          <div className="stl-field" role="radiogroup" aria-labelledby="st-staff-role">
            <span className="stl-label" id="st-staff-role">Role <span className="stl-req" aria-hidden="true">*</span></span>
            <span className="stl-radios">
              {ROLE_OPTIONS.map(o => (
                <label key={o.value}>
                  <input type="radio" name="st-role" value={o.value} checked={form.role === o.value} onChange={() => set('role', o.value)} />
                  {o.label}
                </label>
              ))}
            </span>
          </div>
          <Field id="st-staff-email" label="Email" help="Their login." error={form.email && !emailOk ? 'That doesn’t look like an email address.' : ''}>
            <input id="st-staff-email" className={`form-input${form.email && !emailOk ? ' is-bad' : ''}`} type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="name@vendor.com" autoComplete="off" required />
          </Field>
          <Field id="st-staff-name" label="Full name" help="Shown on sessions and reports.">
            <input id="st-staff-name" className="form-input" value={form.fullName} onChange={e => set('fullName', e.target.value)} placeholder="Full name" autoComplete="off" required />
          </Field>
          <Field id="st-staff-pw" label="Temporary password" help="At least 8 characters. Hand it over; they change it at first login." error={form.password && form.password.length < 8 ? 'At least 8 characters.' : ''}>
            <span className="stl-inline">
              <input id="st-staff-pw" className="form-input stl-mono" value={form.password} onChange={e => set('password', e.target.value)} autoComplete="off" required />
              <button type="button" className="ghost" onClick={() => set('password', generateTempPassword())}>Generate</button>
            </span>
          </Field>
        </SlideOver>
      )}
      {panel?.mode === 'vendor' && (
        <SlideOver
          title={`Change vendor for ${panel.person.full_name || panel.person.email}`}
          sub="Their sessions stay as they are."
          onClose={() => setPanel(null)}
          onSubmit={save}
          submitLabel="Save"
          busy={busy}
          error={panelError}
        >
          <Field id="st-staff-move" label="Vendor">
            <select id="st-staff-move" className="form-input" value={form.vendorId} onChange={e => set('vendorId', e.target.value)} required>
              <option value="" disabled>Select a vendor…</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
            </select>
          </Field>
        </SlideOver>
      )}
      {toast.node}
    </SettingsFrame>
  );
}
