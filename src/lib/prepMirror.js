import { supabase } from './supabase.js';

// Workbook kits are COPIED out of the pool at claim time — claim_prep_kit writes
// each payload value into participant_prep (exercise-linked columns) or
// participant_prep_standalone (unlinked ones). So editing an ALLOCATED workbook
// kit's payload changes nothing the participant or the session grid sees unless
// the copy is updated too; that mirror is what this module does.
//
// Assessment kits need no mirror — the participant reads their own
// assessment_prep_kits row directly (assessment_prep_kits_participant_read).
//
// Empty content = clear, matching useSessionPrep.saveOne's empty-is-delete rule.

// Resolve the master→clone section chain for a whole batch in two queries, then
// answer from the maps. Same key shape as usePrepConsumption's `cloneSection`
// (`${workbookId}:${templateSectionId}`) so the two can't drift.
async function resolveChain(sessionIds, masterSectionIds) {
  const { data: sessRows, error: sessErr } = await supabase
    .from('sessions').select('id, workbook_id').in('id', sessionIds);
  if (sessErr) return { error: sessErr };

  const workbookBySession = {};
  for (const s of sessRows || []) workbookBySession[s.id] = s.workbook_id;

  const workbookIds = [...new Set(Object.values(workbookBySession).filter(Boolean))];
  const cloneSection = {};
  if (workbookIds.length && masterSectionIds.length) {
    const { data: secRows, error: secErr } = await supabase
      .from('sections').select('id, workbook_id, template_section_id')
      .in('workbook_id', workbookIds)
      .in('template_section_id', masterSectionIds);
    if (secErr) return { error: secErr };
    for (const s of secRows || []) {
      if (s.template_section_id) cloneSection[`${s.workbook_id}:${s.template_section_id}`] = s.id;
    }
  }
  return { workbookBySession, cloneSection };
}

// items: [{ kit, header, content }] — only ALLOCATED workbook kits belong here.
// Returns { failed: [{ kit, header, message }] }; one item's failure never stops
// the rest, so the caller can report "saved N, M failed" truthfully.
export async function mirrorWorkbookKitCells({ items = [], structure = [] }) {
  const live = items.filter(i => i.kit?.consumed_session_id && i.kit?.consumed_participant_id);
  if (!live.length) return { failed: [] };

  const sectionByHeader = {};
  for (const c of structure) sectionByHeader[c.header] = c.section_id || null;

  const sessionIds = [...new Set(live.map(i => i.kit.consumed_session_id))];
  const masterSectionIds = [...new Set(live.map(i => sectionByHeader[i.header]).filter(Boolean))];

  const failed = [];
  let chain = { workbookBySession: {}, cloneSection: {} };
  if (masterSectionIds.length) {
    const resolved = await resolveChain(sessionIds, masterSectionIds);
    // A READ failure must not be mistaken for "the exercise is gone" — falling
    // back to standalone would leave the stale participant_prep row in place AND
    // add a duplicate standalone item, so the participant sees the value twice.
    if (resolved.error) {
      return { failed: live.map(i => ({ kit: i.kit, header: i.header, message: resolved.error.message })) };
    }
    chain = resolved;
  }

  // Bucket every item into one of four writes, then issue them in bulk.
  const linkedUpsert = [], standaloneUpsert = [], linkedDelete = [], standaloneDelete = [];
  for (const item of live) {
    const { kit, header } = item;
    const content = String(item.content ?? '').trim();
    const sessionId = kit.consumed_session_id;
    const participantId = kit.consumed_participant_id;
    const masterSectionId = sectionByHeader[header] || null;

    let cloneSectionId = null;
    if (masterSectionId) {
      const workbookId = chain.workbookBySession[sessionId];
      if (!workbookId) {
        failed.push({ kit, header, message: 'Could not read the session this kit is allocated to.' });
        continue;
      }
      cloneSectionId = chain.cloneSection[`${workbookId}:${masterSectionId}`] || null;
    }

    // Unlinked column, or the exercise was removed from that session's workbook →
    // the standalone store, keyed by the header text. Never dropped (see R3.3).
    if (!cloneSectionId) {
      const row = { session_id: sessionId, participant_id: participantId, label: header };
      if (content) standaloneUpsert.push({ row: { ...row, content }, item });
      else standaloneDelete.push({ ...row, item });
      continue;
    }
    const row = { session_id: sessionId, participant_id: participantId, section_id: cloneSectionId };
    if (content) linkedUpsert.push({ row: { ...row, content }, item });
    else linkedDelete.push({ ...row, item });
  }

  // One call per table; if it fails, every cell it covered is reported failed.
  async function runUpsert(table, pairs, conflict) {
    if (!pairs.length) return;
    const { error } = await supabase.from(table).upsert(pairs.map(p => p.row), { onConflict: conflict });
    if (error) pairs.forEach(({ item }) => failed.push({ kit: item.kit, header: item.header, message: error.message }));
  }

  await runUpsert('participant_prep', linkedUpsert, 'session_id,participant_id,section_id');
  await runUpsert('participant_prep_standalone', standaloneUpsert, 'session_id,participant_id,label');

  // Clears are rare (emptying a cell), so a loop is fine.
  for (const d of linkedDelete) {
    const { error } = await supabase.from('participant_prep').delete()
      .eq('session_id', d.session_id).eq('participant_id', d.participant_id).eq('section_id', d.section_id);
    if (error) failed.push({ kit: d.item.kit, header: d.item.header, message: error.message });
  }
  for (const d of standaloneDelete) {
    const { error } = await supabase.from('participant_prep_standalone').delete()
      .eq('session_id', d.session_id).eq('participant_id', d.participant_id).eq('label', d.label);
    if (error) failed.push({ kit: d.item.kit, header: d.item.header, message: error.message });
  }

  return { failed };
}
