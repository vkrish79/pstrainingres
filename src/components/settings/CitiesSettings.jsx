import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SkeletonTable } from '../Skeleton.jsx';
import KebabMenu from '../KebabMenu.jsx';
import { useCities, CITY_CODE_PATTERN } from '../../hooks/useCities.js';
import { useSettingsUsage } from '../../hooks/useSettingsUsage.js';
import {
  SettingsFrame, Glance, FilterChips, SearchBox, SettingsList, ListRow, ListEmpty,
  Grip, SlideOver, Field, useSettingsToast, useDragReorder, plural,
} from './SettingsFrame.jsx';

// Settings → Cities / venues. Mirrors Program types, but carries an immutable
// `code` — the value stored on every session, which is why it can be set once
// and never renamed. A city whose name is just its code ("BLR") reads as
// "BLR (BLR)" in pickers, so those are flagged.
const COLS = '30px 76px minmax(0, 1.6fr) minmax(0, 1.4fr) 96px 40px';

export default function CitiesSettings() {
  const { loading, error, cities, createCity, renameCity, setActive, moveCity } = useCities({ includeInactive: true });
  const { usage } = useSettingsUsage();
  const toast = useSettingsToast();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [panel, setPanel] = useState(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [rowError, setRowError] = useState('');
  const drag = useDragReorder(cities, moveCity, setRowError);

  const used = c => usage?.sessionsByCity[c.code] || 0;
  const bare = cities.filter(c => c.name.trim().toUpperCase() === c.code);
  const shown = useMemo(() => cities.filter(c =>
    (filter === 'all' || (filter === 'on' ? c.is_active : !c.is_active))
    && `${c.code} ${c.name}`.toLowerCase().includes(q.trim().toLowerCase())), [cities, filter, q]);

  const codeOk = CITY_CODE_PATTERN.test(code.trim().toUpperCase());
  function open(mode, city) {
    setPanel({ mode, city }); setPanelError('');
    setCode(city?.code || '');
    setName(city && city.name.trim().toUpperCase() !== city.code ? city.name : '');
  }
  async function save() {
    if (panel.mode === 'add' && !codeOk) { setPanelError('Code must be 2–6 capital letters or digits, like AUH.'); return; }
    if (!name.trim()) { setPanelError('Name is required.'); return; }
    setBusy(true);
    const { error: err } = panel.mode === 'add' ? await createCity(code, name) : await renameCity(panel.city.id, name);
    setBusy(false);
    if (err) { setPanelError(err.message); return; }
    toast.show(panel.mode === 'add' ? `Added ${code.trim().toUpperCase()} · ${name.trim()}` : `Saved ${name.trim()}`);
    setPanel(null);
  }
  async function toggle(c) {
    setRowError('');
    const { error: err } = await setActive(c.id, !c.is_active);
    if (err) { setRowError(err.message); return; }
    toast.show(`${c.is_active ? 'Deactivated' : 'Activated'} ${c.name}`, async () => {
      const { error: e2 } = await setActive(c.id, c.is_active);
      if (e2) setRowError(e2.message);
    });
  }

  const noCity = usage?.noCity || [];
  return (
    <SettingsFrame
      title="Cities & venues"
      note="Picked when a session is created (required) and grouped by in Analytics. The code is stored on each session and can't change once added; deactivating a city hides it from the picker while keeping it on past sessions."
      addLabel="+ Add city"
      onAdd={() => open('add')}
      glance={!loading && !error && (
        <>
          <Glance label="Cities" value={cities.length} hint={`${cities.filter(c => c.is_active).length} active · ${cities.filter(c => !c.is_active).length} inactive`} />
          <Glance label="Sessions" value={usage ? Object.values(usage.sessionsByCity).reduce((a, b) => a + b, 0) : '–'} hint={usage ? `in ${plural(Object.keys(usage.sessionsByCity).length, 'city', 'cities')}` : ''} />
          <Glance label="Need a full name" value={bare.length} hint={bare.map(c => c.code).join(', ') || 'None'} alert />
          <Glance
            label="Sessions with no city"
            value={usage ? noCity.length : '–'}
            alert
            hint={noCity.length
              ? <>{noCity.slice(0, 2).map((s, i) => <span key={s.id}>{i ? ', ' : ''}<Link to={`/trainer/sessions/${s.id}`}>{s.name}</Link></span>)}{noCity.length > 2 ? ` +${noCity.length - 2}` : ''}</>
              : 'None. New sessions need one.'}
          />
        </>
      )}
      toolbar={(
        <>
          <FilterChips
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: 'All', count: cities.length },
              { id: 'on', label: 'Active', count: cities.filter(c => c.is_active).length },
              { id: 'off', label: 'Inactive', count: cities.filter(c => !c.is_active).length },
            ]}
          />
          <SearchBox value={q} onChange={setQ} placeholder="Find a city or code…" />
        </>
      )}
    >
      {loading && <SkeletonTable rows={5} label="Loading cities…" />}
      {error && <p className="error">{error}</p>}
      {!loading && !error && (
        <SettingsList columns={COLS} head={['', 'Code', 'Name', 'Used by', 'Status', '']}>
          {shown.length === 0 && <ListEmpty>{cities.length ? 'Nothing matches.' : 'No cities yet. Add the first one.'}</ListEmpty>}
          {shown.map(c => {
            const isBare = c.name.trim().toUpperCase() === c.code;
            return (
              <ListRow key={c.id} off={!c.is_active} {...drag.rowProps(c)}>
                <Grip label={`Move ${c.name}`} onKeyMove={dir => moveCity(c.id, dir).then(r => r?.error && setRowError(r.error.message))} {...drag.gripProps(c)} />
                <span className="stl-code">{c.code}</span>
                <span className="stl-name">
                  {c.name}
                  {isBare && <small className="is-hint">Add the full name</small>}
                </span>
                <span className={`stl-uses${usage && !used(c) ? ' is-none' : ''}`}>
                  {!usage ? '–' : used(c) ? <b>{plural(used(c), 'session')}</b> : 'No sessions yet'}
                </span>
                <span className={`stl-pill ${c.is_active ? 'is-on' : 'is-off'}`}>{c.is_active ? 'Active' : 'Inactive'}</span>
                <span className="stl-actions">
                  <KebabMenu
                    label={`Actions for ${c.name}`}
                    items={[
                      { label: isBare ? 'Add the full name…' : 'Rename…', glyph: '✎', onClick: () => open('edit', c) },
                      { separator: true },
                      c.is_active
                        ? { label: 'Deactivate', glyph: '⊘', onClick: () => toggle(c) }
                        : { label: 'Activate', glyph: '↺', onClick: () => toggle(c) },
                    ]}
                  />
                </span>
              </ListRow>
            );
          })}
        </SettingsList>
      )}
      {rowError && <p className="error">{rowError}</p>}
      {panel && (
        <SlideOver
          title={panel.mode === 'add' ? 'Add a city or venue' : `Edit ${panel.city.code}`}
          sub={panel.mode === 'add' ? 'It appears in the session form straight away.' : 'Sessions keep the code; the name changes everywhere.'}
          onClose={() => setPanel(null)}
          onSubmit={save}
          submitLabel={panel.mode === 'add' ? 'Add city' : 'Save'}
          busy={busy}
          error={panelError}
        >
          <Field
            id="st-city-code"
            label="Code"
            help={panel.mode === 'add' ? '2–6 capital letters or digits, usually the airport code. It can’t change once added.' : 'Locked: every session stores it.'}
            error={panel.mode === 'add' && code && !codeOk ? 'Use 2–6 capital letters or digits, like AUH.' : ''}
          >
            <input id="st-city-code" className={`form-input stl-mono${panel.mode === 'add' && code && !codeOk ? ' is-bad' : ''}`} value={code}
              onChange={e => setCode(e.target.value.toUpperCase().slice(0, 6))} disabled={panel.mode !== 'add'} placeholder="AUH" autoComplete="off" required />
          </Field>
          <Field id="st-city-name" label="Name" help={'Shown in the session form and on the report’s City line.'}>
            <input id="st-city-name" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="Abu Dhabi" autoComplete="off" required />
          </Field>
        </SlideOver>
      )}
      {toast.node}
    </SettingsFrame>
  );
}
