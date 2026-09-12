import { useSearchParams } from 'react-router-dom';
import ProgramTypesSettings from '../components/settings/ProgramTypesSettings.jsx';
import CitiesSettings from '../components/settings/CitiesSettings.jsx';
import RetentionSettings from '../components/settings/RetentionSettings.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';

// Super-tier settings hub.
//
// One section at a time. Stacked, the three lists ran to three screens and
// nothing but scrolling told you the third one existed.
//
// The tab is in the URL (?tab=cities), so a settings screen can be linked to
// and survives a refresh — the same thing the session views do with view+month.
const TABS = [
  { id: 'types', label: 'Program types', render: () => <ProgramTypesSettings /> },
  { id: 'cities', label: 'Cities & venues', render: () => <CitiesSettings /> },
  { id: 'retention', label: 'Data retention', render: () => <RetentionSettings /> },
];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const active = TABS.some(t => t.id === requested) ? requested : TABS[0].id;

  return (
    <>
      <TopBar />
      <main className="page">
        {/* No hero — the app bar and the rail both say Settings. */}
        <div className="view-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`view-tab ${active === t.id ? 'active' : ''}`}
              onClick={() => setParams(t.id === TABS[0].id ? {} : { tab: t.id }, { replace: true })}
            >
              {t.label}
            </button>
          ))}
        </div>

        {TABS.find(t => t.id === active).render()}
      </main>
    </>
  );
}
