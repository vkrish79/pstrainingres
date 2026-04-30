import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function TopBar() {
  const { profile, signOut } = useAuth();
  const isTrainer = profile?.role === 'trainer';
  const homePath = isTrainer ? '/trainer' : '/workbook';
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
              <NavLink to="/trainer/people" className={({ isActive }) => `topbar-nav-link ${isActive ? 'active' : ''}`}>People</NavLink>
            </>
          )}
          <span className="topbar-user">
            <span className="topbar-user-avatar">{(profile?.full_name || '?').charAt(0).toUpperCase()}</span>
            <span className="topbar-user-name">{profile?.full_name}</span>
          </span>
          <button className="topbar-signout" onClick={signOut}>Sign out</button>
        </nav>
      </div>
    </header>
  );
}
