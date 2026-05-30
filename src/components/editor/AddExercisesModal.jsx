import { useEffect, useMemo, useState } from 'react';
import { useBusyOverlay } from '../../contexts/BusyOverlayContext.jsx';
import { supabase } from '../../lib/supabase.js';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';
import Block from '../blocks/Block.jsx';
import {
  renumberExercisesIn,
  WORKBOOK_CONTENT_KIND,
} from '../../lib/exerciseNumbering.js';
import '../../styles/workbook.css';

// Compose-from-existing picker. Pick a same-kind source (workbook→workbook
// or assessment→assessment), preview its exercises (sections), multi-select,
// and add the chosen ones to the current parent. Re-openable per source so a
// parent can be built from several sources.
//
// Defaults to workbook for backwards compatibility — WorkbookEditorPage's
// existing call site needs no changes.
export default function AddExercisesModal({
  currentParentId,
  currentWorkbookId, // legacy alias
  onClose,
  onAdded,
  kindConfig = WORKBOOK_CONTENT_KIND,
}) {
  const targetId = currentParentId ?? currentWorkbookId;
  const {
    parentTable, sectionsTable, blocksTable, parentFK,
    prepTemplateCol, addRpc, addRpcParams, label,
  } = kindConfig;

  const { run: runBusy } = useBusyOverlay();
  useBodyScrollLock();

  const [templates, setTemplates] = useState([]);
  const [sourceId, setSourceId] = useState('');
  const [sections, setSections] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [preppedIds, setPreppedIds] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [expanded, setExpanded] = useState(new Set());
  const [loadingSrc, setLoadingSrc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Source parents = all templates of the same kind except the one being edited.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from(parentTable)
        .select(`id, title, ${prepTemplateCol}`)
        .eq('is_template', true)
        .order('title');
      if (cancelled) return;
      setTemplates((data || []).filter(w => w.id !== targetId));
    })();
    return () => { cancelled = true; };
  }, [targetId, parentTable, prepTemplateCol]);

  // Load the chosen source's sections + blocks + which sections carry prep.
  useEffect(() => {
    if (!sourceId) { setSections([]); setBlocks([]); setPreppedIds(new Set()); return; }
    let cancelled = false;
    (async () => {
      setLoadingSrc(true); setError(''); setSelected(new Set()); setExpanded(new Set());
      try {
        const wb = templates.find(t => t.id === sourceId);
        const tpl = wb?.[prepTemplateCol];
        const prepped = new Set(
          (Array.isArray(tpl) ? tpl : []).map(e => e?.section_id).filter(Boolean),
        );
        const { data: secsAll, error: e1 } = await supabase
          .from(sectionsTable).select('id, title, order_index, kind').eq(parentFK, sourceId).order('order_index');
        if (e1) throw e1;
        // Group sections (Word H1 banners) are visual separators, not
        // exercises — hide them from the picker so trainers can't tick a
        // section that holds no copyable content.
        const secs = (secsAll || []).filter(s => s.kind !== 'group');
        const ids = secs.map(s => s.id);
        const { data: blks, error: e2 } = ids.length
          ? await supabase.from(blocksTable).select('id, section_id, block_type, config, order_index').in('section_id', ids).order('order_index')
          : { data: [], error: null };
        if (e2) throw e2;
        if (cancelled) return;
        setSections(secs || []);
        setBlocks(blks || []);
        setPreppedIds(prepped);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoadingSrc(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sourceId, templates, sectionsTable, blocksTable, parentFK, prepTemplateCol]);

  const blocksBySection = useMemo(() => {
    const m = new Map();
    for (const b of blocks) { if (!m.has(b.section_id)) m.set(b.section_id, []); m.get(b.section_id).push(b); }
    return m;
  }, [blocks]);

  function toggle(setFn, id) {
    setFn(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    setBusy(true); setError(''); setNotice('');
    const ids = sections.filter(s => selected.has(s.id)).map(s => s.id);
    const srcTitle = templates.find(t => t.id === sourceId)?.title || '';
    const { data, error: e } = await runBusy(
      `Adding ${ids.length} exercise${ids.length === 1 ? '' : 's'}…`,
      async () => {
        const r = await supabase.rpc(addRpc, addRpcParams(targetId, ids));
        if (!r.error) await renumberExercisesIn({ sectionsTable, parentFK }, targetId);
        return r;
      },
    );
    setBusy(false);
    if (e) { setError(e.message); return; }
    setNotice(`Added ${data} exercise${data === 1 ? '' : 's'} from "${srcTitle}". Pick more or close.`);
    setSelected(new Set());
    await onAdded?.();
  }

  const sourceTitle = templates.find(t => t.id === sourceId)?.title || '';

  return (
    <div className="modal-backdrop visible" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '760px', width: '92vw' }}>
        <header className="modal-head">
          <h2>➕ Add exercises from another {label}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <label className="form-label">Source {label}</label>
          <select className="form-input" value={sourceId} onChange={e => setSourceId(e.target.value)}>
            <option value="">Select a {label}…</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>

          {notice && <p className="prep-notice" style={{ marginTop: '0.75rem' }}>{notice}</p>}
          {error && <p className="error">{error}</p>}

          {sourceId && (
            <p className="muted" style={{ marginTop: '0.75rem' }}>
              Tick the exercises to copy. Ones marked <span className="type-tag">prep</span> will draw their prep
              from <strong>{sourceTitle}</strong>’s pool when this {label} runs.
            </p>
          )}

          {loadingSrc && <div className="loading">Loading…</div>}

          {!loadingSrc && sourceId && sections.length === 0 && (
            <p className="muted">This {label} has no exercises.</p>
          )}

          {!loadingSrc && sections.length > 0 && (
            <div className="picker-list">
              {sections.map(s => {
                const secBlocks = blocksBySection.get(s.id) || [];
                const isOpen = expanded.has(s.id);
                return (
                  <div key={s.id} className={`picker-row ${selected.has(s.id) ? 'picked' : ''}`}>
                    <label className="picker-head">
                      <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(setSelected, s.id)} />
                      <span className="picker-title">{s.title}</span>
                      {preppedIds.has(s.id) && <span className="type-tag">prep</span>}
                      <span className="muted picker-count">{secBlocks.length} block{secBlocks.length === 1 ? '' : 's'}</span>
                      <button type="button" className="ghost picker-toggle" onClick={(e) => { e.preventDefault(); toggle(setExpanded, s.id); }}>
                        {isOpen ? 'Hide' : 'Preview'}
                      </button>
                    </label>
                    {isOpen && (
                      <div className="picker-preview">
                        {secBlocks.length === 0 && <p className="muted">(empty)</p>}
                        {secBlocks.map(b => (
                          <Block key={b.id} block={b} value={undefined} onChange={() => {}} readOnly />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <footer className="modal-foot">
          <button type="button" className="ghost" onClick={onClose}>Close</button>
          <button type="button" onClick={handleAdd} disabled={busy || selected.size === 0}>
            {busy ? 'Adding…' : `Add ${selected.size || ''} exercise${selected.size === 1 ? '' : 's'}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
