import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const SAVE_DEBOUNCE_MS = 600;
const RECENT_UPDATE_MS = 5000;

export function useWorkbook(userId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [session, setSession] = useState(null);
  const [workbook, setWorkbook] = useState(null);
  const [sections, setSections] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [answers, setAnswers] = useState({});
  const [savingMap, setSavingMap] = useState({});
  const [recentlyUpdated, setRecentlyUpdated] = useState({}); // blockId -> timestamp

  const timersRef = useRef({});
  const badgeTimersRef = useRef({});

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: spRows, error: e1 } = await supabase
          .from('session_participants')
          .select('session_id, sessions ( id, name, workbook_id )')
          .eq('participant_id', userId)
          .limit(1);
        if (e1) throw e1;
        if (!spRows?.length || !spRows[0].sessions) {
          if (!cancelled) { setError('You are not enrolled in any session yet.'); setLoading(false); }
          return;
        }
        const sess = spRows[0].sessions;

        const [{ data: wb, error: e2 }, { data: secs, error: e3 }] = await Promise.all([
          supabase.from('workbooks').select('*').eq('id', sess.workbook_id).single(),
          supabase.from('sections').select('*').eq('workbook_id', sess.workbook_id).order('order_index'),
        ]);
        if (e2) throw e2;
        if (e3) throw e3;

        const sectionIds = (secs || []).map(s => s.id);
        const [{ data: blks, error: e4 }, { data: ans, error: e5 }] = await Promise.all([
          sectionIds.length
            ? supabase.from('blocks').select('*').in('section_id', sectionIds).order('order_index')
            : Promise.resolve({ data: [], error: null }),
          supabase.from('answers').select('block_id, value').eq('session_id', sess.id).eq('participant_id', userId),
        ]);
        if (e4) throw e4;
        if (e5) throw e5;

        const map = {};
        (ans || []).forEach(a => { map[a.block_id] = a.value; });

        if (cancelled) return;
        setSession(sess);
        setWorkbook(wb);
        setSections(secs || []);
        setBlocks(blks || []);
        setAnswers(map);
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setError(err.message || String(err)); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Realtime: master-update of blocks for this workbook
  useEffect(() => {
    if (!workbook?.id) return;

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
      .channel(`participant-blocks-${workbook.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'blocks' },
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
  }, [workbook?.id]);

  const saveAnswer = useCallback((blockId, value) => {
    setAnswers(prev => ({ ...prev, [blockId]: value }));
    setSavingMap(prev => ({ ...prev, [blockId]: 'saving' }));

    if (timersRef.current[blockId]) clearTimeout(timersRef.current[blockId]);
    timersRef.current[blockId] = setTimeout(async () => {
      const { error: upErr } = await supabase
        .from('answers')
        .upsert(
          { session_id: session.id, participant_id: userId, block_id: blockId, value },
          { onConflict: 'session_id,participant_id,block_id' }
        );
      setSavingMap(prev => ({ ...prev, [blockId]: upErr ? 'error' : 'saved' }));
    }, SAVE_DEBOUNCE_MS);
  }, [session, userId]);

  return { loading, error, session, workbook, sections, blocks, answers, savingMap, saveAnswer, recentlyUpdated };
}
