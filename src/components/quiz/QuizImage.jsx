import { useEffect, useState } from 'react';
import { signedQuizImageUrl } from '../../lib/quizImages.js';

// A picture belonging to a question, fetched through a signed URL.
//
// The WRAPPER is rendered the moment a path exists, before the bitmap has
// arrived, and the CSS gives it its space from a flex basis rather than from
// the image's own dimensions. That is the whole point: on the projector the
// options sit underneath, and an image that claimed its height on load would
// shove them down the screen a second into a question the room is already
// reading.
export default function QuizImage({ path, alt = '', className = '', onClick, title }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setFailed(false);
    if (!path) return undefined;
    signedQuizImageUrl(path)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error || !data) setFailed(true);
        else setUrl(data);
      })
      // A THROW here, rather than a returned error, used to leave the figure
      // empty for ever — and an empty figure has no background, so it is
      // indistinguishable from having no picture at all. Whatever goes wrong,
      // something must appear.
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[quiz] could not sign image url', path, e);
        if (alive) setFailed(true);
      });
    return () => { alive = false; };
  }, [path]);

  if (!path) return null;

  const Tag = onClick ? 'button' : 'figure';
  return (
    <Tag
      className={`qimg ${className}`}
      {...(onClick ? { type: 'button', onClick, title } : {})}
    >
      {url && !failed && (
        <img src={url} alt={alt} onError={() => setFailed(true)} />
      )}
      {/* A picture that cannot be fetched says so rather than leaving a hole:
          on a wall, an empty frame reads as "the quiz is broken". */}
      {failed && <span className="qimg-missing">Picture unavailable</span>}
    </Tag>
  );
}
