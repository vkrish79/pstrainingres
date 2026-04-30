import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Fetches a session's participants + workbook structure + all answers,
// and keeps answers live via a realtime subscription.
export function useSessionDashboard(sessionId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [session, setSession] = useState(null);
  const [workbook, setWorkbook] = useState(null);
  const [sections, setSections] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [participants, setParticipants] = useState([]);   // [{ id, full_name }]
  const [answers, setAnswers] = useState({});              // { [participantId]: { [blockId]: { value, updated_at } } }

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    (async () => {
      try {
        const { data: sess, error: e1 } = await supabase
          .from('sessions')
          .select(`
            id, name, workbook_id, created_at,
            workbooks ( id, title, description ),
            session_participants ( participant_id, profiles ( id, full_name ) )
          `)
          .eq('id', sessionId)
          .single();
        if (e1) throw e1;

        const wb = sess.workbooks;
        const parts = (sess.session_participants || [])
          .map(sp => sp.profiles)
          .filter(Boolean)
          .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));

        const { data: secs, error: e2 } = await supabase
          .from('sections').select('*').eq('workbook_id', wb.id).order('order_index');
        if (e2) throw e2;

        const sectionIds = (secs || []).map(s => s.id);
        const { data: blks, error: e3 } = sectionIds.length
          ? await supabase.from('blocks').select('*').in('section_id', sectionIds).order('order_index')
          : { data: [], error: null };
        if (e3) throw e3;

        const { data: ans, error: e4 } = await supabase
          .from('answers')
          .select('participant_id, block_id, value, updated_at')
          .eq('session_id', sessionId);
        if (e4) throw e4;

        const ansMap = {};
        (ans || []).forEach(a => {
          ansMap[a.participant_id] = ansMap[a.participant_id] || {};
          ansMap[a.participant_id][a.block_id] = { value: a.value, updated_at: a.updated_at };
        });

        if (cancelled) return;
        setSession({ id: sess.id, name: sess.name });
        setWorkbook(wb);
        setSections(secs || []);
        setBlocks(blks || []);
        setParticipants(parts);
        setAnswers(ansMap);
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setError(err.message); setLoading(false); }
      }
    })();

    return () => { cancelled = true; };
  }, [sessionId]);

  // Realtime subscription on answers for this session
  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`session-${sessionId}-answers`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'answers', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          setAnswers(prev => {
            const next = { ...prev };
            if (payload.eventType === 'DELETE') {
              const { participant_id, block_id } = payload.old || {};
              if (next[participant_id]) {
                const inner = { ...next[participant_id] };
                delete inner[block_id];
                next[participant_id] = inner;
              }
            } else {
              const { participant_id, block_id, value, updated_at } = payload.new || {};
              next[participant_id] = {
                ...(next[participant_id] || {}),
                [block_id]: { value, updated_at },
              };
            }
            return next;
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);

  async function addParticipant(participantId) {
    const { error: insErr } = await supabase
      .from('session_participants').insert({ session_id: sessionId, participant_id: participantId });
    if (insErr) return { error: insErr };
    const { data: prof } = await supabase
      .from('profiles').select('id, full_name').eq('id', participantId).single();
    if (prof) {
      setParticipants(prev =>
        [...prev, prof].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
      );
    }
    return {};
  }

  async function removeParticipant(participantId) {
    const { error: delErr } = await supabase
      .from('session_participants')
      .delete()
      .eq('session_id', sessionId)
      .eq('participant_id', participantId);
    if (delErr) return { error: delErr };
    setParticipants(prev => prev.filter(p => p.id !== participantId));
    setAnswers(prev => {
      const next = { ...prev };
      delete next[participantId];
      return next;
    });
    return {};
  }

  return { loading, error, session, workbook, sections, blocks, participants, answers, addParticipant, removeParticipant };
}
