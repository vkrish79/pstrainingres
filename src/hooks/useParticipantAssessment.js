import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const SAVE_DEBOUNCE_MS = 600;
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
  const [savingMap, setSavingMap] = useState({});
  const [recentlyUpdated, setRecentlyUpdated] = useState({});

  const timersRef = useRef({});
  const badgeTimersRef = useRef({});

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        let sess;
        if (sessionId) {
          const { data: s, error: eS } = await supabase
            .from('sessions')
            .select('id, name, assessment_id, assessment_unlocked_at, assessment_deadline_at, starts_at, ends_at, city_code')
            .eq('id', sessionId)
            .single();
          if (eS) throw eS;
          sess = s;
        } else {
          const { data: spRows, error: e1 } = await supabase
            .from('session_participants')
            .select('session_id, sessions ( id, name, assessment_id, assessment_unlocked_at, assessment_deadline_at, starts_at, ends_at, city_code )')
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
            .select('assessment_block_id, value')
            .eq('session_id', sess.id)
            .eq('participant_id', userId),
        ]);
        if (e4) throw e4;
        if (e5) throw e5;

        const map = {};
        (ans || []).forEach(a => { map[a.assessment_block_id] = a.value; });

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
  }, [userId, sessionId]);

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
  // refresh. We deliberately patch ONLY assessment_deadline_at here — flipping
  // assessment_unlocked_at live would leave the locked→unlocked content unloaded
  // (that transition keeps the existing refresh model).
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
          setSession(prev => prev && prev.assessment_deadline_at !== deadline
            ? { ...prev, assessment_deadline_at: deadline }
            : prev);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.id]);

  const saveAnswer = useCallback((blockId, value) => {
    setAnswers(prev => ({ ...prev, [blockId]: value }));
    setSavingMap(prev => ({ ...prev, [blockId]: 'saving' }));

    if (timersRef.current[blockId]) clearTimeout(timersRef.current[blockId]);
    timersRef.current[blockId] = setTimeout(async () => {
      const { error: upErr } = await supabase
        .from('assessment_answers')
        .upsert(
          { session_id: session.id, participant_id: userId, assessment_block_id: blockId, value },
          { onConflict: 'session_id,participant_id,assessment_block_id' }
        );
      setSavingMap(prev => ({ ...prev, [blockId]: upErr ? 'error' : 'saved' }));
    }, SAVE_DEBOUNCE_MS);
  }, [session, userId]);

  return { loading, error, session, assessment, sections, blocks, answers, savingMap, saveAnswer, recentlyUpdated };
}
