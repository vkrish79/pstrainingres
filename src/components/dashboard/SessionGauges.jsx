import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useLowPrepPools } from '../../hooks/useLowPrepPools.js';
import PrepUploadModal from '../prep/PrepUploadModal.jsx';
import { relativeDay } from '../../lib/sessionFilters.js';

// The strip that replaced two amber banners.
//
// Both bands said one sentence each and cost about 140px of the first screen
// between them — a third of the space above the list, spent on two facts that
// are each a number. A gauge says the same thing in a tile the eye takes in
// without reading, and the two that are ASKING for something keep their amber
// as an edge rather than as a whole block of the page.
//
// NOTHING LOST A BUTTON. The left-open band's "Show them →" is now the gauge
// itself, which toggles the same `when` filter; the prep band's "Review prep →"
// is now the prep gauge, which opens the same PrepUploadModal. Both were the
// only actions those banners carried.
//
// IT LIVES IN SessionViews, NOT IN THE PAGE. TrainerHomePage renders one of
// three role homes — super, vendor manager, vendor trainer — each with its own
// SessionViews. Putting the strip in the page body would have given it to
// whichever branch I happened to edit and silently left the other two without
// it, which is the kind of thing that only shows up when a vendor trainer says
// "I don't have that".
//
// EVERY NUMBER IS COUNTED ON EVERYTHING LOADED, not on what the filter shows —
// see sessionStats. A strip that re-counts as you filter cannot answer "how
// much is there", which is the only question it is for.
export default function SessionGauges({ stats, when, onWhen }) {
  const { profile } = useAuth();
  const { lowPools } = useLowPrepPools(profile);
  const [prepOpen, setPrepOpen] = useState(false);

  const empty = lowPools.filter(p => p.fullyPreppable === 0).length;
  const low = lowPools.length;

  const showingLate = when === 'late';

  return (
    <>
      <section className="cockpit-gauges session-gauges" aria-label="Sessions at a glance">
        <div className="cockpit-gauge">
          <div>
            <div className="cockpit-gauge-label">Open sessions</div>
            <div className="cockpit-gauge-value">{stats.total}</div>
            <div className="cockpit-gauge-hint">
              {stats.total === 0
                ? 'nothing scheduled'
                : `${stats.programs} program${stats.programs === 1 ? '' : 's'}, ${stats.trainers} trainer${stats.trainers === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>

        <div className="cockpit-gauge">
          <div>
            <div className="cockpit-gauge-label">Running now</div>
            {/* state-open is the cockpit's green and is-muted its grey. A zero
                that looks the same as a three is a number nobody reads. */}
            <div className={`cockpit-gauge-value${stats.running ? ' state-open' : ' is-muted'}`}>
              {stats.running}
            </div>
            <div className="cockpit-gauge-hint">
              {stats.running ? 'in their dates today' : 'nothing in its dates today'}
            </div>
          </div>
        </div>

        <div className="cockpit-gauge">
          <div>
            <div className="cockpit-gauge-label">Next up</div>
            <div className="cockpit-gauge-value gauge-value-sm">
              {stats.next ? relativeDay(stats.next.starts_at) : '—'}
            </div>
            <div className="cockpit-gauge-hint">
              {stats.next?.name || (stats.total ? 'nothing still to start' : 'nothing scheduled')}
            </div>
          </div>
        </div>

        <div className="cockpit-gauge">
          <div>
            <div className="cockpit-gauge-label">People</div>
            <div className="cockpit-gauge-value">{stats.people}</div>
            <div className="cockpit-gauge-hint">
              enrolled across {stats.total === 1 ? 'the one' : `all ${stats.total}`}
            </div>
          </div>
        </div>

        {/* THE TWO THAT ASK FOR SOMETHING ARE THE TWO THAT ARE BUTTONS, and the
            only two that carry an edge. When there is nothing wrong they go
            quiet rather than turning green — a gauge that congratulates you is
            a gauge you stop reading. */}
        <button
          type="button"
          className={`cockpit-gauge cockpit-gauge-button${stats.leftOpen ? ' is-warn' : ''}${showingLate ? ' is-on' : ''}`}
          aria-pressed={showingLate}
          onClick={() => onWhen(showingLate ? 'all' : 'late')}
          disabled={!stats.leftOpen && !showingLate}
        >
          <div>
            <div className="cockpit-gauge-label">Left open</div>
            <div className={`cockpit-gauge-value${stats.leftOpen ? ' state-warn' : ' is-muted'}`}>
              {stats.leftOpen}
            </div>
            <div className="cockpit-gauge-hint">
              {showingLate
                ? 'showing only these — click to clear'
                : stats.leftOpen
                  ? 'ended, nobody closed them →'
                  : 'nothing ended and unclosed'}
            </div>
          </div>
        </button>

        <button
          type="button"
          className={`cockpit-gauge cockpit-gauge-button${low ? ' is-warn' : ''}`}
          onClick={() => setPrepOpen(true)}
        >
          <div>
            <div className="cockpit-gauge-label">Prep</div>
            <div className={`cockpit-gauge-value${low ? ' state-warn' : ' is-muted'}`}>
              {low}
              {empty > 0 && <small> / {empty} empty</small>}
            </div>
            <div className="cockpit-gauge-hint">
              {low
                ? `workbook${low === 1 ? '' : 's'} running low →`
                : 'every pool has enough →'}
            </div>
          </div>
        </button>
      </section>

      {prepOpen && <PrepUploadModal onClose={() => setPrepOpen(false)} profile={profile} />}
    </>
  );
}
