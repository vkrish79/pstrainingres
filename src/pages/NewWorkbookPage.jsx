import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { supabase } from '../lib/supabase.js';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';

export default function NewWorkbookPage() {
  const navigate = useNavigate();
  const { session: authSession } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [vendorVisible, setVendorVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    const { data: wb, error: wbErr } = await supabase
      .from('workbooks')
      .insert({
        title: title.trim(),
        description: description.trim() || null,
        is_template: true,
        vendor_visible: vendorVisible,
        created_by: authSession.user.id,
      })
      .select()
      .single();
    if (wbErr) { setError(wbErr.message); setBusy(false); return; }

    // Seed an empty first section so the editor isn't blank.
    await supabase.from('sections').insert({ workbook_id: wb.id, title: 'Section 1', order_index: 0 });
    navigate(`/trainer/workbooks/${wb.id}`);
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>New workbook</h1>
            <p>Start blank, then add sections and blocks. Or <Link to="/trainer/workbooks/import">import a Word file</Link>.</p>
          </div>
        </section>

        <section className="editor-card">
          <form onSubmit={handleSubmit}>
            <label className="form-label">Title</label>
            <input className="form-input large" value={title} onChange={e => setTitle(e.target.value)} required autoFocus />

            <label className="form-label">Description (optional)</label>
            <input className="form-input" value={description} onChange={e => setDescription(e.target.value)} />

            <label className="checkbox-row" style={{ marginTop: '0.85rem' }}>
              <input type="checkbox" checked={vendorVisible} onChange={e => setVendorVisible(e.target.checked)} />
              <span>Make available to vendors <span className="muted">— off for custom/one-off workbooks; on to let vendor trainers run sessions from it</span></span>
            </label>

            {error && <p className="error">{error}</p>}
            <div className="form-actions">
              <button type="submit" disabled={busy || !title.trim()}>
                {busy ? 'Creating…' : 'Create workbook'}
              </button>
            </div>
          </form>
        </section>
      </main>
    </>
  );
}
