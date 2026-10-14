import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { queueKey, restorable } from '../lib/answerQueue.js';
import { useQueuedSaves } from './useQueuedSaves.js';

const RECENT_UPDATE_MS = 5000;

// Mirrors useWorkbook for the assessment surface: loads the cloned assessment +
// sections + assessment_blocks, hydrates saved answers, exposes a debounced
// per-block upsert to assessment_answers. Subscribes to assessment_blocks for
// live master-content updates (matches the workbook participant page).
//
// sessionId may be passed explicitly (preferred — keeps workbook + assessment
// paired to the same session when a participant is in more than one). When
// omitted, the hook resolves via session_participants.
export function useParticipantAssessment(userId, sessionId = null) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [session, setSession] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [sections, setSections] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [answers, setAnswers] = useState({});
  const [recentlyUpdated, setRecentlyUpdated] = useState({});
  // Bumped when the trainer unlocks the paper while this page is open, so the
  // locked notice turns into the paper without a refresh.
  const [reloadKey, setReloadKey] = useState(0);
  const unlockedRef = useRef(false);
  useEffect(() => { unlockedRef.current = !!session?.assessment_unlocked_at; }, [session?.assessment_unlocked_at]);

  const badgeTimersRef = useRef({});
  // Answers typed before a reload that never reached the server.
  const toResendRef = useRef({});

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        let sess;
        if (sessionId) {
          const { data: s, error: eS } = await supabase
            .from('sessions')
            .select('id, name, kind, assessment_id, assessment_unlocked_at, assessment_deadline_at, starts_at, ends_at, city_code')
            .eq('id', sessionId)
            .single();
          if (eS) throw eS;
          sess = s;
        } else {
          const { data: spRows, error: e1 } = await supabase
            .from('session_participants')
            .select('session_id, sessions ( id, name, kind, assessment_id, assessment_unlocked_at, assessment_deadline_at, starts_at, ends_at, city_code )')
            // One account, one session — see the same note in useWorkbook.js.
            // .limit(1) has no ORDER BY, so a person enrolled twice gets an
            // arbitrary one of the two. A re-sitter is given a new account.
            .eq('participant_id', userId)
            .limit(1);
          if (e1) throw e1;
          if (!spRows?.length || !spRows[0].sessions) {
            if (!cancelled) { setError('You are not enrolled in any session yet.'); setLoading(false); }
            return;
          }
          sess = spRows[0].sessions;
        }
        if (!sess.assessment_id) {
          if (!cancelled) { setSession(sess); setLoading(false); }
          return;
        }
        // Locked: skip content load (RLS would deny anyway). The page reads
        // session.assessment_unlocked_at to render the locked notice.
        if (!sess.assessment_unlocked_at) {
          if (!cancelled) { setSession(sess); setLoading(false); }
          return;
        }

        const [{ data: ass, error: e2 }, { data: secs, error: e3 }] = await Promise.all([
          supabase.from('assessments').select('*').eq('id', sess.assessment_id).single(),
          supabase.from('assessment_sections').select('*').eq('assessment_id', sess.assessment_id).order('order_index'),
        ]);
        if (e2) throw e2;
        if (e3) throw e3;

        const sectionIds = (secs || []).map(s => s.id);
        const [{ data: blks, error: e4 }, { data: ans, error: e5 }] = await Promise.all([
          sectionIds.length
            ? supabase.from('assessment_blocks').select('*').in('section_id', sectionIds).order('order_index')
            : Promise.resolve({ data: [], error: null }),
          supabase.from('assessment_answers')
            .select('assessment_block_id, value, updated_at')
            .eq('session_id', sess.id)
            .eq('participant_id', userId),
        ]);
        if (e4) throw e4;
        if (e5) throw e5;

        const map = {};
        const at = {};
        (ans || []).forEach(a => { map[a.assessment_block_id] = a.value; at[a.assessment_block_id] = a.updated_at; });
        // Put back anything typed on this laptop that never reached the server.
        const back = restorable(queueKey('assessment', sess.id, userId), map, at, new Set((blks || []).map(b => b.id)));
        Object.assign(map, back);
        toResendRef.current = back;

        if (cancelled) return;
        setSession(sess);
        setAssessment(ass);
        setSections(secs || []);
        setBlocks(blks || []);
        setAnswers(map);
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setError(err.message || String(err)); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [userId, sessionId, reloadKey]);

  useEffect(() => {
    if (!assessment?.id) return;

    function flagUpdated(blockId) {
      setRecentlyUpdated(prev => ({ ...prev, [blockId]: Date.now() }));
      if (badgeTimersRef.current[blockId]) clearTimeout(badgeTimersRef.current[blockId]);
      badgeTimersRef.current[blockId] = setTimeout(() => {
        setRecentlyUpdated(prev => {
          const { [blockId]: _, ...rest } = prev;
          return rest;
        });
      }, RECENT_UPDATE_MS);
    }

    const channel = supabase
      .channel(`participant-assessment-blocks-${assessment.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assessment_blocks' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldId = payload.old?.id;
            if (oldId) setBlocks(prev => prev.filter(b => b.id !== oldId));
            return;
          }
          const nb = payload.new;
          if (!nb) return;
          setBlocks(prev => {
            const idx = prev.findIndex(b => b.id === nb.id);
            const next = idx >= 0 ? prev.map((b, i) => i === idx ? nb : b) : [...prev, nb];
            return next.sort((a, b) =>
              a.section_id === b.section_id ? a.order_index - b.order_index : 0
            );
          });
          flagUpdated(nb.id);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [assessment?.id]);

  // Live deadline updates: when the trainer extends (or shortens) the timer,
  // a participant already on the page picks up the new deadline without a
  // refresh. assessment_unlocked_at is NOT patched in place — flipping it alone
  // would show an open paper with no content loaded. Locked → unlocked reloads
  // the whole thing instead, so the locked page opens by itself.
  useEffect(() => {
    if (!session?.id) return;
    const channel = supabase
      .channel(`participant-assessment-session-${session.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` },
        (payload) => {
          const next = payload.new;
          if (!next) return;
          // Realtime WAL renders timestamps space-separated (e.g. "...10:30:00+00"),
          // which new Date() rejects as Invalid Date on Safari/iOS. Normalize the
          // space to 'T' so the deadline parses on tablets/phones too.
          const deadline = typeof next.assessment_deadline_at === 'string'
            ? next.assessment_deadline_at.replace(' ', 'T')
            : next.assessment_deadline_at;
          if (next.assessment_unlocked_at && !unlockedRef.current) {
            unlockedRef.current = true;
            setReloadKey(k => k + 1);
            return;
          }
          setSession(prev => prev && prev.assessment_deadline_at !== deadline
            ? { ...prev, assessment_deadline_at: deadline }
            : prev);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.id]);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const { save, savingMap, failures, retryFailed, sentNotice } = useQueuedSaves({
    storageKey: queueKey('assessment', session?.id, userId),
    send: (blockId, value) => supabase
      .from('assessment_answers')
      .upsert(
        { session_id: sessionRef.current.id, participant_id: userId, assessment_block_id: blockId, value },
        { onConflict: 'session_id,participant_id,assessment_block_id' }
      ),
    currentValue: blockId => answersRef.current[blockId],
  });

  const saveAnswer = useCallback((blockId, value) => {
    setAnswers(prev => ({ ...prev, [blockId]: value }));
    save(blockId, value);
  }, [save]);

  // Resend what was restored from this laptop once the session is known.
  useEffect(() => {
    if (!session?.id) return;
    const back = toResendRef.current;
    toResendRef.current = {};
    for (const [blockId, value] of Object.entries(back)) save(blockId, value);
  }, [session?.id, save]);

  return { loading, error, session, assessment, sections, blocks, answers, savingMap, failures, retryFailed, sentNotice, saveAnswer, recentlyUpdated };
}
