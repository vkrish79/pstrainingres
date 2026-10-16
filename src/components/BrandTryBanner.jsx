import { useEffect, useState } from 'react';
import { tryingPalette, stopTrying } from '../lib/branding.js';

// Shown on every page while this tab is trying colours from Settings →
// Branding, so nobody forgets they are looking at something nobody else sees.
export default function BrandTryBanner() {
  const [on, setOn] = useState(() => !!tryingPalette());
  useEffect(() => {
    const sync = () => setOn(!!tryingPalette());
    window.addEventListener('brand-try-change', sync);
    return () => window.removeEventListener('brand-try-change', sync);
  }, []);
  if (!on) return null;
  return (
    <div className="brand-try-banner no-print" role="status">
      <span><strong>You're trying new colours.</strong> Only you see them, in this tab.</span>
      <button type="button" onClick={stopTrying}>Stop trying</button>
    </div>
  );
}
