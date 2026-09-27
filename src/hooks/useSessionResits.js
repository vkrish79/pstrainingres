import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Who in THIS session has sat the paper again somewhere else, and how they did.
//
// This is a read the cohort report did not previously make. Every other figure
// on that table comes from the session being looked at; a re-sit result lives in
// a different session entirely, found through session_participants.
// prior_participant_id pointing back at somebody here.
//
// THE PAIRING PROBLEM. The two sittings are different papers — different
// assessment_blocks rows with different ids — so a re-sit mark cannot be keyed
// by block id. The only thing the two share is template_block_id, the pointer
// both clones carry to the same master block. So results come back keyed by
// TEMPLATE block id, and the report matches its own columns the same way.
//
// A question swapped in from the bank has no template_block_id at all, which is
// exactly how "this is a different question" is detected rather than guessed:
// it simply has nothing to pair with.
export function useSessionResits(sessionId, enabled = true) {
  const [byPriorParticipant, setByPriorParticipant] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!sessionId || !enabled) { setByPriorParticipant(new Map()); return; }
    setLoading(true); setError('');
    try {
      // Everyone here, so the search below can be scoped to them.
      const { data: mine, error: e1 } = await supabase
        .from('session_participants').select('participant_id').eq('session_id', sessionId);
      if (e1) throw e1;
      const priorIds = (mine || []).map(r => r.participant_id);
      if (!priorIds.length) { setByPriorParticipant(new Map()); setLoading(false); return; }

      // Re-sit enrolments pointing back at one of them. `prior_attempt` rides
      // along because it is the frozen headline of the FIRST sitting, and after
      // this session closes it is the only thing that still resolves.
      const { data: links, error: e2 } = await supabase
        .from('session_participants')
        .select('session_id, participant_id, prior_participant_id, prior_attempt')
        .in('prior_participant_id', priorIds);
      if (e2) throw e2;
      if (!links?.length) { setByPriorParticipant(new Map()); setLoading(false); return; }

      const resitSessionIds = [...new Set(links.map(l => l.session_id))];
      const { data: resitSessions } = await supabase
        .from('sessions')
        .select('id, name, starts_at, closed_at, assessment_id')
        .in('id', resitSessionIds);
      const sessById = new Map((resitSessions || []).map(s => [s.id, s]));

      // Each re-sit paper's blocks, so marks can be re-keyed onto template ids.
      const assessmentIds = [...new Set((resitSessions || []).map(s => s.assessment_id).filter(Boolean))];
      const { data: secs } = assessmentIds.length
        ? await supabase.from('assessment_sections')
            .select('id, assessment_id, source_bank_section_id').in('assessment_id', assessmentIds)
        : { data: [] };
      const { data: blks } = (secs || []).length
        ? await supabase.from('assessment_blocks')
            .select('id, section_id, template_block_id').in('section_id', (secs || []).map(s => s.id))
        : { data: [] };
      const { data: keys } = (blks || []).length
        ? await supabase.from('assessment_answer_keys')
            .select('assessment_block_id, points').in('assessment_block_id', (blks || []).map(b => b.id))
        : { data: [] };
      const { data: marks } = resitSessionIds.length
        ? await supabase.from('assessment_marks')
            .select('session_id, participant_id, assessment_block_id, awarded, comment')
            .in('session_id', resitSessionIds)
        : { data: [] };

      const secById = new Map((secs || []).map(s => [s.id, s]));
      const blockById = new Map((blks || []).map(b => [b.id, b]));
      const pointsByBlock = new Map((keys || []).map(k => [k.assessment_block_id, Number(k.points) || 0]));

      const out = new Map();
      for (const link of links) {
        const sess = sessById.get(link.session_id);
        if (!sess) continue;

        const paperBlocks = (blks || []).filter(b => secById.get(b.section_id)?.assessment_id === sess.assessment_id);
        const possible = paperBlocks.reduce((n, b) => n + (pointsByBlock.get(b.id) || 0), 0);

        // Marks re-keyed onto the template block, which is what the report's own
        // columns are keyed by. A swapped question has no template id, so its
        // mark is held separately under the section it replaced.
        const byTemplateBlock = new Map();
        const replacedSectionIds = new Set();
        let earned = 0;
        for (const m of (marks || [])) {
          if (m.session_id !== link.session_id || m.participant_id !== link.participant_id) continue;
          const blk = blockById.get(m.assessment_block_id);
          if (!blk) continue;
          const awarded = Number(m.awarded) || 0;
          earned += awarded;
          if (blk.template_block_id) {
            byTemplateBlock.set(blk.template_block_id, { awarded, comment: m.comment ?? null });
          } else {
            const sec = secById.get(blk.section_id);
            if (sec?.source_bank_section_id) replacedSectionIds.add(sec.id);
          }
        }

        // Sections this re-sit answers with a different question. Recorded even
        // when nothing has been marked yet, because the report must show the
        // column as replaced whether or not a mark exists for it.
        for (const s of (secs || [])) {
          if (s.assessment_id === sess.assessment_id && s.source_bank_section_id) replacedSectionIds.add(s.id);
        }

        const pct = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null;
        out.set(link.prior_participant_id, {
          resitSessionId: link.session_id,
          resitSessionName: sess.name,
          resitStartsAt: sess.starts_at,
          resitClosed: !!sess.closed_at,
          resitParticipantId: link.participant_id,
          priorAttempt: link.prior_attempt || null,
          marksByTemplateBlock: byTemplateBlock,
          replacedSectionCount: replacedSectionIds.size,
          earned,
          possible,
          pct,
          // Nothing marked yet is NOT a score of zero. The report has to be able
          // to say "sat, not marked" rather than print 0% beside a first attempt.
          marked: byTemplateBlock.size > 0,
        });
      }
      setByPriorParticipant(out);
    } catch (err) {
      setError(err.message || String(err));
      setByPriorParticipant(new Map());
    } finally {
      setLoading(false);
    }
  }, [sessionId, enabled]);

  useEffect(() => { load(); }, [load]);

  return { resitsByPriorParticipant: byPriorParticipant, loading, error, reload: load };
}
