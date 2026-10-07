import { useEffect, useState } from 'react';
import { signedWorkbookImageUrl } from '../../lib/workbookImages.js';

// One picture from the workbook-images bucket, fetched through a signed URL.
// Used by table cells (kind 'image'); prose pictures are filled in by
// useSignedWorkbookHtml instead, because prose is drawn as raw HTML.
export default function WbImage({ path, alt = '' }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setFailed(false);
    if (!path) return undefined;
    signedWorkbookImageUrl(path)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error || !data) setFailed(true);
        else setUrl(data);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [path]);

  if (failed) return <span className="wb-img-missing-note">Picture unavailable</span>;
  if (!url) return <span className="wb-img-loading" aria-hidden="true" />;
  return <img className="wb-img" src={url} alt={alt} onError={() => setFailed(true)} />;
}

// The pictures in an image cell, then any wording that sat beside them.
export function ImageCell({ cell }) {
  return (
    <span className="wb-cell-image-stack">
      {(cell.images || []).map(p => <WbImage key={p} path={p} />)}
      {cell.text && <span className="wb-cell-image-text">{cell.text}</span>}
    </span>
  );
}
