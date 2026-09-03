import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Trainer-side live view of participant assessment answers — the assessment
// twin of the workbook answers in useSessionDashboard. Loads the session's
// cloned assessment sections + blocks, hydrates every participant's
// assessment_answers, and keeps them live via a realtime subscription on
// assessment_answers. Trainer-tier RLS (assessment_answers_trainer_read, PR4)
// allows reading all participants' rows for sessions in scope; the read is NOT
// deadline-gated, so this same view shows the frozen final answers after the
// timer expires (doubles as the results/debrief surface).
//
// Returns answers shaped { [participantId]: { [assessment_block_id]: { value, updated_at } } }
// to match what ExerciseResponses expects, so that component can be reused.
export function useSessionAssessmentResponses(sessionId, assessmentId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sections, setSections] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [answers, setAnswers] = useState({});
  const [answerKey, setAnswerKey] = useState({});       // { [assessment_block_id]: key }
  const [answerPoints, setAnswerPoints] = useState({}); // { [assessment_block_id]: marks }

  useEffect(() => {
    if (!sessionId || !assessmentId) { setLoading(false); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { data: secs, error: e1 } = await supabase
          .from('assessment_sections').select('*').eq('assessment_id', assessmentId).order('order_index');
        if (e1) throw e1;

        const sectionIds = (secs || []).map(s => s.id);
        const [{ data: blks, error: e2 }, { data: ans, error: e3 }] = await Promise.all([
          sectionIds.length
            ? supabase.from('assessment_blocks').select('*').in('section_id', sectionIds).order('order_index')
            : Promise.resolve({ data: [], error: null }),
          supabase.from('assessment_answers')
            .select('participant_id, assessment_block_id, value, updated_at')
            .eq('session_id', sessionId),
        ]);
        if (e2) throw e2;
        if (e3) throw e3;

        const ansMap = {};
        (ans || []).forEach(a => {
          ansMap[a.participant_id] = ansMap[a.participant_id] || {};
          ansMap[a.participant_id][a.assessment_block_id] = { value: a.value, updated_at: a.updated_at };
        });

        // Answer keys for these clone blocks (trainer-readable; participants get
        // none). Drives the auto-marking on the trainer tiles.
        const blockIds = (blks || []).map(b => b.id);
        const { data: keys, error: e6 } = blockIds.length
          ? await supabase.from('assessment_answer_keys')
              .select('assessment_block_id, key, points').in('assessment_block_id', blockIds)
          : { data: [], error: null };
        if (e6) throw e6;
        const keyMap = {};
        const pointsMap = {};
        (keys || []).forEach(k => {
          keyMap[k.assessment_block_id] = k.key;
          pointsMap[k.assessment_block_id] = Number(k.points) || 1;
        });

        if (cancelled) return;
        setSections(secs || []);
        setBlocks(blks || []);
        setAnswers(ansMap);
        setAnswerKey(keyMap);
        setAnswerPoints(pointsMap);
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setError(err.message || String(err)); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, assessmentId]);

  // Live updates as participants answer. Distinct channel name so it doesn't
  // collide with the workbook `answers` channel for the same session.
  useEffect(() => {
    if (!sessionId) return undefined;
    const channel = supabase
      .channel(`session-${sessionId}-assessment-answers`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assessment_answers', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          setAnswers(prev => {
            const next = { ...prev };
            if (payload.eventType === 'DELETE') {
              const { participant_id, assessment_block_id } = payload.old || {};
              if (next[participant_id]) {
                const inner = { ...next[participant_id] };
                delete inner[assessment_block_id];
                next[participant_id] = inner;
              }
              return next;
            }
            const row = payload.new || {};
            // Realtime WAL renders timestamps space-separated, which new Date()
            // rejects as Invalid Date on Safari/iOS. Normalize ' ' -> 'T' so the
            // "last activity" / recent-sort in ExerciseResponses works there too.
            const updated_at = typeof row.updated_at === 'string'
              ? row.updated_at.replace(' ', 'T')
              : row.updated_at;
            next[row.participant_id] = {
              ...(next[row.participant_id] || {}),
              [row.assessment_block_id]: { value: row.value, updated_at },
            };
            return next;
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);

  return { loading, error, sections, blocks, answers, answerKey, answerPoints };
}
