import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock.js';
import { useGlobalSearch } from '../hooks/useGlobalSearch.js';
import '../styles/search.css';

// Username is the local-part of the synthesized participant email.
function usernameOf(email) {
  return (email || '').split('@')[0] || email || '';
}

// TopBar trigger + ⌘K / Ctrl+K overlay. Results are RLS-scoped per role; which
// GROUPS appear is gated here (Staff/Vendors super-only).
export default function GlobalSearch() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const { loading, results } = useGlobalSearch(open ? term : '', profile?.role);

  useBodyScrollLock(open);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); }
      else if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function go(path) { setOpen(false); setTerm(''); navigate(path); }

  const hasTerm = term.trim().length >= 2;
  const totalCount = results
    ? Object.values(results).reduce((n, arr) => n + arr.length, 0)
    : 0;

  return (
    <>
      <button type="button" className="topbar-search-btn" onClick={() => setOpen(true)} title="Search (⌘K / Ctrl+K)">
        <span aria-hidden>🔍</span> Search<span className="topbar-search-kbd">⌘K</span>
      </button>

      {open && createPortal(
        <div className="search-backdrop visible" onClick={() => setOpen(false)}>
          <div className="search-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label="Global search">
            <input
              className="search-input"
              autoFocus
              placeholder="Search workbooks, sessions, participants…"
              value={term}
              onChange={e => setTerm(e.target.value)}
            />
            <div className="search-results">
              {!hasTerm && <p className="search-hint">Type at least 2 characters.</p>}
              {hasTerm && loading && <p className="search-hint">Searching…</p>}
              {hasTerm && !loading && results && totalCount === 0 && (
                <p className="search-hint">No matches for “{term.trim()}”.</p>
              )}
              {hasTerm && !loading && results && totalCount > 0 && (
                <>
                  <Group title="Workbooks" items={results.workbooks}
                    render={w => <Row key={w.id} title={w.title || 'Untitled'} sub={w.description}
                      onClick={() => go(`/trainer/workbooks/${w.id}`)} />} />

                  <Group title="Sessions" items={results.sessions}
                    render={s => <Row key={s.id} title={s.name}
                      sub={[s.city_code, s.closed_at ? 'Closed' : null].filter(Boolean).join(' · ')}
                      onClick={() => go(`/trainer/sessions/${s.id}`)} />} />

                  <Group title="Participants" items={results.participants}
                    note="Live participants only — closed sessions aren’t searchable yet."
                    render={(r, i) => {
                      const p = r.profiles; const sess = r.sessions;
                      return <Row key={`${p.id}-${sess?.id}-${i}`} title={p.full_name || usernameOf(p.email)}
                        sub={[usernameOf(p.email), sess?.name].filter(Boolean).join(' · ')}
                        onClick={() => sess?.id && go(`/trainer/sessions/${sess.id}`)} />;
                    }} />

                  {results.staff && (
                    <Group title="Staff" items={results.staff}
                      render={s => <Row key={s.id} title={s.full_name || s.email} sub={s.email}
                        onClick={() => go('/trainer/staff')} />} />
                  )}
                  {results.vendors && (
                    <Group title="Vendors" items={results.vendors}
                      render={v => <Row key={v.id} title={v.name} sub={v.code}
                        onClick={() => go(`/trainer/vendors/${v.id}/sessions`)} />} />
                  )}
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function Group({ title, items, render, note }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="search-group">
      <div className="search-group-head">{title}</div>
      {note && <div className="search-group-note">{note}</div>}
      {items.map(render)}
    </div>
  );
}

function Row({ title, sub, onClick }) {
  return (
    <button type="button" className="search-row" onClick={onClick}>
      <span className="search-row-title">{title}</span>
      {sub && <span className="search-row-sub">{sub}</span>}
    </button>
  );
}
