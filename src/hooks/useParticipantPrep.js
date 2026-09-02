import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Participant-side, read-only. Returns:
//   prep[sectionId] = { content, updated_at }   — exercise-linked prep
//   standalone = [{ id, label, content }]        — prep not tied to an exercise
//   expected   = { sectionIds: Set, labels: [] } — what the prep template SAYS
//                 this workbook has prep for, whether or not a value exists yet
// Realtime on the first two so the trainer's edit appears live in an open tab.
//
// `expected` exists so the drawer can distinguish "this exercise is still waiting
// for its PNR" from "this exercise never needed prep". It reads the MASTER
// workbook's prep_template, which needs the workbooks_template_participant_read
// policy; if that has not been applied the reads simply come back empty and the
// drawer falls back to showing only prep that exists.
export function useParticipantPrep(sessionId, participantId) {
  const [prep, setPrep] = useState({});
  const [standalone, setStandalone] = useState([]);
  const [expected, setExpected] = useState({ sectionIds: new Set(), labels: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId || !participantId) return;
    let cancelled = false;
    (async () => {
      const [{ data: secRows }, { data: stdRows }] = await Promise.all([
        supabase.from('participant_prep')
          .select('section_id, content, updated_at')
          .eq('session_id', sessionId).eq('participant_id', participantId),
        supabase.from('participant_prep_standalone')
          .select('id, label, content, updated_at')
          .eq('session_id', sessionId).eq('participant_id', participantId).order('label'),
      ]);
      if (cancelled) return;
      const map = {};
      (secRows || []).forEach(r => { map[r.section_id] = r; });
      setPrep(map);
      setStandalone(stdRows || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionId, participantId]);

  // Which exercises this workbook EXPECTS prep for, from the master's
  // prep_template. Walks session → clone workbook → master, then maps the
  // template's master section ids onto this session's clone sections via
  // template_section_id (the same chain claim_prep_kit uses).
  //
  // Entirely best-effort: any missing link leaves `expected` empty and the drawer
  // shows only prep that exists, exactly as before.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase
        .from('sessions').select('workbook_id').eq('id', sessionId).maybeSingle();
      const cloneId = sess?.workbook_id;
      if (!cloneId) return;

      // Via RPC, not a table read: participants cannot select the master workbook
      // row, and an RLS policy granting it recurses (a policy on workbooks whose
      // subquery reads workbooks re-enters itself). get_participant_workbook_prep_template
      // is SECURITY DEFINER, so it answers without re-entering RLS — the same
      // pattern programs_pr4b_fix_recursion.sql uses for assessments.
      const { data: rpcTemplate } = await supabase
        .rpc('get_participant_workbook_prep_template', { p_clone_id: cloneId });
      const template = Array.isArray(rpcTemplate) ? rpcTemplate : [];
      if (!template.length) return;

      const { data: cloneSections } = await supabase
        .from('sections').select('id, template_section_id').eq('workbook_id', cloneId);
      const cloneByMaster = new Map();
      for (const s of cloneSections || []) {
        if (s.template_section_id) cloneByMaster.set(s.template_section_id, s.id);
      }

      const sectionIds = new Set();
      const labels = [];
      for (const col of template) {
        if (col?.section_id) {
          const cloneSectionId = cloneByMaster.get(col.section_id);
          if (cloneSectionId) sectionIds.add(cloneSectionId);
        } else if (col?.header) {
          labels.push(col.header);
        }
      }
      if (!cancelled) setExpected({ sectionIds, labels });
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  // Realtime: exercise-linked prep.
  useEffect(() => {
    if (!sessionId || !participantId) return;
    const channel = supabase
      .channel(`participant-${participantId}-prep`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participant_prep', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const row = payload.new || payload.old;
          if (!row || row.participant_id !== participantId) return;
          setPrep(prev => {
            const next = { ...prev };
            if (payload.eventType === 'DELETE') delete next[row.section_id];
            else next[row.section_id] = row;
            return next;
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId, participantId]);

  // Realtime: standalone prep — refetch the small list on any change.
  useEffect(() => {
    if (!sessionId || !participantId) return;
    const channel = supabase
      .channel(`participant-${participantId}-prep-standalone`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participant_prep_standalone', filter: `session_id=eq.${sessionId}` },
        async (payload) => {
          const row = payload.new || payload.old;
          if (!row || row.participant_id !== participantId) return;
          const { data } = await supabase.from('participant_prep_standalone')
            .select('id, label, content, updated_at')
            .eq('session_id', sessionId).eq('participant_id', participantId).order('label');
          setStandalone(data || []);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId, participantId]);

  return { prep, standalone, expected, loading };
}
