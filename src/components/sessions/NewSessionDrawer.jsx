import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../../contexts/BusyOverlayContext.jsx';
import { supabase } from '../../lib/supabase.js';
import { useStaff } from '../../hooks/useStaff.js';
import { useVendors } from '../../hooks/useVendors.js';
import { useCities } from '../../hooks/useCities.js';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';
import { isSuperTrainerOrAbove, isVendorManagerOrAbove, ROLES } from '../../lib/roles.js';
import '../../styles/editor.css';
import '../../styles/session-drawer.css';

// Making a session is a SIDE TRIP, and it used to be a departure.
//
// This was a whole page at /trainer/sessions/new: the list you were reading
// vanished, and a Back link was the only way home. But nothing here needs the
// list to go away — you are naming a cohort and picking dates, and the thing
// you were just looking at is the useful context for both. So it is a
// slide-over now, and the list stays behind it.
//
// ALWAYS MOUNTED, hidden by a transform. That is what buys the slide OUT as
// well as the slide in — a drawer that unmounts on close can only ever animate
// one way, and vanishing is exactly the abruptness this was meant to fix.
// `visibility` is on the transition too, so a closed drawer is out of the tab
// order rather than sitting off-screen collecting focus.
export default function NewSessionDrawer({ open, onClose, initialProgramId = null }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { run: runBusy } = useBusyOverlay();
  const { staff } = useStaff();
  const { vendors } = useVendors();
  const { cities } = useCities(); // active only
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  // vendor_manager OR super — anyone who needs to *pick* the trainer.
  const canPickTrainer = isVendorManagerOrAbove(profile?.role);

  useBodyScrollLock(open);

  const [programs, setPrograms] = useState([]);
  const [name, setName] = useState('');
  const [programId, setProgramId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [cityCode, setCityCode] = useState('');
  // Super-tier picks the vendor first; the trainer dropdown then filters to
  // that vendor. Vendor_manager has no vendor picker — their vendor is implied
  // and RLS already scopes the staff list to it.
  const [vendorId, setVendorId] = useState('');
  const [trainerId, setTrainerId] = useState('');
  // Super-only: when true, no vendor/trainer pickers — session is assigned
  // to the super themselves. When false, vendor + trainer pickers appear.
  const [superSelfDeliver, setSuperSelfDeliver] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const panelRef = useRef(null);
  const firstFieldRef = useRef(null);
  const returnFocusRef = useRef(null);

  // Published programs only — the publish toggle on the program editor is the
  // gate for session creation. RLS opens vendor read access to published rows.
  //
  // Fetched on first OPEN, not on mount: this drawer now lives on a list page
  // that every trainer lands on, and a query for a form nobody has asked for
  // yet is a query on every page load.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      const { data } = await supabase
        .from('programs')
        .select(`
          id, title,
          program_type:program_types ( id, name )
        `)
        .eq('status', 'published')
        .order('updated_at', { ascending: false });
      setPrograms(data || []);
      if (data?.length) setProgramId(prev => prev || data[0].id);
    })();
  }, [open]);

  const trainerOptions = useMemo(() => {
    const assignableRoles = new Set([ROLES.VENDOR_MANAGER, ROLES.VENDOR_TRAINER, 'trainer']);
    return staff
      .filter(s => assignableRoles.has(s.role))
      .filter(s => !isSuper || !vendorId || s.vendor_id === vendorId)
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  }, [staff, isSuper, vendorId]);

  useEffect(() => {
    if (isSuper && trainerId && !trainerOptions.find(t => t.id === trainerId)) {
      setTrainerId('');
    }
  }, [trainerOptions, trainerId, isSuper]);

  // Opened from a programme ("New class from this", ?program=<id>): start on
  // that programme, once the published list has arrived and only if it is in
  // it — a draft or a stale link falls back to the default.
  useEffect(() => {
    if (open && initialProgramId && programs.some(p => p.id === initialProgramId)) {
      setProgramId(initialProgramId);
    }
  }, [open, initialProgramId, programs]);

  // Anything the trainer has actually put in. programId is excluded on purpose:
  // it defaults to the newest published program without anybody touching it, so
  // counting it as "typed" would make every drawer dirty from the moment it
  // opened, and the discard prompt would fire on an untouched form.
  const dirty = Boolean(
    name.trim() || startsAt || endsAt || cityCode || vendorId || trainerId || !superSelfDeliver
  );

  // Reset on close so the next open is a clean form rather than the last
  // abandoned one. Deferred past the slide-out: clearing immediately empties
  // the fields while the panel is still on screen, and the trainer watches
  // their own typing disappear on the way out.
  //
  // Must stay LONGER than --session-drawer-ms in session-drawer.css. Read from
  // the variable rather than copied, so slowing the slide down cannot leave
  // this behind — which would put the wipe back on screen.
  useEffect(() => {
    if (open) return undefined;
    const ms = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--session-drawer-ms'),
    ) || 420;
    const t = setTimeout(() => {
      setName(''); setStartsAt(''); setEndsAt(''); setCityCode('');
      setVendorId(''); setTrainerId(''); setSuperSelfDeliver(true);
      setError(''); setConfirmDiscard(false);
    }, ms + 80);
    return () => clearTimeout(t);
  }, [open]);

  // Focus into the drawer on open, and hand it back to whatever opened it on
  // close — otherwise Esc leaves focus stranded on the body and the next Tab
  // starts from the top of the page.
  //
  // `wasOpen` is the guard that stops this reaching for focus on a drawer that
  // has never been opened. This component is mounted on every trainer list
  // page, so without it the close branch runs once on every page load — today
  // that is a no-op against a null ref, but it is one refactor away from
  // yanking focus out of whatever the trainer was actually doing.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      returnFocusRef.current = document.activeElement;
      const t = setTimeout(() => firstFieldRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      // Only if it is still on the page — after a successful create we have
      // navigated away and the trigger no longer exists.
      const back = returnFocusRef.current;
      if (back && document.contains(back)) back.focus?.();
    }
    return undefined;
  }, [open]);

  // Esc cancels. On a form with something in it, the FIRST Esc asks instead of
  // discarding — a stray keypress should not be able to bin a half-filled
  // session — and a second Esc, which is a deliberate thing to press twice,
  // goes through with it.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key !== 'Escape' || busy) return;
      e.stopPropagation();
      if (!dirty || confirmDiscard) { onClose(); return; }
      setConfirmDiscard(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, dirty, confirmDiscard, onClose]);

  function requestClose() {
    if (busy) return;
    if (dirty && !confirmDiscard) { setConfirmDiscard(true); return; }
    onClose();
  }

  // Keep the tab ring inside the panel while it is open. Without this, tabbing
  // off the last field walks into the list behind the drawer — which is on
  // screen, so it does not look like a bug until something invisible has focus.
  function onKeyDownPanel(e) {
    if (e.key !== 'Tab') return;
    const f = panelRef.current?.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    );
    if (!f?.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function validate() {
    if (cities.length === 0 && cityCode && !/^[A-Z]{3}$/.test(cityCode)) {
      return 'City code must be three uppercase letters (e.g. AUH).';
    }
    // Dates are required. A session without them cannot appear on the
    // calendar at all, which is a poor thing to discover later — the column
    // stays nullable for sessions created before this rule, but nothing new
    // should join them.
    if (!startsAt && !endsAt) return 'Give this session a start and end date.';
    if (!startsAt) return 'Give this session a start date.';
    if (!endsAt) return 'Give this session an end date.';
    if (endsAt < startsAt) {
      return 'End date cannot be before start date.';
    }
    const trainerRequired =
      profile?.role === ROLES.VENDOR_MANAGER ||
      (isSuper && !superSelfDeliver);
    if (trainerRequired && !trainerId) {
      return 'Pick a trainer to run this session.';
    }
    if (isSuper && !superSelfDeliver && !vendorId) {
      return 'Pick a vendor.';
    }
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const v = validate();
    if (v) { setError(v); return; }
    setBusy(true);
    // RPC clones the program's workbook (and assessment if any) and creates
    // the session atomically. Returns the new session id.
    const { data: newSessionId, error: rpcErr } = await runBusy(
      'Creating session…',
      () => supabase.rpc(
        'create_session_from_program',
        {
          p_program_id: programId,
          p_name: name.trim(),
          p_starts_at: startsAt,
          p_ends_at: endsAt,
          p_city_code: cityCode || null,
          // null = "assign to caller". RPC re-validates: vendor_manager can't
          // pick outside their vendor; vendor_trainer can't pick anyone but
          // themselves. Super self-delivering also passes null.
          p_trainer_id:
            (isSuper && superSelfDeliver) ? null :
            canPickTrainer ? trainerId :
            null,
        }
      )
    );
    setBusy(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    navigate(`/trainer/sessions/${newSessionId}`);
  }

  return (
    <>
      <div
        className={`session-drawer-backdrop${open ? ' visible' : ''}`}
        onClick={requestClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        className={`session-drawer${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="New session"
        aria-hidden={open ? undefined : 'true'}
        onKeyDown={onKeyDownPanel}
      >
        <header className="session-drawer-head">
          <div>
            <h2>New session</h2>
            <p className="session-drawer-sub">
              Pick a published program, name your cohort, and set the dates. You'll add
              participants on the next screen.
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={requestClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            ×
          </button>
        </header>

        <div className="session-drawer-body">
          <form id="new-session-form" onSubmit={handleSubmit}>
            <label className="form-label" htmlFor="ns-program">Program</label>
            <select
              id="ns-program"
              ref={firstFieldRef}
              className="form-input"
              value={programId}
              onChange={e => setProgramId(e.target.value)}
              required
            >
              <option value="" disabled>Select…</option>
              {programs.map(p => (
                <option key={p.id} value={p.id}>
                  {p.title}{p.program_type?.name ? ` — ${p.program_type.name}` : ''}
                </option>
              ))}
            </select>
            {programs.length === 0 && (
              <p className="muted" style={{ marginTop: '0.25rem' }}>
                No published programs yet. {isSuper
                  ? <>Publish one from <Link to="/trainer/programs">Programs</Link>.</>
                  : 'Ask a super trainer to publish a program.'}
              </p>
            )}

            {isSuper && (
              <label className="form-checkbox" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.75rem 0' }}>
                <input
                  type="checkbox"
                  checked={superSelfDeliver}
                  onChange={e => setSuperSelfDeliver(e.target.checked)}
                />
                I'll deliver this session myself
              </label>
            )}

            {isSuper && !superSelfDeliver && (
              <>
                <label className="form-label" htmlFor="ns-vendor">Vendor</label>
                <select
                  id="ns-vendor"
                  className="form-input"
                  value={vendorId}
                  onChange={e => setVendorId(e.target.value)}
                  required
                >
                  <option value="" disabled>Select…</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name} ({v.code})</option>
                  ))}
                </select>
              </>
            )}

            {canPickTrainer && !(isSuper && superSelfDeliver) && (
              <>
                <label className="form-label" htmlFor="ns-trainer">Trainer</label>
                <select
                  id="ns-trainer"
                  className="form-input"
                  value={trainerId}
                  onChange={e => setTrainerId(e.target.value)}
                  required
                  disabled={isSuper && !vendorId}
                >
                  <option value="" disabled>
                    {isSuper && !vendorId ? 'Pick a vendor first…' : 'Select…'}
                  </option>
                  {trainerOptions.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.full_name || t.email} {t.role === ROLES.VENDOR_MANAGER ? '(Manager)' : ''}
                    </option>
                  ))}
                </select>
                {trainerOptions.length === 0 && (isSuper ? vendorId : true) && (
                  <p className="muted" style={{ marginTop: '0.25rem' }}>
                    No trainers in this vendor yet. Add one in <Link to="/trainer/settings?tab=staff">Staff</Link>.
                  </p>
                )}
              </>
            )}

            <label className="form-label" htmlFor="ns-name">Session name</label>
            <input
              id="ns-name"
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              placeholder="e.g. ARDW — Cohort 2026-05"
            />

            <div className="form-grid">
              <div>
                <label className="form-label" htmlFor="ns-from">From date</label>
                <input
                  id="ns-from"
                  className="form-input"
                  type="date"
                  value={startsAt}
                  onChange={e => setStartsAt(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="form-label" htmlFor="ns-to">To date</label>
                {/* min, not min+1: a one-day session is normal, so the end may
                    equal the start. */}
                <input
                  id="ns-to"
                  className="form-input"
                  type="date"
                  value={endsAt}
                  onChange={e => setEndsAt(e.target.value)}
                  required
                  min={startsAt || undefined}
                />
              </div>
            </div>

            <label className="form-label" htmlFor="ns-city">City / venue (optional)</label>
            {cities.length > 0 ? (
              <select
                id="ns-city"
                className="form-input"
                value={cityCode}
                onChange={e => setCityCode(e.target.value)}
              >
                <option value="">— None —</option>
                {cities.map(c => (
                  <option key={c.id} value={c.code}>{c.name} ({c.code})</option>
                ))}
              </select>
            ) : (
              <input
                id="ns-city"
                className="form-input city-code-input"
                value={cityCode}
                onChange={e => setCityCode(e.target.value.toUpperCase().slice(0, 3))}
                maxLength={3}
                placeholder="AUH"
              />
            )}

            {error && <p className="error">{error}</p>}
          </form>
        </div>

        <footer className="session-drawer-foot">
          {confirmDiscard ? (
            // Asked in the footer rather than a second dialog on top of this
            // one. The answer replaces the buttons it is about, so there is
            // nothing to hunt for and nothing stacked.
            <>
              <span className="session-drawer-confirm">Discard this new session?</span>
              <button type="button" className="ghost" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </button>
              <button type="button" className="danger" onClick={onClose}>Discard</button>
            </>
          ) : (
            <>
              <button type="button" className="ghost" onClick={requestClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="submit"
                form="new-session-form"
                disabled={busy || !programId || !name.trim() || !startsAt || !endsAt}
              >
                {busy ? 'Creating…' : 'Create session'}
              </button>
            </>
          )}
        </footer>
      </aside>
    </>
  );
}
