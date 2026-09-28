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
import { useResitSessions, useResitCandidates } from '../../hooks/useResitCandidates.js';
import { arrangeResit } from '../../lib/arrangeResit.js';
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
// `resitOf` — open straight onto the re-sit form for THIS session, which is how
// a trainer arranges one: from the session they are standing in, not by finding
// it again in a dropdown. With several cohorts running in several cities that
// dropdown is a list of near-identical names, and picking the wrong one re-locks
// a paper somebody else is sitting. Given a session, the picker is replaced by a
// plain statement of which session this is.
//
// Shape: { id, name, join_code, city_code } — whatever the caller already has.
export default function NewSessionDrawer({ open, onClose, initialProgramId = null, resitOf = null }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { run: runBusy } = useBusyOverlay();
  const { staff } = useStaff();
  const { vendors } = useVendors();
  const { cities } = useCities(); // active only
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  // vendor_manager OR super — anyone who needs to *pick* the trainer.
  const canPickTrainer = isVendorManagerOrAbove(profile?.role);

  // 'regular' | 'resit'. A re-sit is not this form with fields left blank: it
  // derives its programme, trainer and vendor from the session being re-sat, so
  // it asks three questions instead of seven.
  const [kind, setKind] = useState(resitOf ? 'resit' : 'regular');
  const [ofSessionId, setOfSessionId] = useState(resitOf?.id || '');
  const [picked, setPicked] = useState(() => new Set());
  const isResit = kind === 'resit';
  // Opened from a session: the kind is not a choice and the session is not a
  // question, so neither is offered.
  const pinned = !!resitOf;

  // The drawer is always mounted, so a later open with a different session
  // must not inherit the last one.
  useEffect(() => {
    if (!open || !resitOf) return;
    setKind('resit');
    setOfSessionId(resitOf.id);
  }, [open, resitOf]);

  useBodyScrollLock(open);

  const { sessions: resitSessions, loading: resitSessionsLoading } = useResitSessions(open && isResit);
  const { candidates, passMark, loading: candidatesLoading } = useResitCandidates(isResit ? ofSessionId : null);

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
  // Sign-in details for the accounts a re-sit just created. THEY EXIST ONLY
  // HERE: add-session-participants generates each temp password, returns it
  // once, and stores nothing but the hash. Navigating straight to the new
  // session — which is what this did — threw them away, leaving a re-sitter
  // who cannot sign in and a trainer whose only route back is a password
  // reset. So the drawer stops and shows them before going anywhere.
  const [credentials, setCredentials] = useState(null);

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

  // Below the pass mark, pre-ticked — the common case is "these are the people
  // who failed". Re-runs when the session changes, never on every render, so a
  // trainer's own ticking is not undone under them.
  useEffect(() => {
    setPicked(new Set(candidates.filter(c => c.failed === true).map(c => c.id)));
  }, [candidates]);

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
    name.trim() || startsAt || endsAt || cityCode || vendorId || trainerId || !superSelfDeliver || isResit
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
      setKind('regular'); setOfSessionId(''); setPicked(new Set());
      setVendorId(''); setTrainerId(''); setSuperSelfDeliver(true);
      setError(''); setConfirmDiscard(false); setCredentials(null);
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
    if (isResit) {
      if (!ofSessionId) return 'Pick the session being re-sat.';
      if (picked.size === 0) return 'Pick at least one person to sit again.';
      if (!startsAt || !endsAt) return 'Give the re-sit a start and end date.';
      if (endsAt < startsAt) return 'End date cannot be before start date.';
      return null;
    }
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

    if (isResit) {
      const people = candidates.filter(c => picked.has(c.id));
      // resitOf when the drawer was opened from a session: the list the
      // dropdown uses is not loaded in that case, so it cannot be looked up.
      const src = resitOf || resitSessions.find(s => s.id === ofSessionId);
      const result = await runBusy(
        'Arranging the re-sit…',
        () => arrangeResit({
          ofSessionId,
          name: name.trim() || `Re-sit — ${src?.name ?? ''}`.trim(),
          startsAt, endsAt, people,
        }),
      );
      setBusy(false);
      if (result.error) {
        // The session may exist even though this failed: enrolment is a separate
        // call and is not rolled back. Say so, and say where it is.
        setError(result.sessionId
          ? `${result.error.message} — the re-sit session was created; open it to finish adding people.`
          : result.error.message);
        return;
      }
      if (result.failures.length) {
        setError(`Created, but ${result.failures.map(f => `${f.name} (${f.why})`).join('; ')}. Open the session to finish.`);
        return;
      }
      // Hold the sign-in details rather than navigating past them. Only rows
      // the function actually created carry one; anything else is reported by
      // the failure branch above.
      const made = (result.created?.results || []).filter(r => r.temp_password);
      if (made.length) {
        setCredentials({ sessionId: result.sessionId, joinCode: result.created?.join_code || null, rows: made });
        return;
      }
      navigate(`/trainer/sessions/${result.sessionId}`);
      return;
    }

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
            <h2>{isResit ? 'Arrange a re-sit' : 'New session'}</h2>
            <p className="session-drawer-sub">
              {isResit
                ? (pinned
                  ? "Pick who is sitting again and when. Everything else comes from this session, and its paper will be re-locked."
                  : 'Pick the session being re-sat and who is sitting again. Everything else comes from that session.')
                : "Pick a published program, name your cohort, and set the dates. You'll add participants on the next screen."}
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
          {credentials ? (
            <div className="resit-creds">
              <p className="resit-creds-lead">
                The re-sit is ready. <strong>Write these down now</strong> — each password is
                generated once and is not stored, so this is the only time it can be read.
                After this, the only way back is to reset it from the session.
              </p>
              {credentials.joinCode && (
                <p className="resit-creds-code">
                  Join code <strong>{credentials.joinCode}</strong>
                </p>
              )}
              <table className="resit-creds-table">
                <thead>
                  <tr><th>Username</th><th>Temporary password</th></tr>
                </thead>
                <tbody>
                  {credentials.rows.map(r => (
                    <tr key={r.username}>
                      <td className="mono">{r.username}</td>
                      <td className="mono">{r.temp_password}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="resit-creds-actions">
                <button type="button" className="secondary" onClick={() => window.print()}>
                  Print
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => { const id = credentials.sessionId; setCredentials(null); navigate(`/trainer/sessions/${id}`); }}
                >
                  I have these — open the re-sit
                </button>
              </div>
            </div>
          ) : (
          <form id="new-session-form" onSubmit={handleSubmit}>
            {/* Arriving from a session, the kind is already settled — offering
                "Regular session" here would be offering to throw the context
                away and start an unrelated form. */}
            <div className="resit-kind" role="group" aria-label="What kind of session" hidden={pinned}>
              <button
                type="button"
                className={`resit-kind-opt${!isResit ? ' on' : ''}`}
                aria-pressed={!isResit}
                onClick={() => setKind('regular')}
              >
                <strong>Regular session</strong>
                <small>Workbook, exercises, prep, assessment</small>
              </button>
              <button
                type="button"
                className={`resit-kind-opt${isResit ? ' on' : ''}`}
                aria-pressed={isResit}
                onClick={() => setKind('resit')}
              >
                <strong>Re-sit</strong>
                <small>The paper only — no workbook or handouts</small>
              </button>
            </div>

            {isResit ? (
              <>
                {pinned ? (
                  <div className="resit-of-fixed">
                    <span className="resit-of-label">Re-sitting</span>
                    <strong>{resitOf.name}</strong>
                    <span className="resit-of-meta">
                      {resitOf.city_code ? `${resitOf.city_code} · ` : ''}
                      {resitOf.join_code || ''}
                    </span>
                  </div>
                ) : (
                  <>
                    <label className="form-label" htmlFor="ns-of">Re-sitting which session</label>
                    <select
                      id="ns-of"
                      ref={firstFieldRef}
                      className="form-input"
                      value={ofSessionId}
                      onChange={e => { setOfSessionId(e.target.value); setPicked(new Set()); }}
                      required
                    >
                      <option value="" disabled>{resitSessionsLoading ? 'Loading…' : 'Select…'}</option>
                      {resitSessions.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}{s.city_code ? ` · ${s.city_code}` : ''}{s.join_code ? ` · ${s.join_code}` : ''}
                        </option>
                      ))}
                    </select>
                    {!resitSessionsLoading && resitSessions.length === 0 && (
                      <p className="muted" style={{ marginTop: '0.25rem' }}>
                        No open session has a paper to re-sit. A session must still be open —
                        closing it deletes the participants&rsquo; accounts, which is what the
                        first attempt is read from.
                      </p>
                    )}
                  </>
                )}

                {ofSessionId && (
                  <>
                    <label className="form-label" style={{ marginTop: '0.75rem' }}>Who is sitting again</label>
                    {candidatesLoading && <p className="muted">Working out who failed…</p>}
                    {!candidatesLoading && candidates.length === 0 && (
                      <p className="muted">Nobody is enrolled in that session.</p>
                    )}
                    {!candidatesLoading && candidates.length > 0 && (
                      <>
                        <ul className="resit-people">
                          {candidates.map(c => (
                            <li key={c.id}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={picked.has(c.id)}
                                  onChange={e => setPicked(prev => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(c.id); else next.delete(c.id);
                                    return next;
                                  })}
                                />
                                <span className="resit-people-name">
                                  {c.name}{c.deactivated ? ' · dropped out' : ''}
                                </span>
                                <span className={`resit-people-score${c.failed === true ? ' is-fail' : ''}`}>
                                  {c.pct == null ? 'not marked'
                                    : `${c.pct}%${c.failed === true ? ' · failed' : c.failed === false ? ' · passed' : ''}`}
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                        <p className="muted" style={{ marginTop: '0.25rem' }}>
                          {passMark == null
                            ? 'That session has no pass mark, so nobody is marked as failed — pick whoever needs to sit again.'
                            : `Below the ${passMark}% pass mark, pre-ticked. Anyone can be picked.`}
                        </p>
                        <p className="muted">
                          Their paper is copied from that session, and its assessment is
                          locked so the first attempt stays as it is.
                        </p>
                      </>
                    )}
                  </>
                )}
              </>
            ) : (
            <>
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

            </>
            )}

            <label className="form-label" htmlFor="ns-name">
              {isResit ? 'Name this re-sit' : 'Session name'}
            </label>
            <input
              id="ns-name"
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              required={!isResit}
              placeholder={isResit ? 'Re-sit — ARDW Sept intake' : 'e.g. ARDW — Cohort 2026-05'}
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

            {!isResit && (
            <>
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
            </>
            )}

            {error && <p className="error">{error}</p>}
          </form>
          )}
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
