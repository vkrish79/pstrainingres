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

async function writeLinked(sessionId, participantId, sectionId, content) {
  if (!content) {
    const { error } = await supabase.from('participant_prep').delete()
      .eq('session_id', sessionId).eq('participant_id', participantId).eq('section_id', sectionId);
    return { error };
  }
  const { error } = await supabase.from('participant_prep').upsert(
    { session_id: sessionId, participant_id: participantId, section_id: sectionId, content },
    { onConflict: 'session_id,participant_id,section_id' },
  );
  return { error };
}

async function writeStandalone(sessionId, participantId, label, content) {
  if (!content) {
    const { error } = await supabase.from('participant_prep_standalone').delete()
      .eq('session_id', sessionId).eq('participant_id', participantId).eq('label', label);
    return { error };
  }
  const { error } = await supabase.from('participant_prep_standalone').upsert(
    { session_id: sessionId, participant_id: participantId, label, content },
    { onConflict: 'session_id,participant_id,label' },
  );
  return { error };
}

// kit       — the allocated kit row (needs consumed_session_id + consumed_participant_id)
// header    — the prep_template header (the payload key) that changed
// content   — the new value ('' clears it)
// structure — the master's prep_template: [{ header, section_id|null }]
export async function mirrorWorkbookKitCell({ kit, header, content, structure }) {
  const sessionId = kit?.consumed_session_id;
  const participantId = kit?.consumed_participant_id;
  if (!sessionId || !participantId) return {};

  const value = String(content ?? '').trim();
  const masterSectionId = (structure || []).find(c => c.header === header)?.section_id || null;
  // Unlinked column → the standalone store, keyed by the header text.
  if (!masterSectionId) return writeStandalone(sessionId, participantId, header, value);

  // Linked column: master section → the consuming session's clone section, the
  // same template_section_id chain claim_prep_kit walks.
  //
  // A READ failure here must not be mistaken for "the exercise is gone" — falling
  // back to standalone in that case would leave the stale participant_prep row in
  // place AND add a duplicate standalone item. Only a readable session with no
  // matching clone section earns the fallback.
  const { data: sess, error: sessErr } = await supabase
    .from('sessions').select('workbook_id').eq('id', sessionId).maybeSingle();
  if (sessErr) return { error: sessErr };
  if (!sess) return { error: new Error('Could not read the session this kit is allocated to.') };
  if (!sess.workbook_id) return { error: new Error('The session this kit is allocated to has no workbook.') };

  const { data: secs, error: secErr } = await supabase
    .from('sections').select('id')
    .eq('workbook_id', sess.workbook_id)
    .eq('template_section_id', masterSectionId)
    .limit(1);
  if (secErr) return { error: secErr };

  const cloneSectionId = secs?.[0]?.id || null;
  // Exercise removed from the session's workbook → standalone, never dropped,
  // exactly as claim_prep_kit does.
  if (!cloneSectionId) return writeStandalone(sessionId, participantId, header, value);
  return writeLinked(sessionId, participantId, cloneSectionId, value);
}
