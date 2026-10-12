import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Watch Amadeus, the trainer's side: one private channel per participant
// (amx:<session>:<participant>, SQL 20261013000000), the latest state and
// thumbnail for each, and fast frames for the one person being watched.
// Nothing is kept: pictures live in this page's memory and go with it.
//
// What we send them:
//   hello — every 20s on every channel: "a host has the Room open" (with
//           thumbs:false when pictures are switched off, so they stop sending,
//           and size:'mid' while the Screens grid is open, for 640px pictures);
//   live  — every 3s to the one person being watched: send frames;
//   ask   — please share.

const HELLO_EVERY_MS = 20000;
const LIVE_EVERY_MS = 3000;
// A state older than this means the participant's page has gone (closed,
// offline, signed out) even if the last thing it said was "sharing".
const STATE_STALE_MS = 15000;

export function useAmadeusWatch(sessionId, participantIds, { enabled = true, thumbs = true, big = false } = {}) {
  const [people, setPeople] = useState({});   // pid → { status, surface, at, thumb, thumbAt }
  const [available, setAvailable] = useState(null); // null until a channel answers
  const [watchingId, setWatchingId] = useState(null);
  const [frame, setFrame] = useState(null);   // { pid, img, w, h, at }
  const [, setNow] = useState(0);
  const channelsRef = useRef({});
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;
  const bigRef = useRef(big);
  bigRef.current = big;
  const key = (participantIds || []).slice().sort().join(',');

  const hello = useCallback(ch => {
    ch.send({ type: 'broadcast', event: 'hello', payload: { thumbs: thumbsRef.current, size: bigRef.current ? 'mid' : 'thumb' } }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId || !key) return undefined;
    const ids = key.split(',');
    let gone = false;
    const chans = {};
    for (const pid of ids) {
      const ch = supabase.channel(`amx:${sessionId}:${pid}`, { config: { private: true } });
      ch.on('broadcast', { event: 'state' }, ({ payload }) => {
        setPeople(p => ({ ...p, [pid]: { ...p[pid], status: payload?.status || 'off', surface: payload?.surface || null, at: Date.now() } }));
      });
      ch.on('broadcast', { event: 'thumb' }, ({ payload }) => {
        if (!payload?.img) return;
        setPeople(p => ({ ...p, [pid]: { ...p[pid], thumb: payload.img, thumbAt: Date.now(), at: Date.now(), status: p[pid]?.status === 'paused' ? 'paused' : 'sharing' } }));
      });
      ch.on('broadcast', { event: 'frame' }, ({ payload }) => {
        if (!payload?.img) return;
        setFrame({ pid, img: payload.img, w: payload.w, h: payload.h, at: Date.now() });
      });
      ch.subscribe(st => {
        if (gone) return;
        if (st === 'SUBSCRIBED') { setAvailable(true); hello(ch); }
        if (st === 'CHANNEL_ERROR') setAvailable(a => (a === true ? a : false));
      });
      chans[pid] = ch;
    }
    channelsRef.current = chans;
    const t = setInterval(() => {
      for (const ch of Object.values(chans)) hello(ch);
    }, HELLO_EVERY_MS);
    // Re-render now and then so a page that went quiet reads as gone.
    const tick = setInterval(() => setNow(n => n + 1), 5000);
    return () => {
      gone = true;
      clearInterval(t);
      clearInterval(tick);
      channelsRef.current = {};
      for (const ch of Object.values(chans)) supabase.removeChannel(ch);
    };
  }, [enabled, sessionId, key, hello]);

  // Switching pictures back on, or opening / leaving the Screens grid, says so
  // straight away rather than at the next 20s hello.
  useEffect(() => {
    for (const ch of Object.values(channelsRef.current)) hello(ch);
  }, [thumbs, big, hello]);

  // The one person being watched: keep telling them, so they keep sending.
  useEffect(() => {
    if (!watchingId) { setFrame(null); return undefined; }
    const ping = () => channelsRef.current[watchingId]?.send({ type: 'broadcast', event: 'live', payload: {} }).catch(() => {});
    ping();
    const t = setInterval(ping, LIVE_EVERY_MS);
    return () => clearInterval(t);
  }, [watchingId]);

  const ask = useCallback(pid => {
    channelsRef.current[pid]?.send({ type: 'broadcast', event: 'ask', payload: {} }).catch(() => {});
  }, []);
  const askAll = useCallback(() => {
    for (const ch of Object.values(channelsRef.current)) ch.send({ type: 'broadcast', event: 'ask', payload: {} }).catch(() => {});
  }, []);

  // What the Room shows for one person: 'sharing' | 'paused' | 'off'.
  const stateOf = useCallback(pid => {
    const p = people[pid];
    if (!p || !p.at || Date.now() - p.at > STATE_STALE_MS) return { status: 'off' };
    return { status: p.status === 'sharing' || p.status === 'paused' ? p.status : 'off', surface: p.surface, thumb: p.status === 'sharing' || p.status === 'paused' ? p.thumb : null, thumbAt: p.thumbAt };
  }, [people]);

  return {
    available: available === true,
    stateOf,
    watchingId,
    watch: setWatchingId,
    frame: frame && frame.pid === watchingId ? frame : null,
    ask,
    askAll,
  };
}
