import { supabase } from './supabase.js';

// The return leg of the prep mirror.
//
// prepMirror carries a POOL edit outward: edit an allocated kit, the participant's
// participant_prep copy follows. This carries a SESSION edit back: the session prep
// grid's column replace and PrepEditor both write participant_prep, and without
// this the kit they were drawn from keeps its original value — so the pool grid
// would show something the participant no longer holds.
//
// Reverse of prepMirror's chain:
//   (session, participant)      -> the allocated kit
//   clone section               -> sections.template_section_id -> master section
//   master section              -> prep_template header         -> payload[header]
//
// Silently does nothing when there is nothing to update — all three are normal:
//   * no allocated kit  — prep was hand-entered, or predates the pool
//   * a spent kit       — the class closed; close-session already snapshotted it
//   * no template column for that section — the prep did not come from a kit
//
// Scope: LINKED prep only (participant_prep, keyed by section). Kit payloads also
// carry STANDALONE columns (prep_template entries with section_id: null, keyed by
// header), and there is no session-side editor for those yet (R3.6). When one is
// built it needs its own write-back path, matching on the header/label instead of
// the section chain — otherwise standalone edits will drift from the pool exactly
// as linked ones did before this module.
//
// Kind config is a parameter because a session-level ASSESSMENT prep editor is
// planned; it differs only in table names.
export const WORKBOOK_WRITE_BACK = {
  kitsTable: 'workbook_prep_kits',
  parentFK: 'workbook_id',
  parentTable: 'workbooks',
  sectionsTable: 'sections',
};

export function createPrepWriteBack(sessionId, cfg = WORKBOOK_WRITE_BACK) {
  // Per-session lookups that never change while the sheet is open. The kit's
  // payload is deliberately NOT cached — it is re-read per write so a concurrent
  // pool edit to a different column of the same kit is not clobbered.
  const masterBySection = new Map();   // clone section id -> master section id
  const headersByParent = new Map();   // master parent id -> (master section id -> header)

  async function masterSectionFor(cloneSectionId) {
    if (masterBySection.has(cloneSectionId)) return masterBySection.get(cloneSectionId);
    const { data } = await supabase
      .from(cfg.sectionsTable).select('template_section_id').eq('id', cloneSectionId).maybeSingle();
    const master = data?.template_section_id || null;
    masterBySection.set(cloneSectionId, master);
    return master;
  }

  async function headerFor(parentId, masterSectionId) {
    if (!headersByParent.has(parentId)) {
      const { data } = await supabase
        .from(cfg.parentTable).select('prep_template').eq('id', parentId).maybeSingle();
      const map = new Map();
      for (const col of Array.isArray(data?.prep_template) ? data.prep_template : []) {
        if (col?.section_id) map.set(col.section_id, col.header);
      }
      headersByParent.set(parentId, map);
    }
    return headersByParent.get(parentId).get(masterSectionId) || null;
  }

  // Returns {} on success or nothing-to-do, { warning } when the kit could not be
  // updated. Never returns `error`: the session edit itself has already landed,
  // and a column replace loops over participants — failing the batch here would
  // abandon the rest for a secondary write.
  async function write({ participantId, sectionId, content }) {
    if (!sessionId || !participantId || !sectionId) return {};

    // Scoped to one session, so this is the participant's single allocated kit:
    // every claim for a session draws from that session's one vendor partition.
    // Taking the first row rather than maybeSingle() anyway — a duplicate should
    // not surface as an error that reads like a permissions failure.
    const { data: kits, error: kitErr } = await supabase
      .from(cfg.kitsTable)
      .select(`id, payload, ${cfg.parentFK}`)
      .eq('consumed_session_id', sessionId)
      .eq('consumed_participant_id', participantId)
      .eq('status', 'allocated')
      .order('kit_index')
      .limit(1);
    if (kitErr) return { warning: kitErr.message };
    const kit = kits?.[0];
    if (!kit) return {}; // hand-entered prep, or the class has closed

    const masterSectionId = await masterSectionFor(sectionId);
    if (!masterSectionId) return {};

    const header = await headerFor(kit[cfg.parentFK], masterSectionId);
    if (!header) return {}; // this exercise has no prep column in the template

    const value = String(content ?? '').trim();
    const payload = { ...(kit.payload || {}) };
    if (value) payload[header] = value; else delete payload[header];

    const { error } = await supabase.from(cfg.kitsTable).update({ payload }).eq('id', kit.id);
    // The one expected refusal: wpk_write lets a super write only the shared pool,
    // so a super editing a VENDOR session's prep cannot update that vendor's kit.
    if (error) return { warning: `Prep saved, but the pool kit was not updated: ${error.message}` };
    return {};
  }

  return { write };
}
