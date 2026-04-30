import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import '../styles/dashboard.css';
import '../styles/editor.css';

export default function NewSessionPage() {
  const { profile, signOut, session: authSession } = useAuth();
  const navigate = useNavigate();
  const [workbooks, setWorkbooks] = useState([]);
  const [name, setName] = useState('');
  const [workbookId, setWorkbookId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('workbooks').select('id, title').order('updated_at', { ascending: false });
      setWorkbooks(data || []);
      if (data?.length && !workbookId) setWorkbookId(data[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    const { data, error: insErr } = await supabase
      .from('sessions')
      .insert({ name, workbook_id: workbookId, trainer_id: authSession.user.id })
      .select()
      .single();
    setBusy(false);
    if (insErr) { setError(insErr.message); return; }
    navigate(`/trainer/sessions/${data.id}`);
  }

  return (
    <div className="page editor">
      <header className="page-header">
        <div>
          <Link to="/trainer" className="back-link">&larr; Back</Link>
          <h1>New session</h1>
        </div>
        <div>
          <span>{profile?.full_name}</span>
          <button onClick={signOut}>Sign out</button>
        </div>
      </header>

      <section className="editor-card">
        <form onSubmit={handleSubmit}>
          <label className="form-label">Workbook</label>
          <select className="form-input" value={workbookId} onChange={e => setWorkbookId(e.target.value)} required>
            <option value="" disabled>Select…</option>
            {workbooks.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
          </select>

          <label className="form-label">Session name</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. ARDW — Cohort 2026-05" />

          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button type="submit" disabled={busy || !workbookId || !name.trim()}>
              {busy ? 'Creating…' : 'Create session'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
