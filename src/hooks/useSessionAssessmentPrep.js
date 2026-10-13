import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { attachedHeadersBySection, calloutItems, splitGeneralPrep } from '../lib/prepAttach.js';

// Every participant's assessment pre-work in one session, by question — the
// trainer's side of useParticipantAssessmentPrep, resolved the same way:
// the kit consumed by that participant, its headers matched to questions
// through the MASTER's prep_template and the clone's template_section_id.
//
// Returns { prepFor(participantId, cloneSectionId) → [{ label, content }] }:
// that question's own value, then any general prep the template shows with it.
// Read-only. Empty until loaded, and for a session with no kits at all.
export function useSessionAssessmentPrep(sessionId, assessmentId) {
  const [byParticipant, setByParticipant] = useState({});

  useEffect(() => {
    if (!sessionId || !assessmentId) { setByParticipant({}); return undefined; }
    let cancelled = false;
    (async () => {
      const [{ data: kits }, { data: clone }, { data: secs }] = await Promise.all([
        supabase.from('assessment_prep_kits').select('consumed_participant_id, payload').eq('consumed_session_id', sessionId),
        supabase.from('assessments').select('template_id').eq('id', assessmentId).maybeSingle(),
        supabase.from('assessment_sections').select('id, template_section_id').eq('assessment_id', assessmentId),
      ]);
      if (cancelled || !kits?.length || !clone?.template_id) { if (!cancelled) setByParticipant({}); return; }
      const { data: master } = await supabase.from('assessments').select('prep_template').eq('id', clone.template_id).maybeSingle();
      if (cancelled) return;
      const template = Array.isArray(master?.prep_template) ? master.prep_template : [];
      const toClone = {};
      (secs || []).forEach(s => { if (s.template_section_id) toClone[s.template_section_id] = s.id; });
      const attached = attachedHeadersBySection(template, toClone);

      const out = {};
      for (const kit of kits) {
        const payload = kit.payload || {};
        const own = {};
        const ownLabel = {};
        const general = [];
        for (const item of template) {
          const header = item?.header;
          const content = header ? payload[header] : null;
          if (!content || !String(content).trim()) continue;
          const sec = item.section_id ? toClone[item.section_id] : null;
          if (sec) { own[sec] = content; ownLabel[sec] = header; } else general.push({ label: header, content });
        }
        const { bySection } = splitGeneralPrep(general, attached);
        const perSection = {};
        for (const sec of new Set([...Object.keys(own), ...Object.keys(bySection)])) {
          perSection[sec] = calloutItems(own[sec], ownLabel[sec], bySection[sec]);
        }
        out[kit.consumed_participant_id] = perSection;
      }
      setByParticipant(out);
    })();
    return () => { cancelled = true; };
  }, [sessionId, assessmentId]);

  return { prepFor: (pid, sectionId) => byParticipant[pid]?.[sectionId] || [] };
}
