import { useCallback, useEffect, useRef, useState } from 'react';
import { classifySaveError } from '../lib/saveErrors.js';
import { putQueued, dropQueued } from '../lib/answerQueue.js';

const SAVE_DEBOUNCE_MS = 600;
// Venue Wi-Fi often stays "connected" with no internet behind it, so the
// browser's online event never fires. While anything is waiting, try again
// on a timer as well.
const RETRY_MS = 15000;
// How long "✓ All 3 sent" stays up once the queue empties.
const SENT_NOTICE_MS = 5000;

// The participant's answer saving, shared by the workbook and the assessment.
//
// Each answer is queued in this browser the moment it is typed (lib/
// answerQueue.js), sent after a short pause, and taken off the queue only when
// the server confirms it. A failed send stays on the queue and on screen, and
// is retried by itself — on the online event, every RETRY_MS, and after a
// reload (the page restores the queue through answerQueue.restorable).
//
//   send(blockId, value) → Promise<{ error }>   the actual upsert
//   currentValue(blockId)                       what is on screen now
//   onSaved(blockId)                            optional, after each confirmed save
export function useQueuedSaves({ storageKey, send, currentValue, onSaved }) {
  const [savingMap, setSavingMap] = useState({});
  // Why each failed answer failed ({ kind, retry }, lib/saveErrors.js).
  const [failures, setFailures] = useState({});
  const [sentNotice, setSentNotice] = useState(0); // how many just went through
  const timersRef = useRef({});
  const sendRef = useRef(send);
  sendRef.current = send;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const keyRef = useRef(storageKey);
  keyRef.current = storageKey;

  const save = useCallback((blockId, value) => {
    const at = Date.now();
    putQueued(keyRef.current, blockId, value, at);
    setSavingMap(prev => ({ ...prev, [blockId]: 'saving' }));

    if (timersRef.current[blockId]) clearTimeout(timersRef.current[blockId]);
    timersRef.current[blockId] = setTimeout(async () => {
      delete timersRef.current[blockId];
      let upErr = null;
      try {
        ({ error: upErr } = await sendRef.current(blockId, value));
      } catch (e) { upErr = e; }
      if (!upErr) { dropQueued(keyRef.current, blockId, at); onSavedRef.current?.(blockId); }
      setSavingMap(prev => ({ ...prev, [blockId]: upErr ? 'error' : 'saved' }));
      setFailures(prev => {
        if (upErr) return { ...prev, [blockId]: classifySaveError(upErr) };
        if (!(blockId in prev)) return prev;
        const next = { ...prev };
        delete next[blockId];
        return next;
      });
    }, SAVE_DEBOUNCE_MS);
  }, []);

  // Send every retryable failed answer again, with what is on screen NOW (the
  // participant may have changed it since). Refused ones are left alone.
  const failuresRef = useRef(failures);
  failuresRef.current = failures;
  const currentRef = useRef(currentValue);
  currentRef.current = currentValue;
  const retryFailed = useCallback(() => {
    for (const [blockId, f] of Object.entries(failuresRef.current)) {
      if (f.retry && !timersRef.current[blockId]) save(blockId, currentRef.current(blockId));
    }
  }, [save]);

  useEffect(() => {
    window.addEventListener('online', retryFailed);
    return () => window.removeEventListener('online', retryFailed);
  }, [retryFailed]);

  const waiting = Object.values(failures).filter(f => f.retry).length;
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(retryFailed, RETRY_MS);
    return () => clearInterval(t);
  }, [waiting, retryFailed]);

  // "✓ All 3 sent": the most that were waiting at once, shown when the last
  // one goes through. A refused answer never counts as sent.
  const peakRef = useRef(0);
  useEffect(() => {
    const n = Object.keys(failures).length;
    if (n > 0) { peakRef.current = Math.max(peakRef.current, waiting); return undefined; }
    if (!peakRef.current) return undefined;
    setSentNotice(peakRef.current);
    peakRef.current = 0;
    const t = setTimeout(() => setSentNotice(0), SENT_NOTICE_MS);
    return () => clearTimeout(t);
  }, [failures, waiting]);

  return { save, savingMap, failures, retryFailed, sentNotice };
}
