import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import TopBar from '../components/TopBar.jsx';
import { SkeletonCards } from '../components/Skeleton.jsx';
import { PrepPoolBody, PrepPoolActions } from '../components/prep/PrepPool.jsx';
import { useVendors } from '../hooks/useVendors.js';
import { usePrepPools } from '../hooks/usePrepPools.js';
import { usePrepPool } from '../hooks/usePrepPool.js';
import { WORKBOOK_PREP_KIND, ASSESSMENT_PREP_KIND } from '../hooks/useContentPrep.js';
import { isSuperTrainerOrAbove } from '../lib/roles.js';
import { LOW_PREP_THRESHOLD, needsStock } from '../lib/prepPools.js';
import '../styles/dashboard.css';
import '../styles/prep.css';
import '../styles/prep-page.css';

// Prep, in the cockpit — the same shape as Workbooks, Assessments and Sessions.
//
// THE QUESTION THIS PAGE EXISTS TO ANSWER is "which pool needs stocking", and
// the old page could not answer it: a list per kind behind two tabs, one number
// per row, and the pools that were empty sat on whichever tab you were not on.
// So workbooks and assessments share one grid, and the gauge strip is the
// cross-pool roll-up.
//
// A POOL OPENS IN PLACE, not in the 380px panel the other libraries use. The
// kit grid is one column per exercise and runs past 1,100px; pasting kits and
// the bulk edit sheet are full-width jobs too. So a card swaps the pane for the
// pool, the way the question bank drills into a bank.
//
// THE URL IS THE STATE for which pool is open (?kind=&parent=&vendor=). The
// pop-up's "⤢ Full page" and any saved link land on the pool, and the browser's
// Back button returns to the list — which a useState drill-down would not do.
//
// NO PAGE HEADING and no explanatory line: the rail and the app bar both
// already say Prep.
const PREP_KIND = { workbook: WORKBOOK_PREP_KIND, assessment: ASSESSMENT_PREP_KIND };
const KIND_LABEL = { workbook: 'Workbook', assessment: 'Assessment' };
// The side menu's own glyphs, so a group reads as the same thing it is there.
const KIND_ICON = { workbook: '▥', assessment: '✎' };
const EDITOR = { workbook: '/trainer/workbooks/', assessment: '/trainer/assessments/' };

export default function PrepPage() {
  const { profile } = useAuth();
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  const { vendors } = useVendors();
  const [sp, setSp] = useSearchParams();

  const vendorParam = sp.get('vendor') || '';
  const parentId = sp.get('parent') || '';

  // Super chooses a pool ('' = the shared super pool); vendor tiers are locked
  // to their own. Super can write only to the super pool — a vendor's is
  // balance-only.
  const partitionVendorId = isSuper ? (vendorParam || null) : (profile?.vendor_id || null);
  const canWrite = isSuper ? partitionVendorId == null : !!profile?.vendor_id;
  const poolName = partitionVendorId
    ? (vendors.find(v => v.id === partitionVendorId)?.name || 'Vendor')
    : 'Super (shared)';

  const { loading, pools, sessionsById } = usePrepPools(partitionVendorId);

  function openPool(p) {
    const next = new URLSearchParams();
    next.set('kind', p.kind);
    next.set('parent', p.id);
    if (vendorParam) next.set('vendor', vendorParam);
    setSp(next);
  }
  function backToList() {
    setSp(vendorParam ? { vendor: vendorParam } : {});
  }
  // The picker replaces rather than pushes: flicking between pools should not
  // leave a trail of history entries to back out of.
  function changeVendor(id) {
    const next = new URLSearchParams(sp);
    if (id) next.set('vendor', id); else next.delete('vendor');
    setSp(next, { replace: true });
  }

  const poolPicker = isSuper && (
    <label className="prep-poolpick">
      Pool
      <select className="form-input" value={vendorParam} onChange={e => changeVendor(e.target.value)}>
        <option value="">Super (shared)</option>
        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
    </label>
  );

  // Matched on the id alone: ids are uuids, unique across both tables, and a
  // link that names the pool but not its kind should still open it.
  const open = parentId ? pools.find(p => p.id === parentId) || null : null;

  return (
    <>
      <TopBar />
      <main className="page dashboard library-page prep-cockpit">
        {parentId ? (
          loading ? <SkeletonCards count={3} label="Loading pool…" />
            : open ? (
              <PoolView
                pool={open}
                vendorId={partitionVendorId}
                canWrite={canWrite}
                poolName={poolName}
                sessionsById={sessionsById}
                editorTo={isSuper ? `${EDITOR[open.kind]}${open.id}` : null}
                onBack={backToList}
              />
            ) : (
              <>
                <button type="button" className="back-link back-link-btn" onClick={backToList}>&larr; All pools</button>
                <p className="cockpit-empty">That pool is not here. It may have been removed.</p>
              </>
            )
        ) : (
          <Landing
            loading={loading}
            pools={pools}
            canWrite={canWrite}
            poolName={poolName}
            poolPicker={poolPicker}
            isSuper={isSuper}
            onOpen={openPool}
          />
        )}
      </main>
    </>
  );
}

function plural(n, word, many = `${word}s`) { return `${n} ${n === 1 ? word : many}`; }

function Landing({ loading, pools, canWrite, poolName, poolPicker, isSuper, onOpen }) {
  const [filter, setFilter] = useState('all');   // 'all' | 'need' | 'ok' | 'noprep'
  const [find, setFind] = useState('');

  // Everything the strip and the tabs need, in one pass.
  const stats = useMemo(() => {
    const s = { ready: 0, held: 0, stranded: 0, used: 0, withdrawn: 0, empty: 0, low: 0, ok: 0, noprep: 0 };
    const heldClasses = new Set();
    const readyPools = [];
    for (const p of pools) {
      s[p.state]++;
      if (p.state === 'noprep') continue;
      s.ready += p.summary.fullyPreppable;
      s.held += p.summary.held;
      s.stranded += p.summary.stranded;
      s.used += p.summary.used;
      s.withdrawn += p.summary.withdrawn;
      p.summary.heldSessionIds.forEach(id => heldClasses.add(id));
      if (p.summary.fullyPreppable > 0) readyPools.push(p);
    }
    return { ...s, heldClasses: heldClasses.size, readyPools, need: s.empty + s.low, pools: pools.length - s.noprep };
  }, [pools]);

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return pools.filter(p => {
      if (filter === 'need' && !needsStock(p.state)) return false;
      if (filter === 'ok' && p.state !== 'ok') return false;
      if (filter === 'noprep' && p.state !== 'noprep') return false;
      if (!q) return true;
      return `${p.title} ${p.program || ''}`.toLowerCase().includes(q);
    });
  }, [pools, filter, find]);

  return (
    <>
      <section className="page-hero compact cockpit-hero">
        <div className="cockpit-hero-row">
          <div className="view-tabs" role="group" aria-label="Show pools">
            {[
              ['all', 'All', pools.length],
              ['need', 'Needs stock', stats.need],
              ['ok', 'Stocked', stats.ok],
              ['noprep', 'No prep', stats.noprep],
            ].map(([k, label, n]) => (
              <button
                key={k}
                type="button"
                className={`view-tab ${filter === k ? 'active' : ''}${k === 'need' && n > 0 ? ' is-warn' : ''}`}
                aria-pressed={filter === k}
                onClick={() => setFilter(k)}
              >
                {label} · <span className="view-tab-count">{n}</span>
              </button>
            ))}
          </div>
          <div className="page-hero-actions">
            <input
              type="search"
              className="form-input wb-find"
              placeholder="Find a pool…"
              aria-label="Find a pool"
              value={find}
              onChange={e => setFind(e.target.value)}
            />
            {poolPicker}
          </div>
        </div>
      </section>

      {isSuper && !canWrite && (
        <p className="prep-readonly">
          Viewing {poolName}’s balance (read-only). You can upload only to the <strong>Super (shared)</strong> pool.
        </p>
      )}

      {loading && <SkeletonCards count={6} label="Loading prep pools…" />}

      {!loading && pools.length > 0 && (
        <section className="cockpit-gauges wb-gauges" aria-label="Prep at a glance">
          <div className="cockpit-gauge">
            <div>
              <div className="cockpit-gauge-label">Pools</div>
              <div className="cockpit-gauge-value">{stats.pools}<small> / {pools.length}</small></div>
              <div className="cockpit-gauge-hint">
                {stats.noprep ? `${plural(stats.noprep, 'template')} need${stats.noprep === 1 ? 's' : ''} no prep` : 'every template takes prep'}
              </div>
            </div>
          </div>
          <div className="cockpit-gauge">
            <div>
              <div className="cockpit-gauge-label">Ready</div>
              <div className={`cockpit-gauge-value${stats.ready ? ' state-open' : ' is-muted'}`}>{stats.ready}<small> kits</small></div>
              <div className="cockpit-gauge-hint">
                {stats.readyPools.length === 0 ? 'nothing to hand out'
                  : stats.readyPools.length === 1 ? `all in ${stats.readyPools[0].title}`
                    : `across ${stats.readyPools.length} pools`}
              </div>
            </div>
          </div>
          {/* A pool that cannot prep a class is the fault on this page — the
              one gauge allowed the red edge. The line is LOW_PREP_THRESHOLD,
              the same one the Prep badge and the home banner use. */}
          <div className={`cockpit-gauge ${stats.need > 0 ? 'is-bad' : ''}`}>
            <div>
              <div className="cockpit-gauge-label">Need stock</div>
              <div className={`cockpit-gauge-value${stats.need ? ' state-expired' : ' is-muted'}`}>{stats.need}<small> pool{stats.need === 1 ? '' : 's'}</small></div>
              <div className="cockpit-gauge-hint">
                {stats.need ? `${stats.empty} empty · ${stats.low} under ${LOW_PREP_THRESHOLD}` : `every pool has ${LOW_PREP_THRESHOLD} or more`}
              </div>
            </div>
          </div>
          <div className="cockpit-gauge">
            <div>
              <div className="cockpit-gauge-label">In classes</div>
              <div className={`cockpit-gauge-value${stats.held ? '' : ' is-muted'}`}>{stats.held}<small> kits</small></div>
              <div className="cockpit-gauge-hint">
                {stats.held ? `held by ${plural(stats.heldClasses, 'class', 'classes')}` : 'no class holds a kit'}
              </div>
            </div>
          </div>
          <div className={`cockpit-gauge ${stats.stranded > 0 ? 'is-warn' : ''}`}>
            <div>
              <div className="cockpit-gauge-label">Held by no class</div>
              <div className={`cockpit-gauge-value${stats.stranded ? '' : ' is-muted'}`}>{stats.stranded}<small> kits</small></div>
              <div className="cockpit-gauge-hint">
                {stats.stranded ? 'no class holds them' : 'none'}
              </div>
            </div>
          </div>
          <div className="cockpit-gauge">
            <div>
              <div className="cockpit-gauge-label">Spent</div>
              <div className={`cockpit-gauge-value${stats.used ? '' : ' is-muted'}`}>{stats.used}<small> kits</small></div>
              <div className="cockpit-gauge-hint">
                {stats.used === 0 ? 'none yet'
                  : stats.withdrawn ? `${stats.withdrawn} withdrawn by hand` : 'used by closed classes'}
              </div>
            </div>
          </div>
        </section>
      )}

      {!loading && pools.length === 0 && (
        <p className="cockpit-empty">No workbooks or assessments yet.</p>
      )}

      {!loading && pools.length > 0 && (
        <div className="wb-room">
          <section className="wb-pane">
            {shown.length === 0 && <p className="cockpit-empty">Nothing here with this filter.</p>}

            {shown.length > 0 && (
              <p className="prep-legend" aria-hidden="true">
                <span><i className="prep-seg is-ready" />ready</span>
                <span><i className="prep-seg is-held" />in a class</span>
                <span><i className="prep-seg is-stranded" />held by no class</span>
                <span><i className="prep-seg is-spent" />spent</span>
              </p>
            )}

            {/* Workbooks and assessments are separate pools stocked for
                different things, so each kind is its own band — tint, edge and
                heading — and every card carries its kind's colour, so one seen
                on its own still says which it is. */}
            {['workbook', 'assessment'].map(kind => {
              const list = shown.filter(p => p.kind === kind);
              if (!list.length) return null;
              const ready = list.reduce((n, p) => n + (p.state === 'noprep' ? 0 : p.summary.fullyPreppable), 0);
              const need = list.filter(p => needsStock(p.state)).length;
              return (
                <section key={kind} className={`prep-group prep-group--${kind}`} aria-labelledby={`prep-group-${kind}`}>
                  <header className="prep-group-head">
                    <span className="prep-group-icon" aria-hidden="true">{KIND_ICON[kind]}</span>
                    <h2 className="prep-group-label" id={`prep-group-${kind}`}>{KIND_LABEL[kind]}s</h2>
                    <span className="prep-group-count">{list.length}</span>
                    <span className="prep-group-meta">
                      {plural(ready, 'kit')} ready{need ? ` · ${need} need${need === 1 ? 's' : ''} stock` : ''}
                    </span>
                  </header>
                  <div className="wb-grid">
                    {list.map(p => (
                      <PoolCard key={p.id} pool={p} onOpen={() => onOpen(p)} />
                    ))}
                  </div>
                </section>
              );
            })}
          </section>
        </div>
      )}
    </>
  );
}

const PILL = {
  noprep: ['is-idle', 'no prep'],
  empty: ['is-bad', 'empty'],
  low: ['is-review', 'low'],
  ok: ['is-ok', 'stocked'],
};

// One control, like a workbook card: it opens the pool and does nothing else.
//
// THE CARD CARRIES NO NARRATION. It had a line of facts under the bar — which
// class holds kits, how many closed classes, when it was last drawn from — and
// that was a paragraph to read on every tile of a page meant to be scanned.
// What is left is what the tile is for: the name, the state, how many are ready
// of how many, over how many exercises, and the bar. The rest is one click away
// in the pool, where the gauges say it properly.
function PoolCard({ pool, onOpen }) {
  const { summary: s, state } = pool;
  const [pillClass, pillText] = PILL[state];
  const pct = n => (s.total ? `${(n / s.total) * 100}%` : '0%');

  return (
    <article
      className={`wb-card prep-card prep-card--${pool.kind}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onOpen();
      }}
    >
      <div className="wb-card-body">
        <div className="wb-card-top">
          <h3 className="wb-card-title">{pool.title}</h3>
          <span className={`wb-pill ${pillClass}`}>{state === 'empty' && s.total === 0 ? 'nothing stocked' : pillText}</span>
        </div>
        {pool.program && <p className="prep-card-prog">{pool.program}</p>}

        {state !== 'noprep' && (
          <div className="prep-stock">
            <p className="prep-stock-line">
              <b className={s.fullyPreppable ? '' : 'is-zero'}>{s.fullyPreppable}</b>
              ready of {s.total} · {plural(pool.structure.length, 'exercise')}
            </p>
            <div className="prep-bar-stack" aria-hidden="true">
              <i className="prep-seg is-ready" style={{ width: pct(s.available) }} />
              <i className="prep-seg is-held" style={{ width: pct(s.held) }} />
              <i className="prep-seg is-stranded" style={{ width: pct(s.stranded) }} />
              <i className="prep-seg is-spent" style={{ width: pct(s.used) }} />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

// One pool, in place of the grid. The hero carries the way back, the name and
// the stocking actions; PrepPoolBody draws the gauges and the kit grid.
function PoolView({ pool, vendorId, canWrite, poolName, sessionsById, editorTo, onBack }) {
  const parent = useMemo(
    () => ({ id: pool.id, title: pool.title, prep_template: pool.structure }),
    [pool.id, pool.title, pool.structure],
  );
  const state = usePrepPool(PREP_KIND[pool.kind], parent, vendorId);

  return (
    <>
      <section className="page-hero compact cockpit-hero prep-pool-hero">
        <div className="cockpit-hero-row">
          <div className="page-hero-text">
            <button type="button" className="back-link back-link-btn" onClick={onBack}>&larr; All pools</button>
            <h1>{pool.title}</h1>
            <p className="cockpit-hero-sub">
              <span>{KIND_LABEL[pool.kind]}</span>
              {pool.program && <span>{pool.program}</span>}
              <span>{poolName} pool</span>
            </p>
          </div>
          <div className="page-hero-actions">
            {/* No pool picker here: the line under the title names the pool,
                and the picker's 200px is what pushed that line onto three. */}
            {state.showActions && <PrepPoolActions pool={state} canWrite={canWrite} variant="page" />}
          </div>
        </div>
      </section>

      <PrepPoolBody
        pool={state}
        kind={pool.kind}
        canWrite={canWrite}
        variant="page"
        sessionsById={sessionsById}
        editorTo={editorTo}
      />
    </>
  );
}
