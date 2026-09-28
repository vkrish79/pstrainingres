import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { scoreBlocks, isInactiveBlock } from '../lib/assessmentScoring.js';
import { questionResults } from '../lib/assessmentReport.js';
import { buildQuestions } from '../lib/assessmentStructure.js';
import { isAnswered } from '../lib/blockHelpers.js';
import { normaliseGuidance } from '../lib/markingCriteria.js';

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
// both clones carry to the same master block. So the report matches its own
// columns on that, and pairing happens in buildParticipantReport where both
// papers are in hand.
//
// A question swapped in from the bank has no template_block_id at all, which is
// exactly how "this is a different question" is detected rather than guessed:
// it simply has nothing to pair with.
//
// THE SCORE IS NOT A SUM OF assessment_marks, and an earlier draft of this file
// had that wrong. Only MANUAL questions leave a row in assessment_marks; an
// auto-marked question is scored from the participant's answer against the key,
// every time it is displayed. Adding up marks rows would therefore report a
// paper of mixed types as a fraction of its real score — silently, and only on
// papers that happen to contain auto questions. So the re-sit is scored by
// scoreBlocks and questionResults, the same two functions the marking screen
// and the first sitting's half of the report use.
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
        .select('id, name, join_code, starts_at, closed_at, assessment_id')
        .in('id', resitSessionIds);
      const sessById = new Map((resitSessions || []).map(s => [s.id, s]));

      // Each re-sit paper, in full. select('*') on sections and blocks because
      // both scoring and question numbering read fields a column list would
      // have to keep in step with — config, block_type, order_index, title.
      const assessmentIds = [...new Set((resitSessions || []).map(s => s.assessment_id).filter(Boolean))];
      const { data: secs } = assessmentIds.length
        ? await supabase.from('assessment_sections')
            .select('*').in('assessment_id', assessmentIds).order('order_index')
        : { data: [] };
      const sectionIds = (secs || []).map(s => s.id);
      const { data: blks } = sectionIds.length
        ? await supabase.from('assessment_blocks')
            .select('*').in('section_id', sectionIds).order('order_index')
        : { data: [] };
      const blockIds = (blks || []).map(b => b.id);
      const { data: keys } = blockIds.length
        ? await supabase.from('assessment_answer_keys')
            .select('assessment_block_id, key, points, marking_mode').in('assessment_block_id', blockIds)
        : { data: [] };
      const { data: answers } = resitSessionIds.length
        ? await supabase.from('assessment_answers')
            .select('session_id, participant_id, assessment_block_id, value')
            .in('session_id', resitSessionIds)
        : { data: [] };
      const { data: marks } = resitSessionIds.length
        ? await supabase.from('assessment_marks')
            .select('*').in('session_id', resitSessionIds)
        : { data: [] };

      // Marking criteria for each re-sit, through the same SECURITY DEFINER
      // resolution useSessionCriteria uses. They late-bind from the master, and
      // a question whose criteria are only half judged must read as unmarked
      // here exactly as it does on the marking screen.
      const criteriaBySession = new Map();
      await Promise.all(resitSessionIds.map(async id => {
        const { data } = await supabase.rpc('assessment_criteria_for_session', { p_session_id: id });
        const g = {};
        const p = {};
        (data || []).forEach(row => {
          if (!row.guidance) return;
          const n = normaliseGuidance(row.guidance);
          if (!n.criteria.length) return;
          g[row.assessment_block_id] = n;
          p[row.assessment_block_id] = Number(row.points) || 1;
        });
        criteriaBySession.set(id, { guidance: g, points: p });
      }));

      const keyMap = {};
      const pointsMap = {};
      const modeMap = {};
      (keys || []).forEach(k => {
        keyMap[k.assessment_block_id] = k.key;
        pointsMap[k.assessment_block_id] = Number(k.points) || 1;
        // Rows written before manual marking existed are all auto, which is
        // what they already were.
        modeMap[k.assessment_block_id] = k.marking_mode || 'auto';
      });

      const out = new Map();
      for (const link of links) {
        const sess = sessById.get(link.session_id);
        if (!sess) continue;

        const paperSections = (secs || []).filter(s => s.assessment_id === sess.assessment_id);
        const paperSectionIds = new Set(paperSections.map(s => s.id));
        // Withdrawn questions are out of the paper, and filtered before the
        // numbering is built — the same order as the first sitting's half of
        // the report, so the two agree about what question 7 is.
        const liveBlocks = (blks || []).filter(b => paperSectionIds.has(b.section_id) && !isInactiveBlock(b));
        const { labelByBlockId } = buildQuestions(paperSections, liveBlocks);
        const ordered = [...paperSections]
          .sort((a, b) => a.order_index - b.order_index)
          .flatMap(sec => liveBlocks
            .filter(b => b.section_id === sec.id)
            .sort((a, b) => a.order_index - b.order_index));

        const answersForP = {};
        for (const a of (answers || [])) {
          if (a.session_id !== link.session_id || a.participant_id !== link.participant_id) continue;
          answersForP[a.assessment_block_id] = { value: a.value };
        }
        const marksForP = {};
        for (const m of (marks || [])) {
          if (m.session_id !== link.session_id || m.participant_id !== link.participant_id) continue;
          marksForP[m.assessment_block_id] = m;
        }

        const { guidance, points: criteriaPoints } = criteriaBySession.get(link.session_id)
          || { guidance: {}, points: {} };
        // Criteria carry their own totals, and reading the clone's points
        // without them is how a question ends up capped below what its criteria
        // add up to. Same merge the Report tab makes.
        const answerPoints = { ...pointsMap, ...criteriaPoints };

        const score = scoreBlocks(ordered, keyMap, answersForP, answerPoints, modeMap, marksForP, guidance);
        const rows = questionResults({
          blocks: ordered,
          answersForP,
          answerKey: keyMap,
          answerPoints,
          answerModes: modeMap,
          marksForP,
          labelByBlockId,
          guidance,
        });

        // HAS ANYBODY ACTUALLY SAT IT? The same test CloseSessionModal makes,
        // and it has to be asked separately from scoring. An auto-marked paper
        // scores every question the moment it exists — a blank answer is
        // "wrong", not "unmarked" — so an untouched auto paper would otherwise
        // report a confident, entirely fictional 0%.
        const sat = ordered.some(b => isAnswered(b, answersForP[b.id]?.value)
          || marksForP[b.id]?.awarded != null);

        out.set(link.prior_participant_id, {
          resitSessionId: link.session_id,
          resitSessionName: sess.name,
          resitJoinCode: sess.join_code,
          resitStartsAt: sess.starts_at,
          resitClosed: !!sess.closed_at,
          resitParticipantId: link.participant_id,
          priorAttempt: link.prior_attempt || null,
          // Keyed by the RE-SIT's own block ids. Pairing onto the first sitting
          // happens in buildParticipantReport, which is the only place both
          // papers are in hand at once.
          rows,
          replacedSectionCount: paperSections.filter(s => s.source_bank_section_id).length,
          earned: score.earned,
          possible: score.possible,
          pct: score.pct,
          unmarked: score.unmarked,
          sat,
          // Nothing sat and nothing judged is NOT a score of zero. Only a paper
          // somebody has actually engaged with can supersede a real first
          // attempt; until then the report must say so rather than print 0%.
          marked: sat && score.marked > 0,
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
