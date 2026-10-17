import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SkeletonTable } from '../Skeleton.jsx';
import KebabMenu from '../KebabMenu.jsx';
import { useVendors, VENDOR_CODE_PATTERN } from '../../hooks/useVendors.js';
import {
  SettingsFrame, Glance, FilterChips, SearchBox, SettingsList, ListRow, ListEmpty,
  RowConfirm, SlideOver, Field, useSettingsToast, plural,
} from './SettingsFrame.jsx';

// Settings → Vendors. Vendors have no order and no active flag: they are
// deleted, and only when nothing points at them. The guard runs first, so a
// vendor with staff or sessions is told why and never offered Delete.
const COLS = '90px minmax(0, 1.6fr) minmax(0, 1.6fr) 120px 40px';

export default function VendorsSettings() {
  const { loading, error, vendors, createVendor, renameVendor, deleteVendor } = useVendors();
  const toast = useSettingsToast();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [panel, setPanel] = useState(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [rowError, setRowError] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const shown = useMemo(() => vendors.filter(v =>
    (filter === 'all' || (filter === 'busy' ? v.session_count > 0 : v.session_count === 0))
    && `${v.code} ${v.name}`.toLowerCase().includes(q.trim().toLowerCase())), [vendors, filter, q]);
  const codeOk = VENDOR_CODE_PATTERN.test(code.trim().toUpperCase());

  function open(mode, vendor) { setPanel({ mode, vendor }); setCode(vendor?.code || ''); setName(vendor?.name || ''); setPanelError(''); }
  async function save() {
    if (panel.mode === 'add' && !codeOk) { setPanelError('Code must be 2–12 capitals, digits or underscores.'); return; }
    if (!name.trim()) { setPanelError('Name is required.'); return; }
    setBusy(true);
    const { error: err } = panel.mode === 'add'
      ? await createVendor({ code: code.trim().toUpperCase(), name })
      : await renameVendor(panel.vendor.id, name);
    setBusy(false);
    if (err) { setPanelError(err.message); return; }
    toast.show(panel.mode === 'add' ? `Added ${name.trim()}` : `Saved ${name.trim()}`);
    setPanel(null);
  }
  function askDelete(v) {
    setRowError('');
    if (v.trainer_count > 0 || v.session_count > 0) {
      const parts = [];
      if (v.trainer_count > 0) parts.push(plural(v.trainer_count, 'trainer'));
      if (v.session_count > 0) parts.push(plural(v.session_count, 'session'));
      setRowError(`${v.name} has ${parts.join(' and ')}. Reassign or remove them before deleting this vendor.`);
      return;
    }
    setConfirmingId(v.id);
  }
  async function handleDelete(v) {
    setConfirmBusy(true);
    const { error: err } = await deleteVendor(v.id);
    setConfirmBusy(false);
    setConfirmingId(null);
    if (err) setRowError(err.message); else toast.show(`Deleted ${v.name}`);
  }

  const trainers = vendors.reduce((n, v) => n + (v.trainer_count || 0), 0);
  const sessions = vendors.reduce((n, v) => n + (v.session_count || 0), 0);
  return (
    <SettingsFrame
      title="Vendors"
      note="Training providers that deliver sessions. The code is locked after creation; a vendor can be deleted only when no staff or sessions belong to it."
      addLabel="+ Add vendor"
      onAdd={() => open('add')}
      glance={!loading && !error && (
        <>
          <Glance label="Vendors" value={vendors.length} hint={`${vendors.filter(v => v.session_count > 0).length} with sessions`} />
          <Glance label="Trainers" value={trainers} hint="across all vendors" />
          <Glance label="Sessions" value={sessions} hint="delivered by vendors" />
        </>
      )}
      toolbar={(
        <>
          <FilterChips
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: 'All', count: vendors.length },
              { id: 'busy', label: 'With sessions', count: vendors.filter(v => v.session_count > 0).length },
              { id: 'idle', label: 'No sessions yet', count: vendors.filter(v => !v.session_count).length },
            ]}
          />
          <SearchBox value={q} onChange={setQ} placeholder="Find a vendor…" />
        </>
      )}
    >
      {loading && <SkeletonTable rows={3} label="Loading vendors…" />}
      {error && <p className="error">{error}</p>}
      {!loading && !error && (
        <SettingsList columns={COLS} head={['Code', 'Name', 'People and sessions', 'Since', '']}>
          {shown.length === 0 && <ListEmpty>{vendors.length ? 'Nothing matches.' : 'No vendors yet. Add the first one.'}</ListEmpty>}
          {shown.map(v => (
            <Fragment key={v.id}>
              <ListRow>
                <span className="stl-code">{v.code}</span>
                <span className="stl-name">{v.name}</span>
                <span className="stl-uses">
                  <b>{plural(v.trainer_count || 0, 'trainer')}</b>
                  {' · '}
                  {v.session_count > 0
                    ? <Link to={`/trainer/vendors/${v.id}/sessions`}>{plural(v.session_count, 'session')}</Link>
                    : 'no sessions yet'}
                </span>
                <span className="stl-uses is-none">
                  {new Date(v.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span className="stl-actions">
                  <KebabMenu
                    label={`Actions for ${v.name}`}
                    items={[
                      { label: 'Rename…', glyph: '✎', onClick: () => open('edit', v) },
                      { separator: true },
                      { label: 'Delete vendor…', glyph: '✕', danger: true, onClick: () => askDelete(v) },
                    ]}
                  />
                </span>
              </ListRow>
              {confirmingId === v.id && (
                <RowConfirm
                  message={`Delete the vendor "${v.name}" (${v.code})? This cannot be undone.`}
                  confirmLabel="Delete vendor"
                  onConfirm={() => handleDelete(v)}
                  onCancel={() => setConfirmingId(null)}
                  busy={confirmBusy}
                />
              )}
            </Fragment>
          ))}
        </SettingsList>
      )}
      {rowError && <p className="error">{rowError}</p>}
      {panel && (
        <SlideOver
          title={panel.mode === 'add' ? 'Add a vendor' : `Rename ${panel.vendor.name}`}
          sub={panel.mode === 'add' ? 'Add its trainers next, on the Staff tab.' : 'Its code stays the same.'}
          onClose={() => setPanel(null)}
          onSubmit={save}
          submitLabel={panel.mode === 'add' ? 'Add vendor' : 'Save'}
          busy={busy}
          error={panelError}
        >
          <Field
            id="st-vendor-code"
            label="Code"
            help={panel.mode === 'add' ? '2–12 capitals, digits or underscores. Locked after creation.' : 'Locked after creation.'}
            error={panel.mode === 'add' && code && !codeOk ? 'Use 2–12 of A–Z, 0–9 or _.' : ''}
          >
            <input id="st-vendor-code" className={`form-input stl-mono${panel.mode === 'add' && code && !codeOk ? ' is-bad' : ''}`} value={code}
              onChange={e => setCode(e.target.value.toUpperCase().slice(0, 12))} disabled={panel.mode !== 'add'} placeholder="ETIHAD" autoComplete="off" required />
          </Field>
          <Field id="st-vendor-name" label="Name">
            <input id="st-vendor-name" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="Etihad Airways" autoComplete="off" required />
          </Field>
        </SlideOver>
      )}
      {toast.node}
    </SettingsFrame>
  );
}
