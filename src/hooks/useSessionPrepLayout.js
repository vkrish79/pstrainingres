import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { attachedHeadersBySection } from '../lib/prepAttach.js';

// Trainer-side: how a class's prep is laid out on its exercises, from the MASTER
// workbook's prep_template mapped onto the class's copy.
//
//   attached  — { [cloneSectionId]: [general header] }: general prep the template
//               shows WITH that exercise (show_with)
//   ownLabels — { [cloneSectionId]: header }: each exercise's own prep column,
//               printed beside its value when the box holds more than one
//
// Pair with useSessionPrep's { prep, standalone } and lib/prepAttach.js's
// itemsForExercise() to fill a trainer view's purple prep box. Best-effort: any
// missing link leaves both empty, and the box shows the exercise's own value
// exactly as before.
export function useSessionPrepLayout(sessionId) {
  const [layout, setLayout] = useState({ attached: {}, ownLabels: {} });

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase
        .from('sessions').select('workbook_id').eq('id', sessionId).maybeSingle();
      if (!sess?.workbook_id) return;
      const [{ data: clone }, { data: cloneSections }] = await Promise.all([
        supabase.from('workbooks').select('id, template_id').eq('id', sess.workbook_id).maybeSingle(),
        supabase.from('sections').select('id, template_section_id').eq('workbook_id', sess.workbook_id),
      ]);
      const masterId = clone?.template_id || clone?.id;
      if (!masterId) return;
      const { data: master } = await supabase
        .from('workbooks').select('prep_template').eq('id', masterId).maybeSingle();
      const template = Array.isArray(master?.prep_template) ? master.prep_template : [];

      const cloneByMaster = new Map();
      for (const s of cloneSections || []) if (s.template_section_id) cloneByMaster.set(s.template_section_id, s.id);
      const ownLabels = {};
      for (const e of template) {
        const clone = e?.section_id ? cloneByMaster.get(e.section_id) : null;
        if (clone && e.header && !ownLabels[clone]) ownLabels[clone] = e.header;
      }
      if (!cancelled) setLayout({ attached: attachedHeadersBySection(template, cloneByMaster), ownLabels });
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  return layout;
}
