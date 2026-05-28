import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Global "something is happening" overlay. The user clicks Create / Delete /
// Import; we dim the page, show a labelled spinner, and run the async work.
// Any errors propagate to the caller — the overlay only handles the visual
// "in progress" signal, not error display (each page renders its own
// inline error since the wording differs).
//
// Usage:
//   const { run } = useBusyOverlay();
//   const result = await run('Deleting session…', () => deleteSession());
//   if (result?.error) { ... }
//
// Design rules:
//   - Only wrap async actions whose network/DB latency the user would
//     otherwise stare at a frozen button for (≳ 300 ms).
//   - Use present-continuous labels: "Importing workbook…", "Deleting
//     session…". The trailing ellipsis is part of the convention.
//   - Don't wrap purely-local state changes — overlay is for I/O.
//   - The overlay is fixed-position over EVERYTHING (including modals)
//     so the user can't click anywhere else mid-flight.

const BusyOverlayContext = createContext(null);

export function BusyOverlayProvider({ children }) {
  const [busy, setBusy] = useState(null); // null | { label, id }
  const idRef = useRef(0);

  const run = useCallback(async (label, fn) => {
    const id = ++idRef.current;
    setBusy({ label, id });
    try {
      return await fn();
    } finally {
      // Only clear if this run is still the active one — a nested or
      // concurrent run will manage its own teardown.
      setBusy(prev => (prev && prev.id === id ? null : prev));
    }
  }, []);

  // Esc shouldn't dismiss the overlay (the action is in flight server-side
  // and can't be cancelled from the client), but make sure a stuck overlay
  // doesn't trap focus or block keystrokes in dev — log it loudly so it's
  // obvious if a `run()` call forgot to await.
  useEffect(() => {
    if (!busy) return undefined;
    const t = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn(`[BusyOverlay] still showing "${busy.label}" after 30s — did the action hang?`);
    }, 30000);
    return () => clearTimeout(t);
  }, [busy]);

  return (
    <BusyOverlayContext.Provider value={{ run }}>
      {children}
      {busy && (
        <div className="busy-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="busy-overlay-card">
            <div className="busy-overlay-spinner" aria-hidden />
            <div className="busy-overlay-label">{busy.label}</div>
          </div>
        </div>
      )}
    </BusyOverlayContext.Provider>
  );
}

export function useBusyOverlay() {
  const ctx = useContext(BusyOverlayContext);
  if (!ctx) {
    // Fail loudly in dev; in prod silently fall back so an unwrapped page
    // doesn't crash — the action still runs, just without the overlay.
    return {
      run: async (_label, fn) => fn(),
    };
  }
  return ctx;
}
