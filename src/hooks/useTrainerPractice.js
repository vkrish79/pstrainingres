import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Trainer-side "practice" view of a session's workbook. Mirrors useWorkbook's
// shape (session + workbook + sections + blocks + answers + saveAnswer) but
// answers persist in localStorage only — keyed by (session, trainer) so each
// trainer's practice copy is private to their device. No participant-visible
// writes, no impact on cohort completion stats.

function storageKey(sessionId, trainerId) {
  return `trainer-practice:${sessionId}:${trainerId}`;
}

function loadAnswers(sessionId, trainerId) {
  try {
    const raw = localStorage.getItem(storageKey(sessionId, trainerId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistAnswers(sessionId, trainerId, map) {
  try {
    localStorage.setItem(storageKey(sessionId, trainerId), JSON.stringify(map));
  } catch {
    // Quota exceeded or storage disabled — silently swallow.
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

  useEffect(() => {
    if (!sessionId || !trainerId) return;
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
        const { data: blks, error: e4 } = sectionIds.length
          ? await supabase.from('blocks').select('*').in('section_id', sectionIds).order('order_index')
          : { data: [], error: null };
        if (e4) throw e4;

        if (cancelled) return;
        setSession(sess);
        setWorkbook(wb);
        setSections(secs || []);
        setBlocks(blks || []);
        setAnswers(loadAnswers(sessionId, trainerId));
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setError(err.message || String(err)); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, trainerId]);

  const saveAnswer = useCallback((blockId, value) => {
    setAnswers(prev => {
      const next = { ...prev, [blockId]: value };
      persistAnswers(sessionId, trainerId, next);
      return next;
    });
  }, [sessionId, trainerId]);

  const resetAnswers = useCallback(() => {
    setAnswers({});
    try { localStorage.removeItem(storageKey(sessionId, trainerId)); } catch { /* ignore */ }
  }, [sessionId, trainerId]);

  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);

  return {
    loading, error, session, workbook, sections, blocks, answers,
    saveAnswer, resetAnswers, answeredCount,
  };
}
