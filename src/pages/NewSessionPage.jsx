import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';

export default function NewSessionPage() {
  const { session: authSession } = useAuth();
  const navigate = useNavigate();
  const [workbooks, setWorkbooks] = useState([]);
  const [name, setName] = useState('');
  const [workbookId, setWorkbookId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [cityCode, setCityCode] = useState('');
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

  function validate() {
    if (cityCode && !/^[A-Z]{3}$/.test(cityCode)) {
      return 'City code must be three uppercase letters (e.g. AUH).';
    }
    if (startsAt && endsAt && endsAt < startsAt) {
      return 'End date cannot be before start date.';
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
