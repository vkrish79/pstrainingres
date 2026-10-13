import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './AuthContext.jsx';
import { canShareScreen, makeGrabber, makeTicker, pickTab } from '../lib/amxCapture.js';
import { markActive } from '../hooks/useIdleSignOut.js';

// Watch Amadeus, the participant's side: share the ARD Web tab, and send small
// pictures of it to whoever runs the session.
//
// ABOVE THE ROUTES, ON PURPOSE. The workbook page hands over to a quiz or a
// poll by returning a different component, and the assessment is another
// route. A share owned by any of those would end every time a poll was fired.
// Here it lasts until they stop it, the browser stops it, or they sign out.
//
// The channel is private and per participant (amx:<session>:<participant>,
// SQL 20261013000000). If the join is refused — the SQL not applied, or this
// account isn't an active member — `available` stays false and the workbook
// shows no button at all, rather than one that does nothing.
//
// WHAT IS SENT, AND WHEN. Nothing is stored anywhere: broadcast only relays.
//   state — tiny, every 5s while sharing or paused, and on every change, so a
//           trainer who opens the Room late knows within seconds;
//   thumb — ~320px JPEG, only while a host has said hello in the last minute,
//           every 5s if the screen changed, else every 30s; 640px every 3s
//           while a host has the Screens grid open (hello size:'mid');
//   frame — ~1280px JPEG about twice a second, only while a host is watching
//           this person (a 'live' ping in the last 8s).
// Receives: hello (a host has the Room open), live (watching me), ask (please
// share).
//
// THE LAST SHARE. How the most recent share ended is kept in this browser
// (localStorage, per session and account), so it survives a reload or a
// sign-out. Anything but their own Stop button counts as a drop, and the
// workbook offers "Share again". It also rides on the 'off' state, so the
// trainer's tile can say "Stopped 3 min ago" rather than just "Not sharing".

const Ctx = createContext(null);

const TICK_MS = 500;
const STATE_EVERY_MS = 5000;
const THUMB_EVERY_MS = 5000;
const THUMB_UNCHANGED_EVERY_MS = 30000;
const HOST_FRESH_MS = 60000;
const LIVE_FRESH_MS = 8000;
const FRAME_EVERY_MS = 500;
const ACTIVE_EVERY_MS = 30000;
const THUMB = { maxW: 320, quality: 0.6, maxBytes: 40000 };
const MID = { maxW: 640, quality: 0.6, maxBytes: 90000 };
const MID_EVERY_MS = 3000;
const FRAME = { maxW: 1280, quality: 0.65, maxBytes: 200000 };

// { sharing, at, reason } — while sharing, `at` is refreshed with every state
// message, so a reload leaves roughly when it was cut off.
// reason: stopped (their Stop) | ended (tab closed, or Chrome's own Stop) |
// reload (the workbook went while sharing) | signout | restart (re-picking).
// Only today's counts: a class runs for weeks, and yesterday's share is not
// something to pick up again this morning.
function lastKey(sessionId, uid) { return `amx-last:${sessionId}:${uid}`; }
function readLast(sessionId, uid) {
  try {
    const v = JSON.parse(localStorage.getItem(lastKey(sessionId, uid)) || 'null');
    if (!v?.at || new Date(v.at).toDateString() !== new Date().toDateString()) return null;
    // Still marked sharing means this page was never told it ended.
    return v.sharing ? { sharing: false, at: v.at, reason: 'reload' } : v;
  } catch { return null; }
}
function writeLast(sessionId, uid, v) {
  if (!sessionId || !uid) return;
  try { localStorage.setItem(lastKey(sessionId, uid), JSON.stringify(v)); } catch { /* the tile just says less */ }
}

export function AmadeusShareProvider({ children }) {
  const { session: authSession } = useAuth();
  const uid = authSession?.user?.id || null;
  const [sessionId, setSessionId] = useState(null);
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState('off'); // off | starting | sharing | paused
  const [surface, setSurface] = useState(null);
  const [asked, setAsked] = useState(false);
  const [error, setError] = useState('');
  const [diag, setDiag] = useState({ label: '', sent: 0, failed: 0, lastBytes: 0, lastKind: '', lastAck: '', tickGapMax: 0 });
  const [last, setLast] = useState(null);   // how the last share ended (see THE LAST SHARE)

  const channelRef = useRef(null);
  const shareRef = useRef(null);   // { stream, track, grabber, stopTicker }
  const statusRef = useRef('off');
  const timesRef = useRef({});     // hostAt, liveAt, stateAt, thumbAt, frameAt, activeAt, lastSig, lastTick
  const busyRef = useRef(false);
  const lastRef = useRef(null);
  const idsRef = useRef({ sessionId: null, uid: null });
  idsRef.current = { sessionId, uid };
  // The session and account a running share belongs to. Signing out clears
  // uid before the share is stopped, so the record is written to these.
  const shareIdsRef = useRef(null);

  const setStatusBoth = useCallback(s => { statusRef.current = s; setStatus(s); }, []);

  const send = useCallback(async (event, payload) => {
    const ch = channelRef.current;
    if (!ch) return 'no-channel';
    let ack;
    try { ack = await ch.send({ type: 'broadcast', event, payload }); } catch (e) { ack = 'error: ' + (e?.message || e); }
    setDiag(d => ({
      ...d,
      sent: d.sent + (ack === 'ok' ? 1 : 0),
      failed: d.failed + (ack === 'ok' ? 0 : 1),
      lastKind: event,
      lastBytes: payload?.img ? payload.img.length : d.lastBytes,
      lastAck: String(ack),
    }));
    return ack;
  }, []);

  const sendState = useCallback(() => {
    const now = Date.now();
    timesRef.current.stateAt = now;
    const on = statusRef.current === 'sharing' || statusRef.current === 'paused';
    const ids = shareIdsRef.current || idsRef.current;
    if (on) writeLast(ids.sessionId, ids.uid, { sharing: true, at: now });
    return send('state', { status: statusRef.current, surface: shareRef.current?.surface || null, at: now, last: on ? null : lastRef.current });
  }, [send]);

  // Pick up how the last share in this session ended, e.g. after a reload.
  useEffect(() => {
    if (shareRef.current) return;
    const l = sessionId && uid ? readLast(sessionId, uid) : null;
    if (l) writeLast(sessionId, uid, l);
    lastRef.current = l;
    setLast(l);
  }, [sessionId, uid]);

  // ── the private channel: joined while there is a session to share into ──
  useEffect(() => {
    if (!uid || !sessionId || !canShareScreen()) { setAvailable(false); return undefined; }
    let gone = false;
    const ch = supabase.channel(`amx:${sessionId}:${uid}`, { config: { private: true, broadcast: { ack: true } } });
    ch.on('broadcast', { event: 'hello' }, ({ payload }) => {
      const t = timesRef.current;
      if (payload?.thumbs !== false) t.hostAt = Date.now();
      // The Screens grid asks for bigger pictures; send one straight away
      // when it starts asking, and drop back when it stops.
      const wasBig = Date.now() < (t.bigUntil || 0);
      t.bigUntil = payload?.size === 'mid' ? Date.now() + HOST_FRESH_MS : 0;
      if (!wasBig && t.bigUntil) t.thumbAt = 0;
      sendState();
    });
    ch.on('broadcast', { event: 'live' }, () => {
      timesRef.current.liveAt = Date.now();
      timesRef.current.hostAt = Date.now();
    });
    ch.on('broadcast', { event: 'ask' }, () => {
      if (statusRef.current === 'off') setAsked(true);
    });
    ch.subscribe(st => {
      if (gone) return;
      if (st === 'SUBSCRIBED') { channelRef.current = ch; setAvailable(true); sendState(); }
      if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') setAvailable(false);
    });
    return () => {
      gone = true;
      channelRef.current = null;
      setAvailable(false);
      supabase.removeChannel(ch);
    };
  }, [uid, sessionId, sendState]);

  // reason: see THE LAST SHARE. The Stop button passes its click event, which
  // is the deliberate 'stopped'.
  const stop = useCallback(reason => {
    const sh = shareRef.current;
    shareRef.current = null;
    if (sh) {
      sh.stopTicker();
      sh.grabber.close();
      sh.stream.getTracks().forEach(t => t.stop());
      const l = { sharing: false, at: Date.now(), reason: typeof reason === 'string' ? reason : 'stopped' };
      const ids = shareIdsRef.current || idsRef.current;
      writeLast(ids.sessionId, ids.uid, l);
      shareIdsRef.current = null;
      lastRef.current = l;
      setLast(l);
    }
    setSurface(null);
    setStatusBoth('off');
    sendState();
  }, [sendState, setStatusBoth]);

  // One tick: keep the session alive, then send whatever is due.
  const tick = useCallback(async () => {
    const sh = shareRef.current;
    if (!sh) return;
    const now = Date.now();
    const t = timesRef.current;
    // The heartbeat first, and never behind a picture: a slow picture must not
    // make someone look as though they've stopped sharing.
    if (now - (t.stateAt || 0) >= STATE_EVERY_MS) sendState();
    if (t.lastTick) {
      const gap = now - t.lastTick;
      setDiag(d => (gap > d.tickGapMax ? { ...d, tickGapMax: gap } : d));
    }
    t.lastTick = now;
    // Only an ACTIVE share keeps the session alive. A paused one doesn't: a
    // laptop left paused at lunch must still reach the 1-hour sign-out.
    if (statusRef.current === 'sharing' && (!t.activeAt || now - t.activeAt >= ACTIVE_EVERY_MS)) { t.activeAt = now; markActive(); }
    if (busyRef.current) return;
    if (statusRef.current !== 'sharing') return;

    busyRef.current = true;
    try {
      const live = now - (t.liveAt || 0) < LIVE_FRESH_MS;
      if (live && now - (t.frameAt || 0) >= FRAME_EVERY_MS) {
        const f = await sh.grabber.grab(FRAME);
        if (f) { t.frameAt = now; await send('frame', { img: f.img, w: f.w, h: f.h, at: now }); } else setDiag(d => ({ ...d, noPicture: (d.noPicture || 0) + 1 }));
      }
      const hosted = now - (t.hostAt || 0) < HOST_FRESH_MS;
      const big = now < (t.bigUntil || 0);
      if (hosted && now - (t.thumbAt || 0) >= (big ? MID_EVERY_MS : THUMB_EVERY_MS)) {
        const th = await sh.grabber.grab(big ? MID : THUMB);
        if (!th) setDiag(d => ({ ...d, noPicture: (d.noPicture || 0) + 1 }));
        if (th) {
          const changed = th.sig !== t.lastSig;
          if (changed || now - (t.thumbSentAt || 0) >= THUMB_UNCHANGED_EVERY_MS) {
            t.lastSig = th.sig;
            t.thumbSentAt = now;
            await send('thumb', { img: th.img, w: th.w, h: th.h, at: now });
          }
          t.thumbAt = now;
        }
      }
    } finally {
      busyRef.current = false;
    }
  }, [send, sendState]);

  const start = useCallback(async () => {
    if (shareRef.current || !available) return;
    setError('');
    setAsked(false);
    setStatusBoth('starting');
    let picked;
    try {
      picked = await pickTab();
    } catch (e) {
      setStatusBoth('off');
      // Cancelling the picker is not an error worth a message.
      if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') setError(e?.message || 'Sharing could not start.');
      return;
    }
    const grabber = makeGrabber(picked.track);
    // Chrome's own "Stop sharing" bar, or the shared tab being closed.
    picked.track.addEventListener('ended', () => { if (shareRef.current?.track === picked.track) stop('ended'); });
    // A new share sends its first thumbnail at once rather than after 5s.
    Object.assign(timesRef.current, { thumbAt: 0, thumbSentAt: 0, lastSig: null, lastTick: 0, activeAt: 0 });
    shareRef.current = { ...picked, grabber, stopTicker: makeTicker(TICK_MS, () => { tick(); }) };
    shareIdsRef.current = { ...idsRef.current };
    setSurface(picked.surface);
    setDiag(d => ({ ...d, label: picked.label, tickGapMax: 0 }));
    setStatusBoth('sharing');
    sendState();
  }, [available, setStatusBoth, stop, tick, sendState]);

  const pause = useCallback(() => { if (shareRef.current) { setStatusBoth('paused'); sendState(); } }, [setStatusBoth, sendState]);
  const resume = useCallback(() => { if (shareRef.current) { timesRef.current.thumbAt = 0; timesRef.current.lastSig = null; setStatusBoth('sharing'); sendState(); } }, [setStatusBoth, sendState]);

  // Signing out, or another account, ends it.
  useEffect(() => () => { if (shareRef.current) stop('signout'); }, [uid, stop]);
  useEffect(() => { if (!uid) setSessionId(null); }, [uid]);

  const value = {
    available, status, surface, asked, error, diag,
    // Their share ended without them stopping it: offer "Share again".
    dropped: status === 'off' && !!last && last.reason !== 'stopped',
    start, pause, resume, stop,
    dismissAsk: () => setAsked(false),
    clearError: () => setError(''),
    setSessionId,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAmadeusShare() {
  return useContext(Ctx);
}

// The workbook says which session the share belongs to. Not cleared when the
// workbook unmounts (a poll or the assessment taking over must not end it);
// signing out clears it.
export function useAmadeusShareSession(sessionId) {
  const ctx = useContext(Ctx);
  const set = ctx?.setSessionId;
  useEffect(() => { if (set && sessionId) set(sessionId); }, [set, sessionId]);
}
