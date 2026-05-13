import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { isTrainerTier, homePathForRole, ROLES } from '../lib/roles.js';

// The `role` prop accepts:
//   "trainer"     — any trainer-tier role (super_admin, super_trainer,
//                   vendor_manager, vendor_trainer)
//   "participant" — exactly the participant role
//   (anything else) — exact match
export default function ProtectedRoute({ children, role }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="loading">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (profile?.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  if (role) {
    const allowed =
      (role === 'trainer' && isTrainerTier(profile?.role)) ||
      (role === 'participant' && profile?.role === ROLES.PARTICIPANT) ||
      profile?.role === role;
    if (!allowed) {
      return <Navigate to={homePathForRole(profile?.role)} replace />;
    }
  }
  return children;
}
