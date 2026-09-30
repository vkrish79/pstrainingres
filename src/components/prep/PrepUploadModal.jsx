import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';
import { useVendors } from '../../hooks/useVendors.js';
import { WORKBOOK_PREP_KIND, ASSESSMENT_PREP_KIND } from '../../hooks/useContentPrep.js';
import { useContentPrepBalances } from '../../hooks/useContentPrepBalances.js';
import { usePrepPool } from '../../hooks/usePrepPool.js';
import { PrepPoolBody, PrepPoolActions } from './PrepPool.jsx';
import { isSuperTrainerOrAbove } from '../../lib/roles.js';
import '../../styles/prep.css';
import '../../styles/prep-page.css';

// Per-kind static config for the modal — which prep tables, which template
// container table, and the label terms shown to the trainer.
const KINDS = {
  workbook: {
    label: 'workbook',
    labelPlural: 'workbooks',
    parentTable: 'workbooks',
    parentSelect: 'id, title, prep_template',
    prepKind: WORKBOOK_PREP_KIND,
  },
  assessment: {
    label: 'assessment',
    labelPlural: 'assessments',
    parentTable: 'assessments',
    // `kind` exists on assessments only (a question bank is an assessments row
    // with kind='bank'). Naming it on workbooks is a 400 that reads as "no
    // templates", which is why the two selects differ.
    parentSelect: 'id, title, prep_template, kind',
    prepKind: ASSESSMENT_PREP_KIND,
  },
};

// The Prep pop-up (opened from the home page's prep gauge). Pick a kind
// (workbook / assessment), pick a parent → (super) pick a pool → download the
// empty template, fill it, upload to append kits, see the balance. Super uploads
// only to the shared super pool; selecting a vendor pool is balance-only.
// Vendor-tier is locked to their own pool.
//
// The quick look. The Prep PAGE (pages/PrepPage.jsx) is the cockpit; both draw a
// pool from the same usePrepPool state and the same PrepPool pieces, so there is
// one copy of the stocking logic. "⤢ Full page" hands the selection over.
export default function PrepUploadModal({ onClose, profile }) {
  const isSuper = isSuperTrainerOrAbove(profile?.role);
  const navigate = useNavigate();
  useBodyScrollLock(true);
  const { vendors } = useVendors();

  const [kind, setKind] = useState('workbook');
  const cfg = KINDS[kind];

  const [templates, setTemplates] = useState([]);
  const [tplLoading, setTplLoading] = useState(true);
  const [selectedParentId, setSelectedParentId] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState(''); // '' = super pool

  // Load templates whenever the kind changes — same query shape across kinds.
  useEffect(() => {
    let cancelled = false;
    setTplLoading(true);
    (async () => {
      const { data } = await supabase
        .from(cfg.parentTable)
        .select(cfg.parentSelect)
        .eq('is_template', true)
        .order('title');
      if (cancelled) return;
      // A question bank cannot take prep — nobody sits a bank.
      setTemplates((data || []).filter(t => t.kind !== 'bank'));
      setTplLoading(false);
    })();
    return () => { cancelled = true; };
  }, [cfg.parentTable, cfg.parentSelect]);

  // Esc closes the modal.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Modal → full page: carry the current selection across via query params.
  function goFullPage() {
    const params = new URLSearchParams();
    params.set('kind', kind);
    if (selectedVendorId) params.set('vendor', selectedVendorId);
    if (selectedParentId) params.set('parent', selectedParentId);
    onClose?.();
    navigate(`/trainer/prep?${params.toString()}`);
  }

  const selectedParent = templates.find(t => t.id === selectedParentId) || null;

  const partitionVendorId = isSuper ? (selectedVendorId || null) : (profile?.vendor_id || null);
  const canWrite = isSuper ? (partitionVendorId == null) : !!profile?.vendor_id;

  // usePrepPool clears its own upload / edit state when the pool changes.
  const pool = usePrepPool(cfg.prepKind, selectedParent, partitionVendorId);

  // Balances for every parent of this kind in the selected pool.
  const { byParent, loading: overviewLoading } = useContentPrepBalances(cfg.prepKind, partitionVendorId);

  function changeKind(nextKind) {
    if (nextKind === kind) return;
    setKind(nextKind);
    setSelectedParentId('');
  }

  return (
    <div className="modal-backdrop visible" onClick={onClose}>
      <div className="modal-card prep-upload-modal" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <h2>🎯 Prep — balance &amp; upload</h2>
          <div className="prep-head-actions">
            <button type="button" className="ghost prep-fullpage-btn" onClick={goFullPage}>⤢ Full page</button>
            <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
          </div>
        </header>
        <div className="modal-body">
          <div className="prep-kind-tabs" role="tablist" aria-label="Prep kind">
            {Object.entries(KINDS).map(([k, c]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                className={`prep-kind-tab ${kind === k ? 'active' : ''}`}
                onClick={() => changeKind(k)}
              >
                {c.labelPlural[0].toUpperCase() + c.labelPlural.slice(1)}
              </button>
            ))}
          </div>

          {isSuper && (
            <div className="prep-pickers">
              <label className="form-label">
                Pool
                <select className="form-input" value={selectedVendorId} onChange={e => setSelectedVendorId(e.target.value)}>
                  <option value="">Super (shared)</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
            </div>
          )}

          <div className="prep-scroll">
            {!selectedParentId ? (
              <div className="prep-overview">
                <p className="muted prep-overview-hint">
                  {isSuper ? `Showing the ${selectedVendorId ? (vendors.find(v => v.id === selectedVendorId)?.name || 'vendor') : 'Super (shared)'} pool. ` : ''}
                  Click {cfg.label === 'assessment' ? 'an' : 'a'} {cfg.label} to upload or manage its kits.
                </p>
                {(tplLoading || overviewLoading) ? (
                  <p className="muted">Loading…</p>
                ) : templates.length === 0 ? (
                  <p className="muted">No {cfg.labelPlural} yet.</p>
                ) : (
                  <ul className="prep-overview-list">
                    {templates.map(t => {
                      const hasTpl = Array.isArray(t.prep_template) && t.prep_template.length > 0;
                      const b = byParent[t.id] || { total: 0, fullyPreppable: 0 };
                      const fp = b.fullyPreppable ?? 0;
                      const pct = b.total ? Math.round((fp / b.total) * 100) : 0;
                      const cls = fp === 0 ? 'none' : (fp <= b.total * 0.25 ? 'low' : 'ok');
                      return (
                        <li key={t.id}>
                          <button type="button" className="prep-overview-row" onClick={() => setSelectedParentId(t.id)}>
                            <span className="prep-overview-title">{t.title}</span>
                            {b.total > 0 ? (
                              <>
                                <span className={`prep-bar ${cls}`}><span className="prep-bar-fill" style={{ width: `${pct}%` }} /></span>
                                <span className="prep-bar-count">{fp} / {b.total}</span>
                              </>
                            ) : (
                              <>
                                <span className="prep-bar"><span className="prep-bar-fill" style={{ width: '0%' }} /></span>
                                <span className="prep-overview-flag">{hasTpl ? 'empty' : 'no template'}</span>
                              </>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : (
              <>
                <button type="button" className="prep-back" onClick={() => setSelectedParentId('')}>← All {cfg.labelPlural}</button>
                <h3 className="prep-detail-title">{selectedParent?.title}</h3>
                <PrepPoolBody pool={pool} kind={kind} canWrite={canWrite} />
              </>
            )}
          </div>
        </div>
        {pool.showActions && (
          <footer className="modal-foot prep-modal-foot">
            <PrepPoolActions pool={pool} canWrite={canWrite} />
          </footer>
        )}
      </div>
    </div>
  );
}
