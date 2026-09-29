import { useEffect, useMemo, useRef, useState } from 'react';
import { SkeletonCards } from '../components/Skeleton.jsx';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBusyOverlay } from '../contexts/BusyOverlayContext.jsx';
import { useAssessments } from '../hooks/useAssessments.js';
import { shortDate } from '../lib/programReadiness.js';
import BankQuestionBrowser from '../components/BankQuestionBrowser.jsx';
import TopBar from '../components/TopBar.jsx';
import '../styles/dashboard.css';
import '../styles/editor.css';
import '../styles/question-bank.css';

// The question bank library, in the cockpit — the same shape as Assessments,
// which is the same shape as Workbooks. One visual language.
//
// WHAT THIS PAGE IS FOR is not listing bank titles, which are few and were
// never in doubt, but the two questions a list of names cannot answer: can
// these questions be MARKED, and is anyone using them. A question with no
// answer key cannot be marked in any paper that takes it, and a bank nobody
// draws from is work nobody found.
//
// NO PAGE HEADING and no line defining the word: the rail and the app bar both
// already say Question bank.
export default function QuestionBankListPage() {
  const navigate = useNavigate();
  const { session: authSession } = useAuth();
  const { run: runBusy } = useBusyOverlay();
  const { loading, error, assessments: banks, createAssessment } = useAssessments({
    kind: 'bank',
    bankDetail: true,
  });

  const [filter, setFilter] = useState('all');   // 'all' | 'unkeyed' | 'unused'
  const [find, setFind] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  // Mount and open are one pair of frames apart — a transition needs a previous
  // state to travel from, and clearing the selection on close would unmount the
  // panel before it could travel back. Same pattern as the other two libraries.
  const [panelOpen, setPanelOpen] = useState(false);
  // Which bank is being READ. Browsing replaces the grid rather than opening a
  // second page: the 380px panel cannot host a question, and a question is what
  // you came to look at.
  const [browsingId, setBrowsingId] = useState(null);

  const stats = useMemo(() => {
    let questions = 0; let unkeyed = 0; let byHand = 0; let used = 0;
    const topics = new Set();
    for (const b of banks) {
      const d = b.bank || {};
      questions += d.questions || 0;
      unkeyed += d.unkeyed || 0;
      byHand += d.byHand || 0;
      used += d.used || 0;
      (d.topics || []).forEach(t => topics.add(t));
    }
    return { questions, unkeyed, byHand, used, topics: topics.size, keyed: questions - unkeyed - byHand };
  }, [banks]);

  const unkeyedBanks = banks.filter(b => (b.bank?.unkeyed || 0) > 0).length;
  const unusedBanks = banks.filter(b => (b.bank?.used || 0) === 0).length;

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return banks.filter(b => {
      if (filter === 'unkeyed' && !(b.bank?.unkeyed > 0)) return false;
      if (filter === 'unused' && (b.bank?.used || 0) > 0) return false;
      if (!q) return true;
      // Topics are searched too, the same as the bank picker: a bank is looked
      // for by what is in it.
      return `${b.title} ${b.description || ''} ${(b.bank?.topics || []).join(' ')}`
        .toLowerCase().includes(q);
    });
  }, [banks, filter, find]);

  // Held on the FULL list so the panel still has something to draw while it
  // slides out after a filter hides the card.
  const selected = banks.find(b => b.id === selectedId) || null;
  const browsing = banks.find(b => b.id === browsingId) || null;

  function openPanel(id) {
    setSelectedId(id);
    requestAnimationFrame(() => requestAnimationFrame(() => setPanelOpen(true)));
  }
  function closePanel() { setPanelOpen(false); }

  useEffect(() => {
    if (!panelOpen) return undefined;
    const onKey = e => { if (e.key === 'Escape') closePanel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  useEffect(() => {
    if (panelOpen && selectedId && !shown.some(b => b.id === selectedId)) closePanel();
  }, [panelOpen, selectedId, shown]);

  if (browsing) {
    return (
      <>
        <TopBar />
        <main className="page dashboard library-page qb-library">
          <BankQuestionBrowser bank={browsing} onBack={() => setBrowsingId(null)} />
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <main className="page dashboard library-page qb-library">
        <section className="page-hero compact cockpit-hero">
          <div className="cockpit-hero-row">
            <div className="view-tabs" role="group" aria-label="Show question banks">
              {[
                ['all', `All · ${banks.length}`],
                ['unkeyed', `With unkeyed · ${unkeyedBanks}`],
                ['unused', `Never drawn from · ${unusedBanks}`],
              ].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={`view-tab ${filter === k ? 'active' : ''}`}
                  aria-pressed={filter === k}
                  onClick={() => setFilter(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="page-hero-actions">
              <input
                type="search"
                className="form-input wb-find"
                placeholder="Find a bank or a topic…"
                aria-label="Find a bank or a topic"
                value={find}
                onChange={e => setFind(e.target.value)}
              />
              {/* The create form was a whole card sitting above the library,
                  permanently open for a thing you do a few times a year. It is
                  a button that becomes a field, like the other two libraries. */}
              <NewBankControl
                onCreate={async title => {
                  const { data, error: err } = await runBusy(
                    'Creating question bank…',
                    () => createAssessment({ title, created_by: authSession?.user.id }),
                  );
                  if (err) return err.message;
                  if (data?.id) navigate(`/trainer/question-bank/${data.id}`);
                  return null;
                }}
              />
            </div>
          </div>
        </section>

        {loading && <SkeletonCards count={4} label="Loading question banks…" />}
        {error && <p className="error">{error}</p>}

        {!loading && !error && banks.length > 0 && (
          <section className="cockpit-gauges wb-gauges" aria-label="The question bank at a glance">
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">Questions</div>
                <div className="cockpit-gauge-value">{stats.questions}</div>
                <div className="cockpit-gauge-hint">
                  across {banks.length} bank{banks.length === 1 ? '' : 's'}
                </div>
              </div>
            </div>
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">Keyed</div>
                <div className="cockpit-gauge-value">
                  {stats.keyed}<small> / {stats.questions}</small>
                </div>
                <div className="cockpit-gauge-hint">marked automatically</div>
              </div>
            </div>
            {/* Not a fault. A written answer or a PNR build has no key BY
                DESIGN, and flagging those would paint a scenario bank red for
                being what it is. */}
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">Marked by hand</div>
                <div className={`cockpit-gauge-value${stats.byHand ? '' : ' is-muted'}`}>{stats.byHand}</div>
                <div className="cockpit-gauge-hint">
                  {stats.byHand ? 'written + PNR answers' : 'none in the library'}
                </div>
              </div>
            </div>
            {/* The one gauge that is a fault: a question nothing can mark. */}
            <div className={`cockpit-gauge ${stats.unkeyed > 0 ? 'is-bad' : ''}`}>
              <div>
                <div className="cockpit-gauge-label">Unkeyed</div>
                <div className={`cockpit-gauge-value${stats.unkeyed ? '' : ' is-muted'}`}>{stats.unkeyed}</div>
                <div className="cockpit-gauge-hint">
                  {stats.unkeyed ? 'cannot be marked at all' : 'every question has a key'}
                </div>
              </div>
            </div>
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">In papers</div>
                <div className="cockpit-gauge-value">
                  {stats.used}<small> / {stats.questions}</small>
                </div>
                <div className="cockpit-gauge-hint">
                  {stats.questions - stats.used} never picked
                </div>
              </div>
            </div>
            <div className="cockpit-gauge">
              <div>
                <div className="cockpit-gauge-label">Topics</div>
                <div className={`cockpit-gauge-value${stats.topics ? '' : ' is-muted'}`}>{stats.topics}</div>
                <div className="cockpit-gauge-hint">
                  {stats.topics ? 'to search and draw by' : 'none tagged yet'}
                </div>
              </div>
            </div>
          </section>
        )}

        {!loading && !error && banks.length === 0 && (
          <p className="cockpit-empty">
            No question banks yet. Use + New question bank to make the first one.
          </p>
        )}

        {!loading && banks.length > 0 && (
          <div className="wb-room">
            <section className="wb-pane">
              {shown.length === 0 && <p className="cockpit-empty">Nothing here with this filter.</p>}

              {shown.length > 0 && (
                <div className="wb-grid">
                  {/* One control per card: it opens the details, and nothing
                      else. Browse and Open editor live in the panel. */}
                  {shown.map(b => {
                    const on = selected?.id === b.id;
                    const d = b.bank || {};
                    return (
                      <article
                        key={b.id}
                        className={`wb-card${on ? ' is-selected' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-expanded={on && panelOpen}
                        onClick={() => (on && panelOpen ? closePanel() : openPanel(b.id))}
                        onKeyDown={e => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          if (on && panelOpen) closePanel(); else openPanel(b.id);
                        }}
                      >
                        <div className="wb-card-body">
                          <div className="wb-card-top">
                            <h3 className="wb-card-title">{b.title}</h3>
                            {d.unkeyed > 0 && <span className="wb-pill is-bad">{d.unkeyed} unkeyed</span>}
                            {/* "unused", the same word the assessment library
                                uses for the same state — and short enough to
                                sit beside another pill on a 15rem card. */}
                            {d.questions > 0 && d.used === 0 && (
                              <span className="wb-pill is-idle">unused</span>
                            )}
                          </div>
                          {b.description && <p className="wb-card-desc">{b.description}</p>}
                          <p className="wb-card-facts">
                            <span>
                              <b>{d.questions || 0}</b> question{d.questions === 1 ? '' : 's'}
                            </span>
                            <span><b>{d.used || 0}</b> in papers</span>
                            {d.topics?.length > 0 && (
                              <span><b>{d.topics.length}</b> topic{d.topics.length === 1 ? '' : 's'}</span>
                            )}
                            <span>Updated <b>{shortDate(b.updated_at)}</b></span>
                          </p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {selectedId && (
          <>
            <div
              className={`wb-rail-backdrop${panelOpen ? ' visible' : ''}`}
              onClick={closePanel}
              aria-hidden="true"
            />
            <aside
              className={`wb-rail-panel${panelOpen ? ' open' : ''}`}
              role="dialog"
              aria-modal="true"
              aria-label="Question bank details"
              aria-hidden={panelOpen ? undefined : 'true'}
              onTransitionEnd={e => {
                if (e.propertyName === 'transform' && !panelOpen) setSelectedId(null);
              }}
            >
              {selected && (
                <div className="wb-rail-card">
                  <div className="wb-rail-head">
                    <h2>{selected.title}</h2>
                    <button type="button" className="icon-btn" aria-label="Close details" onClick={closePanel}>×</button>
                  </div>
                  {selected.description && <p className="wb-rail-desc">{selected.description}</p>}

                  <dl className="wb-rail-facts">
                    <div><dt>Questions</dt><dd>{selected.bank?.questions || 'none yet'}</dd></div>
                    <div><dt>Marked by hand</dt><dd>{selected.bank?.byHand || 'none'}</dd></div>
                    <div><dt>Unkeyed</dt><dd>{selected.bank?.unkeyed
                      ? <span className="wb-unkeyed">{selected.bank.unkeyed} cannot be marked</span>
                      : 'none'}</dd></div>
                    <div><dt>In papers</dt><dd>
                      {selected.bank?.used || 0} of {selected.bank?.questions || 0}
                    </dd></div>
                    <div><dt>Updated</dt><dd>{shortDate(selected.updated_at)}</dd></div>
                  </dl>

                  {selected.bank?.topics?.length > 0 && (
                    <div className="wb-rail-classes">
                      <h3>Topics</h3>
                      <div className="qb-topic-wrap">
                        {selected.bank.topics.map(t => (
                          <span key={t} className="qb-topic">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="wb-rail-actions">
                    <button
                      type="button"
                      className="primary-link"
                      onClick={() => { setBrowsingId(selected.id); closePanel(); }}
                    >
                      Browse questions
                    </button>
                    <Link to={`/trainer/question-bank/${selected.id}`} className="ghost-link">Open editor</Link>
                  </div>
                </div>
              )}
            </aside>
          </>
        )}
      </main>
    </>
  );
}

// A button that becomes a field, the same control the other two libraries use —
// so the library is not permanently sharing the page with a form for something
// you do a few times a year.
function NewBankControl({ onCreate }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!open) {
    return <button type="button" className="lib-new-btn" onClick={() => setOpen(true)}>+ New question bank</button>;
  }

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true); setErr('');
    const message = await onCreate(title.trim());
    setBusy(false);
    if (message) setErr(message);
  }

  return (
    <form className="lib-new-form" onSubmit={submit}>
      <input
        ref={inputRef}
        id="new-bank-title"
        className="form-input"
        placeholder="e.g. Reservations & Ticketing — question bank"
        value={title}
        maxLength={120}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setTitle(''); setErr(''); } }}
      />
      <button type="submit" disabled={busy || !title.trim()}>{busy ? 'Creating…' : 'Create'}</button>
      <button type="button" className="ghost" onClick={() => { setOpen(false); setTitle(''); setErr(''); }}>Cancel</button>
      {err && <p className="error">{err}</p>}
    </form>
  );
}
