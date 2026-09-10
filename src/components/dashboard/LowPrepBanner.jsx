import { useState } from 'react';
import { useLowPrepPools } from '../../hooks/useLowPrepPools.js';
import PrepUploadModal from '../prep/PrepUploadModal.jsx';

// Login-time alert on the trainer home: says how many prep pools are running
// low for the trainer's partition, with a "Review prep" link into the Prep
// modal. Renders nothing when no pool is low.
//
// NOT DISMISSIBLE. It used to carry an × that hid it until the next page load,
// which is a control that solves nothing: the prep is still low, and the only
// thing dismissing changes is whether you are told. The banner disappears when
// the pools are topped up — that is the way out of it.
export default function LowPrepBanner({ profile }) {
  const { lowPools } = useLowPrepPools(profile);
  const [prepOpen, setPrepOpen] = useState(false);

  if (lowPools.length === 0) return null;

  // ONE SENTENCE, NOT A REPORT.
  //
  // This used to concatenate up to three "Title — empty" clauses with middots
  // and then get cut off by the width of the banner, so the reader got two and
  // a half facts and no count. A banner is a summons: it should say how much is
  // wrong and point at the place that shows it. "Review prep →" is right there,
  // and the modal behind it lists every pool properly.
  const empty = lowPools.filter(p => p.fullyPreppable === 0).length;
  const n = lowPools.length;
  const detail = empty === n
    ? `${n === 1 ? 'is' : 'are'} empty`
    : empty > 0
      ? `${n === 1 ? 'is' : 'are'} running low, ${empty} empty`
      : `${n === 1 ? 'is' : 'are'} running low`;

  return (
    <>
      <div className="lowprep-banner" role="alert">
        <span className="lowprep-icon" aria-hidden="true">⚠</span>
        <div className="lowprep-text">
          <strong>Prep running low</strong>
          <span className="lowprep-list">
            {n} workbook{n === 1 ? '' : 's'} {detail}.
          </span>
        </div>
        <button type="button" className="lowprep-review" onClick={() => setPrepOpen(true)}>Review prep →</button>
      </div>
      {prepOpen && <PrepUploadModal onClose={() => setPrepOpen(false)} profile={profile} />}
    </>
  );
}
