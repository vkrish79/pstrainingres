import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock.js';
import { useGlobalSearch } from '../hooks/useGlobalSearch.js';
import { isSuperTrainerOrAbove } from '../lib/roles.js';
import '../styles/search.css';

// Username is the local-part of the synthesized participant email.
function usernameOf(email) {
  return (email || '').split('@')[0] || email || '';
}

// The shortcut as this keyboard writes it. ⌘ means nothing on Windows.
const IS_MAC = typeof navigator !== 'undefined'
  && /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || '');
const SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K';

// Things to DO rather than find, offered at the top before anything is typed
// and whenever the typing matches them. Gated by role exactly as the real
// buttons are. Each opens the same drawer or dialog its page's own button does.
function actionsFor(role) {
  const out = [{ title: 'New session', sub: 'Sessions', path: '/trainer?new=1' }];
  if (isSuperTrainerOrAbove(role)) out.push({ title: 'New workbook', sub: 'Workbooks', path: '/trainer/workbooks?new=1' });
  return out;
}

// TopBar trigger + ⌘K / Ctrl+K overlay. Results are RLS-scoped per role; which
// GROUPS appear is gated here (Staff/Vendors super-only).
//
// ONE FLAT LIST drives both what is drawn and what the arrow keys move
// through. Building the two separately is how the highlighted row and the row
// Enter opens drift apart.
export default function GlobalSearch() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const { loading, results, failed } = useGlobalSearch(open ? term : '', profile?.role);

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

  const rows = useMemo(() => {
    const q = term.trim().toLowerCase();
    const out = [];
    const add = (group, items, map) => (items || []).forEach(x => out.push({ group, ...map(x) }));

    const actions = actionsFor(profile?.role).filter(a => !q || a.title.toLowerCase().includes(q));
    if (!hasTerm || !results) {
      add('Do something', actions, a => ({ key: a.path, title: a.title, sub: a.sub, path: a.path }));
      return out;
    }
    add('Workbooks', results.workbooks, w => ({
      key: `w-${w.id}`, title: w.title || 'Untitled', sub: w.description, path: `/trainer/workbooks/${w.id}`,
    }));
    add('Exercises', results.exercises, x => ({
      key: `x-${x.id}`,
      title: x.title,
      sub: [x.kind === 'group' ? 'Topic' : null, x.workbooks?.title].filter(Boolean).join(' · '),
      path: `/trainer/workbooks/${x.workbook_id}?s=${x.open_id || x.id}`,
    }));
    add('Sessions', results.sessions, s => ({
      key: `s-${s.id}`, title: s.name,
      sub: [s.city_code, s.closed_at ? 'Closed' : null].filter(Boolean).join(' · '),
      path: `/trainer/sessions/${s.id}`,
    }));
    (results.participants || []).forEach((r, i) => {
      const p = r.profiles; const sess = r.sessions;
      if (!sess?.id) return;
      out.push({
        group: 'Participants', key: `p-${p.id}-${sess.id}-${i}`,
        title: p.full_name || usernameOf(p.email),
        sub: [usernameOf(p.email), sess.name].filter(Boolean).join(' · '),
        path: `/trainer/sessions/${sess.id}`,
      });
    });
    add('Staff', results.staff, s => ({
      key: `st-${s.id}`, title: s.full_name || s.email, sub: s.email, path: '/trainer/settings?tab=staff',
    }));
    add('Vendors', results.vendors, v => ({
      key: `v-${v.id}`, title: v.name, sub: v.code, path: `/trainer/vendors/${v.id}/sessions`,
    }));
    add('Do something', actions, a => ({ key: a.path, title: a.title, sub: a.sub, path: a.path }));
    return out;
  }, [results, hasTerm, term, profile?.role]);

  // A new list starts at its first row; never point past the end.
  useEffect(() => { setActive(0); }, [rows]);

  // Keep the highlighted row on screen while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function onInputKey(e) {
    if (!rows.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % rows.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + rows.length) % rows.length); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows[Math.min(active, rows.length - 1)]; if (r) go(r.path); }
  }

  const found = rows.filter(r => r.group !== 'Do something').length;
  // Drawn grouped, but every row keeps its index in `rows` — that index is
  // what the arrow keys and Enter use.
  const groups = [];
  rows.forEach((r, i) => {
    const last = groups[groups.length - 1];
    if (last && last.name === r.group) last.rows.push({ r, i });
    else groups.push({ name: r.group, rows: [{ r, i }] });
  });

  return (
    <>
      <button type="button" className="topbar-search-btn" onClick={() => setOpen(true)} title={`Search (${SHORTCUT})`}>
        <span aria-hidden>🔍</span> Search<span className="topbar-search-kbd">{SHORTCUT}</span>
      </button>

      {open && createPortal(
        <div className="search-backdrop visible" onClick={() => setOpen(false)}>
          <div className="search-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label="Global search">
            <input
              className="search-input"
              autoFocus
              placeholder="Search workbooks, exercises, sessions, participants…"
              value={term}
              onChange={e => setTerm(e.target.value)}
              onKeyDown={onInputKey}
              role="combobox"
              aria-expanded={rows.length > 0}
              aria-controls="search-results"
              aria-activedescendant={rows.length ? `search-row-${active}` : undefined}
            />
            <div className="search-results" id="search-results" role="listbox" ref={listRef}>
              {!hasTerm && <p className="search-hint">Type at least 2 characters to search.</p>}
              {hasTerm && loading && <p className="search-hint">Searching…</p>}
              {hasTerm && !loading && failed && (
                <p className="search-hint search-failed" role="alert">
                  Couldn't search just now — the connection may have dropped. Results below may be incomplete.
                </p>
              )}
              {hasTerm && !loading && results && !failed && found === 0 && (
                <p className="search-hint">No matches for “{term.trim()}”.</p>
              )}
              {!loading && groups.map(g => (
                <div key={g.name} className="search-group" role="group" aria-label={g.name}>
                  <div className="search-group-head">{g.name}</div>
                  {g.name === 'Participants' && (
                    <div className="search-group-note">Live participants only — closed sessions aren’t searchable yet.</div>
                  )}
                  {g.rows.map(({ r, i }) => (
                    <button
                      key={r.key}
                      type="button"
                      id={`search-row-${i}`}
                      data-row={i}
                      role="option"
                      aria-selected={i === active}
                      className={`search-row${i === active ? ' is-active' : ''}`}
                      onMouseMove={() => { if (i !== active) setActive(i); }}
                      onClick={() => go(r.path)}
                    >
                      <span className="search-row-title">{r.group === 'Do something' ? `+ ${r.title}` : r.title}</span>
                      {r.sub && <span className="search-row-sub">{r.sub}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="search-keys" aria-hidden="true">
              <kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
