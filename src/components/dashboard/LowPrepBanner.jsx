import { useState } from 'react';
import { useLowPrepPools } from '../../hooks/useLowPrepPools.js';
import PrepUploadModal from '../prep/PrepUploadModal.jsx';

// Login-time alert on the trainer home: lists prep pools running low for the
// trainer's partition, with a "Review prep" link into the Prep modal. Dismissible
// (reappears on a fresh load). Renders nothing when no pool is low.
export default function LowPrepBanner({ profile }) {
  const { lowPools } = useLowPrepPools(profile);
  const [dismissed, setDismissed] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);

  if (dismissed || lowPools.length === 0) return null;

  const shown = lowPools.slice(0, 3);
  const summary = shown
    .map(p => `${p.title} — ${p.fullyPreppable === 0 ? 'empty' : `${p.fullyPreppable} left`}`)
    .join(' · ');
  const more = lowPools.length > shown.length ? ` · +${lowPools.length - shown.length} more` : '';

  return (
    <>
      <div className="lowprep-banner" role="alert">
        <span className="lowprep-icon" aria-hidden="true">⚠</span>
        <div className="lowprep-text">
          <strong>Prep running low</strong>
          <span className="lowprep-list">{summary}{more}</span>
        </div>
        <button type="button" className="lowprep-review" onClick={() => setPrepOpen(true)}>Review prep →</button>
        <button type="button" className="icon-btn lowprep-dismiss" onClick={() => setDismissed(true)} aria-label="Dismiss">×</button>
      </div>
      {prepOpen && <PrepUploadModal onClose={() => setPrepOpen(false)} profile={profile} />}
    </>
  );
}
