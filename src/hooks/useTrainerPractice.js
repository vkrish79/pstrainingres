import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Trainer-side "practice" view of a session's workbook. Mirrors useWorkbook's
// shape (session + workbook + sections + blocks + answers + saveAnswer), but
// answers persist SERVER-SIDE in trainer_practice, scoped to the SESSION (not
// the individual trainer). That way a reassigned trainer resumes the same
// practice progress. Never participant-visible; never in cohort stats/exports.

const SAVE_DEBOUNCE_MS = 600;

// Legacy localStorage key (pre server-side storage). Read once on load to
// migrate any in-progress practice the current trainer still has on this device.
function legacyKey(sessionId, trainerId) {
  return `trainer-practice:${sessionId}:${trainerId}`;
}
function loadLegacy(sessionId, trainerId) {
  try {
    const raw = localStorage.getItem(legacyKey(sessionId, trainerId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useTrainerPractice(sessionId, trainerId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [session, setSession] = useState(null);
  const [workbook, setWorkbook] = useState(null);
  const [sections, setSections] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [answers, setAnswers] = useState({});

  const timersRef = useRef({});

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data: sess, error: e1 } = await supabase
          .from('sessions')
          .select('id, name, workbook_id, starts_at, ends_at, city_code')
          .eq('id', sessionId)
          .single();
        if (e1) throw e1;

        const [{ data: wb, error: e2 }, { data: secs, error: e3 }] = await Promise.all([
          supabase.from('workbooks').select('*').eq('id', sess.workbook_id).single(),
          supabase.from('sections').select('*').eq('workbook_id', sess.workbook_id).order('order_index'),
        ]);
        if (e2) throw e2;
        if (e3) throw e3;

        const sectionIds = (secs || []).map(s => s.id);
        const [{ data: blks, error: e4 }, { data: practiceRows, error: e5 }] = await Promise.all([
          sectionIds.length
            ? supabase.from('blocks').select('*').in('section_id', sectionIds).order('order_index')
            : Promise.resolve({ data: [], error: null }),
          supabase.from('trainer_practice').select('block_id, value').eq('session_id', sessionId),
        ]);
        if (e4) throw e4;
        if (e5) throw e5;

        let map = {};
        (practiceRows || []).forEach(r => { map[r.block_id] = r.value; });

        // One-time migration: if the session has no server-side practice yet but
        // this trainer has legacy localStorage practice on this device, seed the
        // server from it so their in-progress work carries over. Filter to blocks
        // that still exist to avoid FK errors from since-deleted blocks.
        if (Object.keys(map).length === 0 && trainerId) {
          const legacy = loadLegacy(sessionId, trainerId);
          if (legacy && Object.keys(legacy).length > 0) {
            const validBlockIds = new Set((blks || []).map(b => b.id));
            const rows = Object.entries(legacy)
              .filter(([blockId]) => validBlockIds.has(blockId))
              .map(([blockId, value]) => ({ session_id: sessionId, block_id: blockId, value: value ?? null }));
            if (rows.length) {
              const { error: seedErr } = await supabase
                .from('trainer_practice')
                .upsert(rows, { onConflict: 'session_id,block_id' });
              if (!seedErr) {
                rows.forEach(r => { map[r.block_id] = r.value; });
                try { localStorage.removeItem(legacyKey(sessionId, trainerId)); } catch { /* ignore */ }
              }
            }
          }
        }

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
  }, [sessionId, trainerId]);

  const saveAnswer = useCallback((blockId, value) => {
    setAnswers(prev => ({ ...prev, [blockId]: value }));
    if (timersRef.current[blockId]) clearTimeout(timersRef.current[blockId]);
    timersRef.current[blockId] = setTimeout(async () => {
      await supabase
        .from('trainer_practice')
        .upsert(
          { session_id: sessionId, block_id: blockId, value: value ?? null },
          { onConflict: 'session_id,block_id' },
        );
    }, SAVE_DEBOUNCE_MS);
  }, [sessionId]);

  const resetAnswers = useCallback(async () => {
    // Cancel any in-flight debounced saves so they don't re-upsert a pre-reset
    // value after we've cleared the rows.
    Object.values(timersRef.current).forEach(t => clearTimeout(t));
    timersRef.current = {};
    setAnswers({});
    await supabase.from('trainer_practice').delete().eq('session_id', sessionId);
  }, [sessionId]);

  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);

  return {
    loading, error, session, workbook, sections, blocks, answers,
    saveAnswer, resetAnswers, answeredCount,
  };
}
