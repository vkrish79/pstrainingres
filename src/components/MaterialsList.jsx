import { useEffect, useState } from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock.js';

const KIND_LABEL = { handout: 'Handout', quick_ref: 'Quick ref' };
const KIND_ORDER = { handout: 0, quick_ref: 1 };

// Shared materials list used by the participant workbook page and the trainer
// session dashboard. Thumbnail tiles; click → modal preview with an iframe of
// the signed URL. Modal has a "Pop out" action to open the PDF in a new tab.
export default function MaterialsList({ materials, signedUrlFor, loading, title = 'Program materials' }) {
  const [open, setOpen] = useState(null);     // material being previewed
  const [url, setUrl] = useState('');
  const [opening, setOpening] = useState(null);
  const [error, setError] = useState('');

  useBodyScrollLock(!!open);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape') setOpen(null); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (loading) return null;
  if (!materials?.length) return null;

  const sorted = [...materials].sort((a, b) => {
    const ka = KIND_ORDER[a.kind] ?? 99;
    const kb = KIND_ORDER[b.kind] ?? 99;
    if (ka !== kb) return ka - kb;
    return (a.sort_order || 0) - (b.sort_order || 0);
  });

  async function preview(material) {
    setError('');
    setOpening(material.id);
    const { data, error: e } = await signedUrlFor(material);
    setOpening(null);
    if (e) { setError(e.message); return; }
    setUrl(data);
    setOpen(material);
  }

  function popOut() {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  function close() { setOpen(null); setUrl(''); }

  return (
    <section className="materials-list">
      <h3 className="materials-list-title">{title}</h3>
      {error && <p className="form-error">{error}</p>}
      <ul className="materials-thumbs">
        {sorted.map(m => (
          <li key={m.id}>
            <button
              type="button"
              className="material-thumb"
              onClick={() => preview(m)}
              disabled={opening === m.id}
              title={`Open ${m.title}`}
            >
              <div className="material-thumb-canvas" aria-hidden>
                <div className="material-thumb-page">
                  <div className="material-thumb-line" />
                  <div className="material-thumb-line" />
                  <div className="material-thumb-line short" />
                  <div className="material-thumb-line" />
                  <div className="material-thumb-line short" />
                </div>
                <div className="material-thumb-corner">PDF</div>
              </div>
              <div className="material-thumb-meta">
                <span className={`material-thumb-kind material-thumb-kind-${m.kind}`}>{KIND_LABEL[m.kind] || m.kind}</span>
                <span className="material-thumb-label">{opening === m.id ? 'Opening…' : m.title}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {open && (
        <div className="material-modal-backdrop" onClick={close} role="presentation">
          <div className="material-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={open.title}>
            <div className="material-modal-head">
              <div className="material-modal-title">{open.title}</div>
              <div className="material-modal-actions">
                <button type="button" className="ghost" onClick={popOut} title="Open in a new tab">
                  ↗ Pop out
                </button>
                <button type="button" className="icon-btn" onClick={close} aria-label="Close">×</button>
              </div>
            </div>
            <iframe className="material-modal-frame" src={url} title={open.title} />
          </div>
        </div>
      )}
    </section>
  );
}
