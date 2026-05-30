import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Resolves the participant's allocated assessment_prep_kits row for the
// session, joins it against the master assessment's prep_template (header ->
// section_id), and returns:
//   prep[section_id] = { content }                — header-linked prep
//   standalone = [{ id, label, content }]         — headers with no section
//
// Mirrors the shape of useParticipantPrep so the same callout components can
// render workbook + assessment prep without per-kind branches.
export function useParticipantAssessmentPrep(sessionId, participantId, assessmentCloneId) {
  const [prep, setPrep] = useState({});
  const [standalone, setStandalone] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId || !participantId || !assessmentCloneId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: kit }, { data: tplJson }] = await Promise.all([
        supabase
          .from('assessment_prep_kits')
          .select('payload')
          .eq('consumed_session_id', sessionId)
          .eq('consumed_participant_id', participantId)
          .maybeSingle(),
        supabase.rpc('get_participant_assessment_prep_template', { p_clone_id: assessmentCloneId }),
      ]);
      if (cancelled) return;
      const payload = kit?.payload || {};
      const template = Array.isArray(tplJson) ? tplJson : [];
      const mapByHeader = {};
      const stand = [];
      // Template maps headers -> template_section_id. We need clone section_id,
      // so resolve clone sections by their template_section_id.
      const { data: cloneSections } = await supabase
        .from('assessment_sections')
        .select('id, template_section_id')
        .eq('assessment_id', assessmentCloneId);
      const tplSecIdToCloneSecId = {};
      (cloneSections || []).forEach(s => {
        if (s.template_section_id) tplSecIdToCloneSecId[s.template_section_id] = s.id;
      });
      for (const item of template) {
        const header = item?.header;
        if (!header) continue;
        const content = payload[header];
        if (!content || !String(content).trim()) continue;
        const cloneSecId = item.section_id ? tplSecIdToCloneSecId[item.section_id] : null;
        if (cloneSecId) {
          mapByHeader[cloneSecId] = { content };
        } else {
          stand.push({ id: header, label: header, content });
        }
      }
      setPrep(mapByHeader);
      setStandalone(stand);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionId, participantId, assessmentCloneId]);

  return { prep, standalone, loading };
}
