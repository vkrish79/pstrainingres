import { supabase } from './supabase.js';

// Withdrawing a question from a paper.
//
// WHOLE QUESTIONS, NOT PARTS. The flag lives on each block, but it is always
// set and cleared across every block of a question at once. Withdrawing a
// single part of a multi-part question would renumber the parts a participant
// sees — (a)(b)(c) with (b) gone reads as (a)(b) — so the same part would carry
// different letters for the trainer and the participant. A question is the unit
// a trainer thinks in and the unit that keeps the labels honest.
//
// THE REASON IS MANDATORY, and is stored in the block's config alongside the
// flag. That is deliberate: config changes flow through the content-change log,
// so the reason lands in Session changes permanently with no extra plumbing.
// Participants never receive a withdrawn block at all (the read policy filters
// them), so an internal reason cannot leak to them.

export function isWithdrawn(block) {
  return block?.config?.inactive === true;
}

// The reason recorded when a question was withdrawn — read from whichever of
// its blocks carries one. They are written together, so the first is enough.
export function withdrawalOf(blocks) {
  for (const b of blocks || []) {
    if (isWithdrawn(b)) {
      return {
        reason: b.config?.inactive_reason || '',
        by: b.config?.inactive_by || null,
        at: b.config?.inactive_at || null,
      };
    }
  }
  return null;
}

// Take a question out of play, or put it back.
//
// `table` is 'assessment_blocks' for both the master and a session copy — the
// difference is only which rows the caller's RLS lets them touch.
//
// Writes are sequential, not parallel: this project has a documented
// RLS-planning cost on the assessment tables, and each write also fires the
// change-log trigger. A question has a handful of blocks, so this is cheap.
export async function setQuestionWithdrawn(blocks, { withdrawn, reason, actor }) {
  if (withdrawn && !String(reason || '').trim()) {
    return { error: new Error('a reason is required to withdraw a question') };
  }

  for (const b of blocks) {
    const config = { ...(b.config || {}) };
    if (withdrawn) {
      config.inactive = true;
      config.inactive_reason = String(reason).trim();
      config.inactive_by = actor?.name || null;
      config.inactive_at = new Date().toISOString();
    } else {
      // Restoring clears the flag AND the reason. A stale "why we removed it"
      // sitting on a live question is worse than no record — the change log
      // keeps the history either way.
      delete config.inactive;
      delete config.inactive_reason;
      delete config.inactive_by;
      delete config.inactive_at;
    }
    const { error } = await supabase
      .from('assessment_blocks')
      .update({ config })
      .eq('id', b.id);
    if (error) return { error, blockId: b.id };
  }
  return {};
}
