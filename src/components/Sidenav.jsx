import { useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { isSuperTrainerOrAbove } from '../lib/roles.js';

// The persistent left rail, matching myLearning HUB.
//
// Grouped rather than a flat list, and grouped by WHAT YOU ARE DOING — running
// a session, authoring content, administering the system — not by which table
// the page reads. Ten destinations is past the point where a single column
// stops being scannable.
//
// Trainer surfaces only. Participants reach exactly two pages and are left with
// a clean paper; a rail full of Vendors and Staff would be noise they cannot
// use anyway.
//
// Super-only items are hidden rather than disabled: a vendor trainer has no
// route to them, so showing a dead link would only invite the question.
const GROUPS = [
  {
    // Sessions sits INSIDE Delivery rather than alone above it. It used to be
    // an unlabelled group of one, which made the rail open with an item that
    // belonged to no heading — and Delivery is precisely what it is. Live work
    // first, then the material you prepare for it.
    label: 'Delivery',
    items: [
      { to: '/trainer', end: true, icon: '▤', label: 'Sessions' },
      { to: '/trainer/prep', icon: '◧', label: 'Prep' },
    ],
  },
  {
    // Ordered by how the material is built: a workbook is the paper, an
    // assessment is what follows it, a program bundles the two, and session
    // changes is the review of edits made to any of them.
    label: 'Content',
    items: [
      // NOT superOnly, unlike everything else in this group. This is a vendor
      // trainer's only route to the templates they deliver from — the library
      // used to sit at the bottom of the sessions page, where every role could
      // reach it. useTrainerWorkbooks narrows non-super roles to vendor_visible
      // rows, so the page is safe to open; only authoring is gated, on the page.
      { to: '/trainer/workbooks', icon: '▥', label: 'Workbooks' },
      { to: '/trainer/assessments', icon: '✎', label: 'Assessments' },
      // NOT superOnly: vendor trainers author and run quizzes too, unlike
      // assessments. quiz_can_author() in the DB is the matching rule.
      { to: '/trainer/quizzes', icon: '◑', label: 'Quizzes' },
      { to: '/trainer/programs', icon: '◈', label: 'Programs' },
      { to: '/trainer/changes', icon: '⇄', label: 'Session changes', superOnly: true },
    ],
  },
  {
    // Closed sessions joins Analytics here: both are looking BACK at delivery
    // that has finished, which is a different job from running one. The two
    // lookbacks lead, then the three administration destinations.
    label: 'Management',
    items: [
      { to: '/trainer/archive', icon: '◫', label: 'Closed sessions' },
      { to: '/trainer/analytics', icon: '◔', label: 'Analytics' },
      { to: '/trainer/settings', icon: '⚙', label: 'Settings', superOnly: true },
    ],
  },
];

export default function Sidenav() {
  const { profile } = useAuth();
  const isSuper = isSuperTrainerOrAbove(profile?.role);

  // The rail is fixed, so the page canvas has to be pushed clear of it. Doing
  // that with a body class rather than a wrapper element means every existing
  // page keeps rendering exactly as it does, with no edit to any of them.
  useEffect(() => {
    document.body.classList.add('has-sidenav');
    return () => document.body.classList.remove('has-sidenav');
  }, []);

  return (
    <aside className="sidenav">
      <Link to="/trainer" className="sidenav-brand">
        <span className="sidenav-mark">PS</span>
        <span className="sidenav-brand-text">
          <span className="sidenav-brand-title">pstrainingres</span>
          <span className="sidenav-brand-sub">Training resources</span>
        </span>
      </Link>

      <nav className="sidenav-nav">
        {GROUPS.map((group, gi) => {
          const items = group.items.filter(i => !i.superOnly || isSuper);
          if (!items.length) return null;
          return (
            <div className="sidenav-group" key={group.label || `g${gi}`}>
              {group.label && <div className="sidenav-group-label">{group.label}</div>}
              {items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `sidenav-item${isActive ? ' active' : ''}`}
                >
                  <span className="sidenav-icon" aria-hidden>{item.icon}</span>
                  <span className="sidenav-label">{item.label}</span>
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
