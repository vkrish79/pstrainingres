import { useEffect, useState } from 'react';
import { SkeletonCards } from '../components/Skeleton.jsx';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTrainerSessions } from '../hooks/useTrainerSessions.js';
import { supabase } from '../lib/supabase.js';
import SessionViews from '../components/dashboard/SessionViews.jsx';
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
            <Link to="/trainer/settings?tab=vendors" className="back-link">&larr; Back to Vendors</Link>
            <h1>{vendor ? `${vendor.name} sessions` : 'Vendor sessions'}</h1>
            {vendor?.code && <p className="muted">Vendor code: {vendor.code}</p>}
          </div>
          <div className="page-hero-actions">
            <Link to="/trainer/sessions/new">+ New session</Link>
          </div>
        </section>

        {sl && <SkeletonCards count={6} label="Loading sessions…" />}
        {error && <div className="error">{error}</div>}
        {!sl && !error && (
          <SessionViews
            sessions={sessions}
            showTrainer
            emptyLabel="No sessions in this vendor yet."
          />
        )}
      </main>
    </>
  );
}
