import { useMemo, useState } from 'react';
import { SkeletonTable } from '../Skeleton.jsx';
import KebabMenu from '../KebabMenu.jsx';
import { useProgramTypes } from '../../hooks/useProgramTypes.js';
import { useSettingsUsage } from '../../hooks/useSettingsUsage.js';
import {
  SettingsFrame, Glance, FilterChips, SearchBox, SettingsList, ListRow, ListEmpty,
  Grip, SlideOver, Field, useSettingsToast, useDragReorder, plural,
} from './SettingsFrame.jsx';

// Settings → Program types. The list a program is created against and that
// Analytics groups by. Deactivating a type hides it from the picker while
// keeping it on the programs and sessions that already use it; there is no
// delete, as before.
const COLS = '30px minmax(0, 1.6fr) minmax(0, 2fr) 96px 40px';

export default function ProgramTypesSettings() {
  const { loading, error, types, createType, renameType, setActive, moveType } = useProgramTypes({ includeInactive: true });
  const { usage } = useSettingsUsage();
  const toast = useSettingsToast();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [panel, setPanel] = useState(null); // { mode: 'add' } | { mode: 'edit', type }
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [rowError, setRowError] = useState('');
  const drag = useDragReorder(types, moveType, setRowError);

  const progs = id => usage?.programsByType[id] || 0;
  const sess = id => usage?.sessionsByType[id] || 0;
  const shown = useMemo(() => types.filter(t =>
    (filter === 'all' || (filter === 'on' ? t.is_active : !t.is_active))
    && t.name.toLowerCase().includes(q.trim().toLowerCase())), [types, filter, q]);
  const unused = usage ? types.filter(t => !progs(t.id)) : [];

  function open(mode, type) { setPanel({ mode, type }); setName(type?.name || ''); setPanelError(''); }
  async function save() {
    if (!name.trim()) { setPanelError('Name is required.'); return; }
    setBusy(true);
    const { error: err } = panel.mode === 'add' ? await createType(name) : await renameType(panel.type.id, name);
    setBusy(false);
    if (err) { setPanelError(err.message); return; }
    toast.show(panel.mode === 'add' ? `Added ${name.trim()}` : `Renamed to ${name.trim()}`);
    setPanel(null);
  }
  async function toggle(t) {
    setRowError('');
    const { error: err } = await setActive(t.id, !t.is_active);
    if (err) { setRowError(err.message); return; }
    toast.show(`${t.is_active ? 'Deactivated' : 'Activated'} ${t.name}`, async () => {
      const { error: e2 } = await setActive(t.id, t.is_active);
      if (e2) setRowError(e2.message);
    });
  }

  return (
    <SettingsFrame
      title="Program types"
      note="Chosen when a program is created and grouped by in Analytics. Drag to set the order the picker shows. Deactivating a type hides it from the picker while keeping it on the programs and sessions that already use it."
      addLabel="+ Add type"
      onAdd={() => open('add')}
      glance={!loading && !error && (
        <>
          <Glance label="Types" value={types.length} hint={`${types.filter(t => t.is_active).length} active`} />
          <Glance label="In use" value={usage ? types.length - unused.length : '–'} hint={usage ? `by ${plural(Object.values(usage.programsByType).reduce((a, b) => a + b, 0), 'program')}` : ''} />
          <Glance label="Not used yet" value={usage ? unused.length : '–'} hint={unused.map(t => t.name).join(', ')} />
        </>
      )}
      toolbar={(
        <>
          <FilterChips
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: 'All', count: types.length },
              { id: 'on', label: 'Active', count: types.filter(t => t.is_active).length },
              { id: 'off', label: 'Inactive', count: types.filter(t => !t.is_active).length },
            ]}
          />
          <SearchBox value={q} onChange={setQ} placeholder="Find a type…" />
        </>
      )}
    >
      {loading && <SkeletonTable rows={4} label="Loading program types…" />}
      {error && <p className="error">{error}</p>}
      {!loading && !error && (
        <SettingsList columns={COLS} head={['', 'Name', 'Used by', 'Status', '']}>
          {shown.length === 0 && <ListEmpty>{types.length ? 'Nothing matches.' : 'No program types yet. Add the first one.'}</ListEmpty>}
          {shown.map(t => (
            <ListRow key={t.id} off={!t.is_active} {...drag.rowProps(t)}>
              <Grip label={`Move ${t.name}`} onKeyMove={dir => moveType(t.id, dir).then(r => r?.error && setRowError(r.error.message))} {...drag.gripProps(t)} />
              <span className="stl-name">{t.name}</span>
              <span className={`stl-uses${usage && !progs(t.id) ? ' is-none' : ''}`}>
                {!usage ? '–' : progs(t.id) ? <><b>{plural(progs(t.id), 'program')}</b> · {plural(sess(t.id), 'session')}</> : 'Not used yet'}
              </span>
              <span className={`stl-pill ${t.is_active ? 'is-on' : 'is-off'}`}>{t.is_active ? 'Active' : 'Inactive'}</span>
              <span className="stl-actions">
                <KebabMenu
                  label={`Actions for ${t.name}`}
                  items={[
                    { label: 'Rename…', glyph: '✎', onClick: () => open('edit', t) },
                    { separator: true },
                    t.is_active
                      ? { label: 'Deactivate', glyph: '⊘', onClick: () => toggle(t) }
                      : { label: 'Activate', glyph: '↺', onClick: () => toggle(t) },
                  ]}
                />
              </span>
            </ListRow>
          ))}
        </SettingsList>
      )}
      {rowError && <p className="error">{rowError}</p>}
      {panel && (
        <SlideOver
          title={panel.mode === 'add' ? 'Add a program type' : `Rename ${panel.type.name}`}
          sub={panel.mode === 'add' ? 'It appears in the program picker straight away.' : 'Programs and sessions that use it show the new name.'}
          onClose={() => setPanel(null)}
          onSubmit={save}
          submitLabel={panel.mode === 'add' ? 'Add type' : 'Save'}
          busy={busy}
          error={panelError}
        >
          <Field id="st-type-name" label="Name" help="Shown in the program picker and on reports.">
            <input id="st-type-name" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. New joiner" maxLength={60} autoComplete="off" required />
          </Field>
        </SlideOver>
      )}
      {toast.node}
    </SettingsFrame>
  );
}
