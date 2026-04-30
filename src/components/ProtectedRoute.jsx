import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function ProtectedRoute({ children, role }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="loading">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (profile?.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  if (role && profile?.role !== role) {
    return <Navigate to={profile?.role === 'trainer' ? '/trainer' : '/workbook'} replace />;
  }
  return children;
}
