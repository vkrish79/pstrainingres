import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { isTrainerTier, isSuperTrainerOrAbove, homePathForRole, roleLabel } from '../lib/roles.js';

export default function TopBar() {
  const { profile, signOut } = useAuth();
  const isTrainer = isTrainerTier(profile?.role);
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  const homePath = homePathForRole(profile?.role);
  const chipLabel = roleLabel(profile?.role);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to={homePath} className="topbar-brand">
          <div className="topbar-mark">PS</div>
          <div className="topbar-brand-text">
            <div className="topbar-brand-title">pstrainingres</div>
            <div className="topbar-brand-sub">Training resources</div>
          </div>
        </Link>
        <nav className="topbar-nav">
          {isTrainer && (
            <>
              <NavLink to="/trainer" end className={({ isActive }) => `topbar-nav-link ${isActive ? 'active' : ''}`}>Home</NavLink>
              {isSuper && (
                <>
                  <NavLink to="/trainer/vendors" className={({ isActive }) => `topbar-nav-link ${isActive ? 'active' : ''}`}>Vendors</NavLink>
                  <NavLink to="/trainer/staff" className={({ isActive }) => `topbar-nav-link ${isActive ? 'active' : ''}`}>Staff</NavLink>
                </>
              )}
              <NavLink to="/trainer/people" className={({ isActive }) => `topbar-nav-link ${isActive ? 'active' : ''}`}>People</NavLink>
            </>
          )}
          <span className="topbar-user">
            <span className="topbar-user-avatar">{(profile?.full_name || '?').charAt(0).toUpperCase()}</span>
            <span className="topbar-user-name">{profile?.full_name}</span>
            {chipLabel && (
              <span className={`topbar-role-chip role-${profile?.role}`}>{chipLabel}</span>
            )}
          </span>
          <button className="topbar-signout" onClick={signOut}>Sign out</button>
        </nav>
      </div>
    </header>
  );
}
