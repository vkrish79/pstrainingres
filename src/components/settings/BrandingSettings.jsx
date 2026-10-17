import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../../contexts/BusyOverlayContext.jsx';
import { isSuperAdmin } from '../../lib/roles.js';
import {
  KEYS, DEFAULTS, cleanPalette, isHex, darker, readability, fetchPublished,
  startTrying, stopTrying, tryingPalette, adoptPublished,
  FAMILIES, STATUS_KEYS, STATUS_NAMES, STATUS_BANDS, statusShades, statusRules, asColourBlind, hueOfColour,
} from '../../lib/branding.js';
import { SkeletonTable } from '../Skeleton.jsx';
import '../../styles/branding.css';

// Settings → Branding. A super admin changes the app's colours; everyone sees
// them on their next page load. Super trainers see the same screen read-only.
//
// What reaches the screen, and how, is in lib/branding.js. This screen only
// edits a draft, checks people can still read it, and publishes it (always as
// a new row, so earlier versions stay loadable).
//
// STATUS COLOURS: one picker per family (good, needs a look, problem). The
// family's text, background and border shades are worked out from it
// (statusShades) and published with it. Rules: it must stay its colour (a
// red stays a red) and its text must be readable — both block Publish; good
// vs problem for colour-blind viewers and amber vs the gold accent only warn.

const GROUPS = [
  {
    title: 'Brand',
    items: [
      ['midnight', 'Main colour', 'Sidebar, top bar, buttons, headings'],
      ['midnight-hover', 'Main colour, hovered', 'Buttons under the mouse', 'auto'],
      ['gold', 'Accent', 'Underlines, the selected tab, highlights'],
      ['gold-dark', 'Accent for text', 'Gold words and links on white'],
      ['qasr', 'Sand', 'Report label cells, soft chips'],
    ],
  },
  {
    title: 'Surfaces & text',
    items: [
      ['bg', 'Page background', 'Behind every card'],
      ['card', 'Cards', 'Panels, tiles, dialogs'],
      ['text', 'Text', 'Everything you read'],
      ['muted', 'Quiet text', 'Hints, dates, labels'],
      ['border', 'Lines', 'Card edges, table rules'],
    ],
  },
];
// Is the hovered shade the worked-out one? Today's standard pair counts too:
// it predates the formula and is one step off it.
const isAutoHover = p => p['midnight-hover'] === darker(p.midnight)
  || (p.midnight === DEFAULTS.midnight && p['midnight-hover'] === DEFAULTS['midnight-hover']);

const NAMES = Object.fromEntries(GROUPS.flatMap(g => g.items.map(i => [i[0], i[1]])));
const STATUS_USES = {
  good: 'Saved, Pass, Got it, Working',
  look: 'Not sure, Quiet, part-marked, warnings',
  problem: 'Lost, Behind pace, Fail, errors',
};
for (const f of FAMILIES) NAMES[f] = STATUS_NAMES[f];
const ROLE_LABELS = [['', 'Edges, dots'], ['-text', 'Text'], ['-bg', 'Background'], ['-border', 'Border']];

export default function BrandingSettings() {
  const { profile } = useAuth();
  const canEdit = isSuperAdmin(profile?.role);
  const { run: runBusy } = useBusyOverlay();

  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [published, setPublished] = useState(DEFAULTS);
  const [history, setHistory] = useState([]);
  const [draft, setDraft] = useState(DEFAULTS);
  const [autoHover, setAutoHover] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [trying, setTrying] = useState(() => !!tryingPalette());
  const [typed, setTyped] = useState({}); // half-typed codes, so a bad one can be shown as bad
  const [colourBlind, setColourBlind] = useState(false); // preview only

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    const top = await fetchPublished();
    if (top.missing) { setMissing(true); setLoading(false); return; }
    if (top.error) { setLoadError(top.error.message); setLoading(false); return; }
    const { data, error: e } = await supabase
      .from('app_branding')
      .select('id, palette, published_by_name, published_at')
      .order('published_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(6);
    if (e) { setLoadError(e.message); setLoading(false); return; }
    const current = top.row ? cleanPalette(top.row.palette) : DEFAULTS;
    setPublished(current);
    setHistory(data || []);
    setDraft(tryingPalette() || current);
    setAutoHover(isAutoHover(tryingPalette() || current));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const sync = () => setTrying(!!tryingPalette());
    window.addEventListener('brand-try-change', sync);
    return () => window.removeEventListener('brand-try-change', sync);
  }, []);

  const checks = useMemo(() => readability(draft), [draft]);
  const rulesBy = useMemo(() => Object.fromEntries(FAMILIES.map(f => [f, statusRules(f, draft)])), [draft]);
  const statusBad = FAMILIES.flatMap(f => rulesBy[f].filter(r => r[0] === 'bad'));
  const failing = [...checks.filter(c => !c.pass), ...statusBad];
  // Named colours only: a family's worked-out shades travel with it.
  const changed = KEYS.filter(k => NAMES[k] && draft[k] !== published[k]);

  function setColour(k, v) {
    setNotice(''); setError(''); setConfirming(false);
    setDraft(prev => {
      const next = { ...prev, [k]: v.toLowerCase() };
      if (k === 'midnight' && autoHover) next['midnight-hover'] = darker(next.midnight);
      if (FAMILIES.includes(k)) {
        const { deepened, ...shades } = statusShades(k, next[k]);
        void deepened;
        Object.assign(next, shades);
      }
      return next;
    });
  }
  function typeCode(k, v) {
    setTyped(t => ({ ...t, [k]: v }));
    const code = v.trim().startsWith('#') ? v.trim() : `#${v.trim()}`;
    if (isHex(code)) setColour(k, code);
  }
  function toggleAuto(on) {
    setAutoHover(on);
    if (on) setDraft(prev => ({ ...prev, 'midnight-hover': darker(prev.midnight) }));
  }

  async function publish() {
    setError(''); setNotice('');
    const palette = cleanPalette(draft);
    const { data, error: e } = await runBusy('Publishing colours…', () => supabase.rpc('publish_branding', { p_palette: palette }));
    setConfirming(false);
    if (e) { setError(e.message); return; }
    // Read it back: a refusal can come back as a 200 with nothing written.
    const back = await fetchPublished();
    // A database without the status-colour update stores the brand colours
    // and drops the rest; say so rather than "didn't save".
    if (back.row && data && back.row.id === data.id && !STATUS_KEYS.every(k => k in (back.row.palette || {}))) {
      setError('The brand colours were published, but this database needs the status-colours update before the status colours can be. Ask for the branding SQL to be run.');
      await load();
      return;
    }
    const landed = back.row && data && back.row.id === data.id
      && KEYS.every(k => cleanPalette(back.row.palette)[k] === palette[k]);
    if (!landed) { setError("The colours didn't save. Nothing changed for anyone. Try again, or reload the page."); return; }
    adoptPublished(palette);
    await load();
    setNotice('Published. Everyone sees the new colours on their next page load.');
  }

  if (loading) return <section className="editor-card settings-card"><SkeletonTable rows={6} label="Loading the colours…" /></section>;
  if (missing) {
    return (
      <section className="editor-card settings-card">
        <h2 className="section-title" style={{ margin: 0 }}>Branding</h2>
        <p className="muted">Branding isn't set up on this database yet, so the app keeps its standard colours.
          {canEdit && ' It needs the branding SQL to be run once.'}</p>
      </section>
    );
  }
  if (loadError) {
    return (
      <section className="editor-card settings-card">
        <h2 className="section-title" style={{ margin: 0 }}>Branding</h2>
        <p className="error">Couldn't load the colours: {loadError}</p>
        <button type="button" className="ghost" onClick={load}>Retry</button>
      </section>
    );
  }

  const previewVars = Object.fromEntries(KEYS.map(k => [`--${k}`, colourBlind ? asColourBlind(draft[k]) : draft[k]]));
  const lockedHover = autoHover;

  return (
    <section className="editor-card settings-card branding">
      <div className="settings-card-head">
        <div className="settings-card-title">
          <h2 className="section-title" style={{ margin: 0 }}>Branding</h2>
          <p className="muted settings-card-note">
            The colours the whole app uses: every trainer screen, the participants' workbook and handsets, and the
            printed L&amp;D report. Changes show in the preview straight away and reach everyone only when you publish.
            {!canEdit && ' Only a super admin can change them.'}
          </p>
        </div>
      </div>

      <div className="brand-grid">
        <div>
          {GROUPS.map(g => (
            <div className="brand-group" key={g.title}>
              <h3>{g.title}</h3>
              {g.items.map(([k, name, used, auto]) => {
                const locked = !canEdit || (auto && lockedHover);
                const code = typed[k] ?? draft[k];
                const bad = typed[k] !== undefined && !isHex(typed[k].trim().startsWith('#') ? typed[k].trim() : `#${typed[k].trim()}`);
                return (
                  <div key={k}>
                    <div className={`brand-row${draft[k] !== published[k] ? ' is-changed' : ''}${locked ? ' is-locked' : ''}`}>
                      <span className="brand-swatch" style={{ background: draft[k] }}>
                        <input
                          type="color"
                          id={`brand-${k}`}
                          value={draft[k]}
                          disabled={locked}
                          aria-label={name}
                          onChange={e => { setTyped(t => ({ ...t, [k]: undefined })); setColour(k, e.target.value); }}
                        />
                      </span>
                      <label htmlFor={`brand-${k}`} className="brand-name">
                        {name}<span>{used}</span>
                      </label>
                      <input
                        className={`form-input brand-code${bad ? ' is-bad' : ''}`}
                        value={code}
                        disabled={locked}
                        spellCheck={false}
                        autoComplete="off"
                        aria-label={`${name} colour code`}
                        onChange={e => typeCode(k, e.target.value)}
                        onBlur={() => setTyped(t => ({ ...t, [k]: undefined }))}
                      />
                    </div>
                    {auto && canEdit && (
                      <label className="brand-auto">
                        <input type="checkbox" checked={autoHover} onChange={e => toggleAuto(e.target.checked)} />
                        Work it out from the main colour
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="brand-group">
            <h3>Status</h3>
            <p className="brand-fixed-note">
              Colours that mean something on every screen. Pick one per family; its shades follow. A green must stay
              a green, an amber an amber, a red a red.
            </p>
            {FAMILIES.map(f => {
              const k = f;
              const locked = !canEdit;
              const code = typed[k] ?? draft[k];
              const bad = typed[k] !== undefined && !isHex(typed[k].trim().startsWith('#') ? typed[k].trim() : `#${typed[k].trim()}`);
              const [a, b] = STATUS_BANDS[f];
              const hue = hueOfColour(draft[k]);
              return (
                <div className={`brand-status-fam${draft[k] !== published[k] ? ' is-changed' : ''}`} key={f}>
                  <div className={`brand-row${locked ? ' is-locked' : ''}`}>
                    <span className="brand-swatch" style={{ background: draft[k] }}>
                      <input
                        type="color" id={`brand-${k}`} value={draft[k]} disabled={locked} aria-label={STATUS_NAMES[f]}
                        onChange={e => { setTyped(t => ({ ...t, [k]: undefined })); setColour(k, e.target.value); }}
                      />
                    </span>
                    <label htmlFor={`brand-${k}`} className="brand-name">{STATUS_NAMES[f]}<span>{STATUS_USES[f]}</span></label>
                    <input
                      className={`form-input brand-code${bad ? ' is-bad' : ''}`} value={code} disabled={locked}
                      spellCheck={false} autoComplete="off" aria-label={`${STATUS_NAMES[f]} colour code`}
                      onChange={e => typeCode(k, e.target.value)} onBlur={() => setTyped(t => ({ ...t, [k]: undefined }))}
                    />
                  </div>
                  <div className="brand-hue" aria-hidden="true">
                    {a <= b
                      ? <span className="brand-hue-band" style={{ left: `${a / 3.6}%`, width: `${(b - a) / 3.6}%` }} />
                      : <><span className="brand-hue-band" style={{ left: `${a / 3.6}%`, right: 0 }} /><span className="brand-hue-band" style={{ left: 0, width: `${b / 3.6}%` }} /></>}
                    <span className="brand-hue-dot" style={{ left: `calc(${hue / 3.6}% - 2px)` }} />
                  </div>
                  <div className="brand-roles">
                    {ROLE_LABELS.map(([r, label]) => (
                      <span className="brand-role" key={r}>
                        <i style={{ background: draft[f + r] }} />
                        <span>{label}<em>{draft[f + r]}</em></span>
                      </span>
                    ))}
                  </div>
                  <ul className="brand-rules">
                    {rulesBy[f].map(([kind, msg]) => (
                      <li key={msg} className={`is-${kind}`}>
                        <span aria-hidden="true">{kind === 'ok' ? '✓' : kind === 'bad' ? '✗' : '!'}</span>{msg}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        <div className="brand-preview" style={previewVars} aria-label="Preview">
          <div className="brand-preview-head">
            <span className="brand-label">Preview</span>
            <label className="brand-cb">
              <input type="checkbox" checked={colourBlind} onChange={e => setColourBlind(e.target.checked)} />
              As someone with red-green colour blindness sees it
            </label>
          </div>
          <div className="bp-shell">
            <div className="bp-nav"><b>Sessions</b><span className="on">Room</span><span>Workbook</span><span>Assessment</span></div>
            <div className="bp-body">
              <div className="bp-row">
                <span className="bp-btn">Save changes</span>
                <span className="bp-btn is-hover">Hovered</span>
                <span className="bp-btn is-ghost">Cancel</span>
                <span className="bp-chip">Master copy</span>
              </div>
              <div className="bp-tiles">
                <div className="bp-gauge"><span>Class pace</span><b>245<small> / 334</small></b></div>
                <div className="bp-tile"><b>Trainee1</b><small>Exercise 11 · Working</small></div>
                <div className="bp-tile"><b>Trainee14</b><small>Exercise 11 · Working</small></div>
              </div>
              <div className="bp-report">
                <div className="bp-mast"><b>L&amp;D Training Report</b></div>
                <table>
                  <tbody>
                    <tr><th>Program Title</th><td>ARDW for Online Community</td></tr>
                    <tr><th>Facilitator &amp; Staff №</th><td>Ensio</td></tr>
                  </tbody>
                </table>
                <table>
                  <thead><tr><th>Sr</th><th>Full Name</th><th>Score (%)</th></tr></thead>
                  <tbody><tr><td>1</td><td>Trainee1</td><td>81%</td></tr></tbody>
                </table>
              </div>
              <div className="bp-row">
                <span className="bp-status is-good">✓ Saved · just now</span>
                <span className="bp-status is-look">2 need a look</span>
                <span className="bp-status is-problem">Couldn't save · Retry</span>
              </div>
              <div className="bp-tiles">
                <div className="bp-tile is-good"><b>Trainee14</b><small>Working</small><span className="bp-tap is-good">👍 9</span></div>
                <div className="bp-tile is-look"><b>Trainee5</b><small>Quiet 12 min</small><span className="bp-tap is-look">🤔 1</span></div>
                <div className="bp-tile is-problem"><b>Trainee6</b><small>Behind pace</small><span className="bp-tap is-problem is-now">😕 2</span></div>
              </div>
              <div className="bp-box is-look">✋ 3 questions still to mark by hand. Scores below are interim.</div>
              <div className="bp-box is-problem">Couldn't load your workbooks. Nothing was changed.</div>
              <div className="bp-results"><span>Trainee1 · 81%</span><b className="is-good">PASS</b><span>Trainee11 · 14%</span><b className="is-problem">FAIL</b></div>
              <p className="bp-quiet">Quiet text looks like this · 2 h ago</p>
            </div>
          </div>

          <span className="brand-label">Can people read it?</span>
          <ul className="brand-checks">
            {checks.map(c => (
              <li key={c.what} className={c.pass ? '' : 'is-failing'}>
                <span className="brand-aa" style={{ color: c.fgHex, background: c.bgHex }} aria-hidden="true">Aa</span>
                <span>
                  {c.what}
                  <small>{c.pass ? c.where : <>Too faint. Change <strong>{NAMES[c.fix]}</strong>.</>}</small>
                </span>
                <span className={`brand-ratio ${c.pass ? 'is-pass' : 'is-fail'}`}>{c.ratio.toFixed(1)} : 1 {c.pass ? '✓' : '✗'}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {canEdit && (
        <>
          <div className="brand-bar">
            <span className={`brand-status${failing.length ? ' is-err' : ''}`} role="status">
              {notice ? notice
                : failing.length ? <><strong>{failing.length} check{failing.length === 1 ? '' : 's'} failing.</strong> Fix {failing.length === 1 ? 'it' : 'them'} to publish (marked ✗ above).</>
                  : changed.length ? <><strong>{changed.length} colour{changed.length === 1 ? '' : 's'} changed:</strong> {changed.map(k => NAMES[k]).join(', ')}.</>
                    : 'No changes.'}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="ghost" onClick={() => { setDraft(DEFAULTS); setAutoHover(true); setNotice(''); }}>
              Reset to the default colours
            </button>
            {trying
              ? <button type="button" className="ghost" onClick={() => { stopTrying(); }}>Stop trying</button>
              : <button type="button" className="ghost" disabled={!!failing.length || !changed.length} onClick={() => startTrying(draft)}>Try it just for me</button>}
            <button type="button" disabled={!!failing.length || !changed.length} onClick={() => setConfirming(true)}>
              Publish to everyone
            </button>
          </div>
          {confirming && (
            <div className="brand-confirm" role="alertdialog" aria-label="Publish the colours">
              <span><strong>Everyone sees the new colours</strong> on their next page load, including participants in a
                live class and anything printed from now on.</span>
              <span style={{ flex: 1 }} />
              <button type="button" className="ghost" onClick={() => setConfirming(false)}>Not yet</button>
              <button type="button" onClick={publish}>Publish</button>
            </div>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </>
      )}

      <div className="brand-history">
        <span className="brand-label">Published versions</span>
        {history.length === 0 && <p className="muted">Nothing published yet: the app uses its standard colours.</p>}
        {history.map((h, i) => {
          const p = cleanPalette(h.palette);
          return (
            <div className="brand-hist-row" key={h.id}>
              <span className="brand-dots" aria-hidden="true">
                {['midnight', 'gold', 'qasr', 'bg', 'text'].map(k => <i key={k} style={{ background: p[k] }} />)}
              </span>
              <span>{new Date(h.published_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {h.published_by_name ? ` · ${h.published_by_name}` : ''}</span>
              {i === 0
                ? <span className="brand-inuse">In use</span>
                : canEdit && <button type="button" className="ghost btn-sm" onClick={() => { setDraft(p); setAutoHover(isAutoHover(p)); setNotice('Loaded into the editor. Publish to use it again.'); }}>Load into the editor</button>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
