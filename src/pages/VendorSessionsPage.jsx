import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTrainerSessions } from '../hooks/useTrainerSessions.js';
import { supabase } from '../lib/supabase.js';
import SessionCard from '../components/dashboard/SessionCard.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';

// Super-tier drill-in from the vendor card grid on the home page. Shows
// every session in one vendor. Reached at /trainer/vendors/:vendorId/sessions.
export default function VendorSessionsPage() {
  const { vendorId } = useParams();
  const { session: authSession } = useAuth();
  const { loading: sl, error, sessions } = useTrainerSessions(
    authSession?.user.id, 'vendor', vendorId,
  );
  const [vendor, setVendor] = useState(null);

  useEffect(() => {
    if (!vendorId) return;
    (async () => {
      const { data } = await supabase
        .from('vendors')
        .select('id, code, name')
        .eq('id', vendorId)
        .maybeSingle();
      setVendor(data);
    })();
  }, [vendorId]);

  return (
    <>
      <TopBar />
      <main className="page">
        <section className="page-hero compact">
          <div className="page-hero-text">
            <Link to="/trainer" className="back-link">&larr; Back</Link>
            <h1>{vendor ? `${vendor.name} sessions` : 'Vendor sessions'}</h1>
            {vendor?.code && <p className="muted">Vendor code: {vendor.code}</p>}
          </div>
          <div className="page-hero-actions">
            <Link to="/trainer/sessions/new">+ New session</Link>
          </div>
        </section>

        {sl && <div className="loading">Loading…</div>}
        {error && <div className="error">{error}</div>}
        {!sl && !error && sessions.length === 0 && (
          <p className="muted">No sessions in this vendor yet.</p>
        )}
        {!sl && sessions.length > 0 && (
          <div className="session-grid">
            {sessions.map(s => (
              <SessionCard key={s.id} session={s} showTrainer />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
