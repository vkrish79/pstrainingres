import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// How often the field has reworded each part of a master workbook, and how
// much of that is still waiting on a decision.
//
// Reads workbook_edit_heat, which returns two levels in one result set:
// 'section' rows (every edit in that exercise, including ones whose block
// could not be mapped) and 'block' rows (attributed edits only). Section heat
// is therefore never smaller than the blocks inside it.
//
// The counts that drive the markers are OPEN only. `totalSessions` carries the
// all-time figure so a fully-reviewed exercise can still offer a way into its
// history — otherwise resolving everything would make the record unreachable.
//
// `enabled` gates the call rather than relying on RLS alone — vendor-tier
// reaches the workbook page through its read-only branch, and firing a query
// that can only come back empty just looks broken.
export function useWorkbookEditHeat(workbookId, enabled = true) {
  const [loading, setLoading] = useState(true);
  const [bySection, setBySection] = useState(() => new Map());
  const [byBlock, setByBlock] = useState(() => new Map());

  const load = useCallback(async () => {
    if (!workbookId || !enabled) { setLoading(false); return; }
    const { data, error } = await supabase.rpc('workbook_edit_heat', {
      p_workbook_id: workbookId,
    });
    // A missing RPC (migration not yet applied) must not break the editor:
    // no heat simply means no markers.
    if (error) { setBySection(new Map()); setByBlock(new Map()); setLoading(false); return; }

    const secs = new Map();
    const blks = new Map();
    (data || []).forEach(r => {
      const entry = {
        openEdits: Number(r.edit_count) || 0,
        openSessions: Number(r.session_count) || 0,
        openTrainers: Number(r.trainer_count) || 0,
        totalSessions: Number(r.total_sessions) || 0,
        lastChangedAt: r.last_changed_at,
      };
      if (r.level === 'section') secs.set(r.master_section_id, entry);
      else if (r.master_block_id) blks.set(r.master_block_id, entry);
    });
    setBySection(secs);
    setByBlock(blks);
    setLoading(false);
  }, [workbookId, enabled]);

  useEffect(() => { load(); }, [load]);

  // Only exercises with something still open count towards the "needs a look"
  // figure in the page header.
  const openSections = [...bySection.values()].filter(e => e.openSessions > 0).length;
  // Every exercise with a recorded change, resolved included. The header entry
  // point uses this so it survives finishing a review — the history has to stay
  // reachable once nothing is open.
  const totalSections = bySection.size;

  return { loading, bySection, byBlock, openSections, totalSections, refresh: load };
}

// The drill-down behind one marker. Kept separate from the heat load so opening
// a modal never re-fetches the whole map. Returns resolved groups as well as
// open ones — the modal filters client-side, so the toggle is instant.
export async function fetchEditDetail(workbookId, sectionId, blockId = null) {
  const { data, error } = await supabase.rpc('workbook_edit_detail', {
    p_workbook_id: workbookId,
    p_section_id: sectionId,
    p_block_id: blockId,
  });
  if (error) return { rows: [], error: error.message };
  return { rows: data || [], error: null };
}

// Every change group across every workbook, for the change log page. Comes
// back with resolved groups included and no server-side status filter, so the
// page's status tabs cost no round trip.
//
// Rows carry the same column names as workbook_edit_detail plus the workbook
// and exercise they belong to, which is what lets both surfaces render through
// the same ChangeEntry.
export function useAllChanges(enabled = true, limit = 500) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!enabled) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const { data, error: e } = await supabase.rpc('workbook_changes_all', {
      p_limit: limit,
    });
    // A missing RPC means the migration has not been applied yet. Say so
    // plainly rather than showing an empty page that looks like "no changes".
    if (e) {
      setError(
        /function .* does not exist/i.test(e.message)
          ? 'The change log function is not in the database yet — run 20260905000000_change_log_page.sql.'
          : e.message,
      );
      setRows([]);
    } else {
      setError('');
      setRows(data || []);
    }
    setLoading(false);
  }, [enabled, limit]);

  useEffect(() => { load(); }, [load]);

  return { loading, rows, error, refresh: load };
}

// Record a decision about one session's change to one block. NULLs are
// literal here: a null blockId addresses the unattributed group, not "all
// blocks". Status is 'adopted' | 'not_needed' | 'open' (reopen).
export async function resolveChangeGroup({
  workbookId, sectionId, blockId, sessionId, actorId, status, note = null,
}) {
  const { error } = await supabase.rpc('resolve_change_group', {
    p_workbook_id: workbookId,
    p_section_id: sectionId,
    p_block_id: blockId ?? null,
    p_session_id: sessionId ?? null,
    p_actor_id: actorId ?? null,
    p_status: status,
    p_note: note,
  });
  return { error: error ? error.message : null };
}

// Per-line decisions for every group, keyed the same way the UI keys a group.
// Comes back already stripped of decisions a newer edit has overtaken, so
// whatever arrives here can be shown as-is.
export async function fetchLineDecisions(workbookId = null) {
  const { data, error } = await supabase.rpc('change_line_decisions', {
    p_workbook_id: workbookId,
  });
  // Migration not applied yet: no per-line state, and the group-level buttons
  // still work. Degrade rather than break.
  if (error) return { byGroup: new Map(), error: error.message };
  const m = new Map();
  (data || []).forEach(r => {
    const k = `${r.master_block_id || '-'}|${r.session_id || '-'}|${r.actor_id || '-'}`;
    m.set(k, r.line_decisions || {});
  });
  return { byGroup: m, error: null };
}

// Record a decision about ONE diff line. `allLineKeys` is every line the user
// can see in this group — the server needs it to know when the group is fully
// answered, since the diff itself is computed here, not in SQL.
export async function setLineDecision({
  workbookId, sectionId, blockId, sessionId, actorId, lineKey, status, allLineKeys,
}) {
  const { data, error } = await supabase.rpc('set_change_line_decision', {
    p_workbook_id: workbookId,
    p_section_id: sectionId,
    p_block_id: blockId ?? null,
    p_session_id: sessionId ?? null,
    p_actor_id: actorId ?? null,
    p_line_key: lineKey,
    p_status: status,
    p_all_line_keys: allLineKeys,
  });
  return { lines: data || {}, error: error ? error.message : null };
}

// Everything still open in one exercise, in a single action. Groups already
// resolved are left alone, so this can't overwrite an earlier decision.
export async function resolveSectionChanges({ workbookId, sectionId, status, note = null }) {
  const { data, error } = await supabase.rpc('resolve_section_changes', {
    p_workbook_id: workbookId,
    p_section_id: sectionId,
    p_status: status,
    p_note: note,
  });
  return { count: data ?? 0, error: error ? error.message : null };
}

// Totals for the workbook LIST — one call covering every workbook, never one
// per card. Without this the heat map is invisible until you happen to open
// the right master, which is how a log ends up unread.
export function useEditHeatTotals(enabled = true) {
  const [totals, setTotals] = useState(() => new Map());

  useEffect(() => {
    if (!enabled) { setTotals(new Map()); return undefined; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('workbook_edit_heat_totals');
      if (cancelled || error) return; // migration not applied yet = no badges
      const m = new Map();
      (data || []).forEach(r => m.set(r.master_workbook_id, {
        sectionCount: Number(r.section_count) || 0,
        sessionCount: Number(r.session_count) || 0,
        lastChangedAt: r.last_changed_at,
      }));
      setTotals(m);
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  return totals;
}
