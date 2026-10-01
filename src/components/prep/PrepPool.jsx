import { Link } from 'react-router-dom';
import PrepGrid from './PrepGrid.jsx';
import PrepPasteGrid from './PrepPasteGrid.jsx';
import PrepEditGrid from './PrepEditGrid.jsx';
import { downloadEmptyPrepTemplate } from '../../lib/prepTemplate.js';
import { LOW_PREP_THRESHOLD, incompleteKits } from '../../lib/prepPools.js';
import { classState, shortDate } from '../../lib/programReadiness.js';

// One prep pool, drawn from usePrepPool's state. Two pieces, because the two
// surfaces put them in different places: the pop-up pins the actions in its
// footer, the Prep page carries them in its hero.
//
//   variant 'modal' — the balance card and per-exercise bars, as it always was
//   variant 'page'  — cockpit gauges, with the per-exercise count moved into
//                     the grid's column headings

// kindLabel: 'workbook' | 'assessment' (copy); kind: same, for the grids.
export function PrepPoolBody({ pool, kind, canWrite, variant = 'modal', sessionsById = {}, editorTo = null }) {
  const {
    structure, kits, balance, loading, lastStocked,
    parsing, parseError, parsed, submitting, submitError, notice,
    pasteMode, setPasteMode, editMode, setEditMode,
    payloadRows, gappyRows, matchedHeaders,
    handleConfirm, handlePasteSubmit, handleBulkEdit, resetUpload, setKitStatus,
  } = pool;
  const isPage = variant === 'page';

  if (structure.length === 0) {
    return (
      <>
        <p className="prep-warn">
          No prep template set up for this {kind} yet — {editorTo
            ? <>set it up from <Link to={editorTo}>the {kind}’s editor</Link>.</>
            : <>ask a super trainer to set it up from the {kind}’s editor.</>}
        </p>
        {!loading && balance.total > 0 && (
          <div className="prep-balance"><div className="prep-balance-meta muted">{balance.total} kit(s) in this pool · {balance.available} available</div></div>
        )}
      </>
    );
  }

  if (pasteMode) {
    return (
      <PrepPasteGrid
        structure={structure}
        busy={submitting}
        onCancel={() => setPasteMode(false)}
        onSubmit={handlePasteSubmit}
      />
    );
  }

  if (editMode) {
    return (
      <PrepEditGrid
        kits={kits}
        structure={structure}
        kind={kind}
        busy={submitting}
        onCancel={() => setEditMode(false)}
        onSubmit={handleBulkEdit}
      />
    );
  }

  const maxPerSection = Math.max(1, ...Object.values(balance.perSection).map(p => p.total));

  return (
    <>
      {loading ? <p className="muted">Loading pool…</p> : isPage ? (
        <PoolGauges balance={balance} kits={kits} structure={structure} sessionsById={sessionsById} lastStocked={lastStocked} />
      ) : (
        <div className="prep-balance">
          <div className="prep-balance-headline">
            <strong>{balance.fullyPreppable}</strong> participant{balance.fullyPreppable === 1 ? '' : 's'} can be fully prepped
            <span className="muted"> — the lowest-stocked exercise sets the limit</span>
          </div>
          <div className="prep-balance-meta muted">
            {balance.available} kit{balance.available === 1 ? '' : 's'} available · {balance.allocated} in use{balance.withdrawn ? ` · ${balance.withdrawn} withdrawn` : ''}
            {lastStocked && <> · last stocked {stockedWhen(lastStocked.at)}{lastStocked.by ? ` by ${lastStocked.by}` : ''}</>}
          </div>
          {Object.keys(balance.perSection).length > 0 && (
            <ul className="prep-bars">
              {Object.entries(balance.perSection).map(([sid, p]) => {
                const pct = Math.round((p.available / maxPerSection) * 100);
                const cls = p.available === 0 ? 'none' : p.available < balance.available ? 'low' : 'ok';
                return (
                  <li key={sid} className="prep-bar-row">
                    <span className="prep-bar-label" title={sid}>{sid}</span>
                    <span className={`prep-bar ${cls}`}><span className="prep-bar-fill" style={{ width: `${pct}%` }} /></span>
                    <span className="prep-bar-count">{p.available}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {!loading && balance.total > 0 && (
        <PrepGrid kits={kits} structure={structure} kind={kind}
          readyByHeader={isPage ? readyByHeader(structure, balance) : null}
          onMarkKit={canWrite ? setKitStatus : null}
          onBulkEdit={canWrite ? () => setEditMode(true) : null} />
      )}

      {isPage && !loading && balance.total === 0 && (
        <p className="cockpit-empty">No kits in this pool yet.</p>
      )}

      {!canWrite && (
        <p className="muted">Viewing this vendor’s balance (read-only). You can upload only to the <strong>Super (shared)</strong> pool.</p>
      )}

      {parsing && <p className="muted">Reading file…</p>}
      {parseError && <p className="error">{parseError}</p>}
      {notice && <p className="prep-notice">{notice}</p>}
      {/* A failed Clear has no preview to report into. */}
      {!parsed && submitError && <p className="error">{submitError}</p>}

      {parsed && (
        <div className="prep-preview">
          <h3>Preview</h3>
          {matchedHeaders === 0 ? (
            <p className="error">No columns matched this {kind}’s prep template. Use “Download template” and fill that exact file.</p>
          ) : (
            <>
              <p className="prep-preview-count"><strong>{payloadRows.length}</strong> kit{payloadRows.length === 1 ? '' : 's'} will be added.</p>
              {gappyRows > 0 && (
                <p className="prep-warn">⚠ {gappyRows} kit{gappyRows === 1 ? '' : 's'} {gappyRows === 1 ? 'is' : 'are'} missing a value in at least one prep exercise.</p>
              )}
              {submitError && <p className="error">{submitError}</p>}
              <div className="prep-actions">
                <button type="button" onClick={handleConfirm} disabled={submitting || payloadRows.length === 0}>
                  {submitting ? 'Adding…' : `Add ${payloadRows.length} kit${payloadRows.length === 1 ? '' : 's'}`}
                </button>
                <button type="button" className="ghost" onClick={resetUpload} disabled={submitting}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

// Enter in-app / download / upload / clear. Render only while pool.showActions.
export function PrepPoolActions({ pool, canWrite, variant = 'modal' }) {
  const { parent, structure, balance, parsing, submitting, confirmClear, setConfirmClear, setPasteMode, handleFile, handleClear } = pool;
  const isPage = variant === 'page';
  // On the page these sit in a light hero, where the global button fill would
  // paint them midnight; prep-act restates its own ground.
  const ghost = isPage ? 'prep-act' : 'ghost';
  const upload = canWrite && (
    <label className={`${ghost} prep-upload-btn`}>
      ↑ Upload filled template
      <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} disabled={parsing || submitting} hidden />
    </label>
  );
  const download = (
    <button type="button" className={ghost} onClick={() => downloadEmptyPrepTemplate(parent.title, structure)}>
      ↓ Download template
    </button>
  );
  return (
    <>
      {canWrite && (
        <button type="button" className={isPage ? 'lib-new-btn' : 'ghost prep-paste-btn'} onClick={() => setPasteMode(true)}>
          {isPage ? 'Enter prep in-app' : '✏️ Enter prep in-app'}
        </button>
      )}
      {/* The page leads with the two ways of adding kits; the pop-up keeps the
          order its footer always had. */}
      {isPage && upload}
      {download}
      {!isPage && upload}
      {canWrite && balance.available > 0 && (
        <span className="prep-foot-clear">
          {confirmClear ? (
            <>
              <span className="confirm-text">Delete {balance.available} unconsumed kit{balance.available === 1 ? '' : 's'}?</span>
              <button type="button" className="danger" onClick={handleClear}>Yes</button>
              <button type="button" className={ghost} onClick={() => setConfirmClear(false)}>No</button>
            </>
          ) : (
            <button type="button" className={`${ghost} danger`} onClick={() => setConfirmClear(true)}>Clear unconsumed</button>
          )}
        </span>
      )}
    </>
  );
}

// How many AVAILABLE kits carry a value for each prep column — what the old
// per-exercise bars showed, now read off the column it belongs to.
function readyByHeader(structure, balance) {
  const m = {};
  for (const c of structure) m[c.header] = balance.perSection[c.header]?.available ?? 0;
  return m;
}

// "14:20" in the viewer's own clock.
function timeOf(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
// "30 Sept, 14:20".
function stockedWhen(ts) {
  return `${shortDate(ts)}, ${timeOf(ts)}`;
}

// Calendar days, not elapsed 24-hour blocks: drawn on the 17th and read on the
// 30th is 13 days ago whatever the hour.
function daysAgo(ts) {
  const day = t => { const x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const d = Math.round((day(Date.now()) - day(ts)) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

function PoolGauges({ balance, kits, structure, sessionsById, lastStocked = null }) {
  const ready = balance.fullyPreppable;
  // The column holding the pool back, named — only when one actually is.
  let limit = null;
  if (ready > 0 && ready < balance.available) {
    limit = structure.find(c => (balance.perSection[c.header]?.available ?? 0) === ready)?.header || null;
  }

  const held = balance.heldSessionIds.map(id => sessionsById[id]).filter(Boolean);
  const leftOpen = held.filter(s => classState(s).key === 'ended');
  // One line, and the gauge clips it — so it says the thing to act on (a class
  // past its dates still holding kits) before it says the class's name, which
  // every row of the grid below already carries.
  let heldHint = 'no class holds a kit';
  if (balance.held > 0) {
    const n = balance.heldSessionIds.length;
    if (n === 1) {
      heldHint = leftOpen.length ? `ended ${shortDate(leftOpen[0].ends_at)}, still open` : (held[0]?.name || 'one class');
    } else {
      heldHint = `${n} classes${leftOpen.length ? ` · ${leftOpen.length} left open` : ''}`;
    }
  }

  // Withdrawn kits are left out: nobody will be handed one.
  const incompleteLive = incompleteKits(kits, structure).filter(k => k.status !== 'used').length;

  return (
    <section className="cockpit-gauges wb-gauges" aria-label="This pool at a glance">
      <div className={`cockpit-gauge ${ready === 0 ? 'is-bad' : ready < LOW_PREP_THRESHOLD ? 'is-warn' : ''}`}>
        <div>
          <div className="cockpit-gauge-label">Ready</div>
          <div className={`cockpit-gauge-value${ready === 0 ? ' state-expired' : ''}`}>{ready}<small> of {balance.total}</small></div>
          <div className="cockpit-gauge-hint">
            {ready === 0 ? 'nobody can be fully prepped'
              : limit ? `${limit} sets the limit`
                : 'can be fully prepped'}
          </div>
        </div>
      </div>
      <div className={`cockpit-gauge ${leftOpen.length ? 'is-warn' : ''}`}>
        <div>
          <div className="cockpit-gauge-label">In a class</div>
          <div className={`cockpit-gauge-value${balance.held ? '' : ' is-muted'}`}>{balance.held}</div>
          <div className="cockpit-gauge-hint">{heldHint}</div>
        </div>
      </div>
      {/* Allocated, with no class to be allocated to. Only drawn when there
          are some: it is a fault to fix, not a standing figure. */}
      {balance.stranded > 0 && (
        <div className="cockpit-gauge is-warn">
          <div>
            <div className="cockpit-gauge-label">Held by no class</div>
            <div className="cockpit-gauge-value">{balance.stranded}</div>
            <div className="cockpit-gauge-hint">no class holds them</div>
          </div>
        </div>
      )}
      {/* No Spent gauge: kits spent by closed classes are not loaded
          (lib/prepPools.js, LIVE_KITS_FILTER). Withdrawn-by-hand kits are the
          only used ones left; they get a gauge only when there are some. */}
      {balance.withdrawn > 0 && (
        <div className="cockpit-gauge">
          <div>
            <div className="cockpit-gauge-label">Withdrawn</div>
            <div className="cockpit-gauge-value">{balance.withdrawn}</div>
            <div className="cockpit-gauge-hint">by hand, can be restored</div>
          </div>
        </div>
      )}
      <div className={`cockpit-gauge ${incompleteLive ? 'is-warn' : ''}`}>
        <div>
          <div className="cockpit-gauge-label">Incomplete</div>
          <div className={`cockpit-gauge-value${incompleteLive ? '' : ' is-muted'}`}>{incompleteLive}<small> kit{incompleteLive === 1 ? '' : 's'}</small></div>
          <div className="cockpit-gauge-hint">
            {incompleteLive === 0 ? 'every kit is complete' : 'missing a value in a column'}
          </div>
        </div>
      </div>
      {/* Read off the kits still loaded, i.e. the classes still open: once a
          class closes, its draws leave this page with its kits. */}
      {/* When kits were last ADDED to this pool, and by whom — the newest kit's
          created_at and stocked_by_name (filled in by the database on insert). */}
      <div className="cockpit-gauge">
        <div>
          <div className="cockpit-gauge-label">Last stocked</div>
          <div className={`cockpit-gauge-value${lastStocked ? '' : ' is-muted'}`}>{lastStocked ? shortDate(lastStocked.at) : '—'}</div>
          <div className="cockpit-gauge-hint" data-tip={lastStocked ? `${stockedWhen(lastStocked.at)}${lastStocked.by ? ` by ${lastStocked.by}` : ''}` : undefined}>
            {!lastStocked ? 'never stocked'
              : [timeOf(lastStocked.at), lastStocked.by ? `by ${lastStocked.by}` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>
      <div className="cockpit-gauge">
        <div>
          <div className="cockpit-gauge-label">Last drawn</div>
          <div className={`cockpit-gauge-value${balance.lastDrawn ? '' : ' is-muted'}`}>{balance.lastDrawn ? shortDate(balance.lastDrawn) : '—'}</div>
          <div className="cockpit-gauge-hint">{balance.lastDrawn ? daysAgo(balance.lastDrawn) : 'no open class has drawn'}</div>
        </div>
      </div>
    </section>
  );
}
