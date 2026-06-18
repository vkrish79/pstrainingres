import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Phase 2 — the 🔶 in-use burn-down. For each ALLOCATED kit, work out which prep
// exercises the participant has actually worked (a non-empty answer exists for a
// block in the matching clone section), so the grid can deepen those cells while
// the rest of the allocated kit stays plain orange.
//
// Chain: prep_template header → template section_id → clone section (via
// sections.template_section_id in the consuming session) → its blocks → answers.
// Read-only; defensive (any failure → empty map → grid falls back to plain 🟠).
const CFG = {
  workbook: {
    parentField: 'workbook_id', sectionsTable: 'sections', sectionsFK: 'workbook_id',
    blocksTable: 'blocks', answersTable: 'answers',
  },
  assessment: {
    parentField: 'assessment_id', sectionsTable: 'assessment_sections', sectionsFK: 'assessment_id',
    blocksTable: 'assessment_blocks', answersTable: 'assessment_answers',
  },
};

export function usePrepConsumption(kits, structure, kind) {
  const cfg = CFG[kind] || CFG.workbook;
  const [consumed, setConsumed] = useState({}); // { [kitId]: Set<header> }
  const [tick, setTick] = useState(0);

  // header → template section_id (from the parent's prep_template)
  const headerToTmplSection = useMemo(() => {
    const m = {};
    for (const c of structure || []) m[c.header] = c.section_id;
    return m;
  }, [structure]);

  // Only allocated kits with a real session + participant can be "in use".
  const live = useMemo(
    () => (kits || []).filter(k => k.status === 'allocated' && k.consumed_session_id && k.consumed_participant_id),
    [kits],
  );
  const sig = useMemo(
    () => live.map(k => `${k.id}:${k.consumed_session_id}:${k.consumed_participant_id}`).sort().join('|'),
    [live],
  );

  useEffect(() => {
    if (!live.length) { setConsumed({}); return; }
    let cancelled = false;
    (async () => {
      try {
        const sessionIds = [...new Set(live.map(k => k.consumed_session_id))];
        const { data: sessRows } = await supabase.from('sessions').select(`id, ${cfg.parentField}`).in('id', sessionIds);
        const parentBySession = {};
        for (const s of sessRows || []) parentBySession[s.id] = s[cfg.parentField];
        const parentIds = [...new Set(Object.values(parentBySession).filter(Boolean))];
        if (!parentIds.length) { if (!cancelled) setConsumed({}); return; }

        // clone sections (template_section_id) + their blocks, per consuming parent
        const { data: secRows } = await supabase.from(cfg.sectionsTable)
          .select(`id, template_section_id, ${cfg.sectionsFK}`).in(cfg.sectionsFK, parentIds);
        const secIds = (secRows || []).map(s => s.id);
        const { data: blkRows } = secIds.length
          ? await supabase.from(cfg.blocksTable).select('id, section_id').in('section_id', secIds)
          : { data: [] };
        const blocksBySection = {};
        for (const b of blkRows || []) (blocksBySection[b.section_id] ||= []).push(b.id);
        // (parentId, templateSectionId) → cloneSectionId
        const cloneSection = {};
        for (const s of secRows || []) {
          if (s.template_section_id) cloneSection[`${s[cfg.sectionsFK]}:${s.template_section_id}`] = s.id;
        }

        // answered blocks per (session, participant)
        const { data: ansRows } = await supabase.from(cfg.answersTable)
          .select('session_id, participant_id, block_id, value').in('session_id', sessionIds);
        const answered = new Set();
        for (const a of ansRows || []) {
          if (a.value != null && String(a.value).trim() !== '') answered.add(`${a.session_id}:${a.participant_id}:${a.block_id}`);
        }

        const out = {};
        for (const k of live) {
          const parentId = parentBySession[k.consumed_session_id];
          const inUse = new Set();
          for (const header of Object.keys(k.payload || {})) {
            const tmplSec = headerToTmplSection[header];
            if (!tmplSec) continue;
            const cloneSec = cloneSection[`${parentId}:${tmplSec}`];
            const blockIds = cloneSec ? (blocksBySection[cloneSec] || []) : [];
            if (blockIds.some(bid => answered.has(`${k.consumed_session_id}:${k.consumed_participant_id}:${bid}`))) {
              inUse.add(header);
            }
          }
          if (inUse.size) out[k.id] = inUse;
        }
        if (!cancelled) setConsumed(out);
      } catch {
        if (!cancelled) setConsumed({});
      }
    })();
    return () => { cancelled = true; };
  }, [sig, headerToTmplSection, cfg, tick]);

  // Realtime: answers changing during a live class → recompute the burn-down.
  useEffect(() => {
    const channel = supabase
      .channel(`prep-consumption-${cfg.answersTable}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: cfg.answersTable }, () => setTick(t => t + 1))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [cfg.answersTable]);

  return consumed;
}
