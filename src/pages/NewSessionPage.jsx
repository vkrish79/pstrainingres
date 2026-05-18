import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import { useStaff } from '../hooks/useStaff.js';
import { useVendors } from '../hooks/useVendors.js';
import { isSuperTrainerOrAbove, isVendorManagerOrAbove, ROLES } from '../lib/roles.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';

export default function NewSessionPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { staff } = useStaff();
  const { vendors } = useVendors();
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  // vendor_manager OR super — anyone who needs to *pick* the trainer.
  const canPickTrainer = isVendorManagerOrAbove(profile?.role);

  const [workbooks, setWorkbooks] = useState([]);
  const [name, setName] = useState('');
  const [workbookId, setWorkbookId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [cityCode, setCityCode] = useState('');
  // Super-tier picks the vendor first; the trainer dropdown then filters to
  // that vendor. Vendor_manager has no vendor picker — their vendor is implied
  // and RLS already scopes the staff list to it.
  const [vendorId, setVendorId] = useState('');
  const [trainerId, setTrainerId] = useState('');
  // Super-only: when true, no vendor/trainer pickers — session is assigned
  // to the super themselves (vendor_id resolves to whatever the super has,
  // usually null). When false, vendor + trainer pickers appear and are required.
  const [superSelfDeliver, setSuperSelfDeliver] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('workbooks')
        .select('id, title')
        .eq('is_template', true)
        .order('updated_at', { ascending: false });
      setWorkbooks(data || []);
      if (data?.length) setWorkbookId(data[0].id);
    })();
  }, []);

  // Trainers a vendor_manager / super can assign sessions to. Includes
  // vendor_managers themselves (they can run sessions too). RLS already
  // filters `staff` by vendor for non-super; for super we filter client-side
  // by the picked vendor.
  const trainerOptions = useMemo(() => {
    const assignableRoles = new Set([ROLES.VENDOR_MANAGER, ROLES.VENDOR_TRAINER, 'trainer']);
    return staff
      .filter(s => assignableRoles.has(s.role))
      .filter(s => !isSuper || !vendorId || s.vendor_id === vendorId)
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  }, [staff, isSuper, vendorId]);

  // Reset the trainer pick when the vendor changes (super-tier flow only).
  useEffect(() => {
    if (isSuper && trainerId && !trainerOptions.find(t => t.id === trainerId)) {
      setTrainerId('');
    }
  }, [trainerOptions, trainerId, isSuper]);

  function validate() {
    if (cityCode && !/^[A-Z]{3}$/.test(cityCode)) {
      return 'City code must be three uppercase letters (e.g. AUH).';
    }
    if (startsAt && endsAt && endsAt < startsAt) {
      return 'End date cannot be before start date.';
    }
    // Vendor manager always picks a trainer (themselves or someone in their team).
    // Super only when they've chosen to assign rather than self-deliver.
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
    // RPC clones the chosen template workbook + creates the session pointing
    // at the clone, atomically. Returns the new session id.
    const { data: newSessionId, error: rpcErr } = await supabase.rpc(
      'create_session_with_workbook_clone',
      {
        p_template_id: workbookId,
        p_name: name.trim(),
        p_starts_at: startsAt || null,
        p_ends_at: endsAt || null,
        p_city_code: cityCode || null,
        // null = "assign to caller". RPC re-validates: vendor_manager can't
        // pick outside their vendor; vendor_trainer can't pick anyone but
        // themselves. Super self-delivering also passes null.
        p_trainer_id:
          (isSuper && superSelfDeliver) ? null :
          canPickTrainer ? trainerId :
          null,
      }
    );
    setBusy(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    navigate(`/trainer/sessions/${newSessionId}`);
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>New session</h1>
            <p>Pick a workbook, name your cohort, and set the dates and location. You'll add participants on the next screen.</p>
          </div>
        </section>

        <section className="editor-card">
          <form onSubmit={handleSubmit}>
            <label className="form-label">Workbook</label>
            <select className="form-input" value={workbookId} onChange={e => setWorkbookId(e.target.value)} required>
              <option value="" disabled>Select…</option>
              {workbooks.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
            </select>

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
                <label className="form-label">Vendor</label>
                <select className="form-input" value={vendorId} onChange={e => setVendorId(e.target.value)} required>
                  <option value="" disabled>Select…</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name} ({v.code})</option>
                  ))}
                </select>
              </>
            )}

            {canPickTrainer && !(isSuper && superSelfDeliver) && (
              <>
                <label className="form-label">Trainer</label>
                <select
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
                    No trainers in this vendor yet. Add one in <Link to="/trainer/staff">Staff</Link>.
                  </p>
                )}
              </>
            )}

            <label className="form-label">Session name</label>
            <input className="form-input" value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. ARDW — Cohort 2026-05" />

            <div className="form-grid">
              <div>
                <label className="form-label">From date</label>
                <input className="form-input" type="date" value={startsAt} onChange={e => setStartsAt(e.target.value)} />
              </div>
              <div>
                <label className="form-label">To date</label>
                <input className="form-input" type="date" value={endsAt} onChange={e => setEndsAt(e.target.value)} />
              </div>
            </div>

            <label className="form-label">City code (3 letters, optional)</label>
            <input
              className="form-input city-code-input"
              value={cityCode}
              onChange={e => setCityCode(e.target.value.toUpperCase().slice(0, 3))}
              maxLength={3}
              placeholder="AUH"
            />

            {error && <p className="error">{error}</p>}
            <div className="form-actions">
              <button type="submit" disabled={busy || !workbookId || !name.trim()}>
                {busy ? 'Creating…' : 'Create session'}
              </button>
            </div>
          </form>
        </section>
      </main>
    </>
  );
}
