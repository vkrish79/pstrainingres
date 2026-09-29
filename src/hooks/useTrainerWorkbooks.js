import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { isSuperTrainerOrAbove } from '../lib/roles.js';
import { classSummary } from '../lib/programReadiness.js';

// Template library. Super-tier sees every template; vendor-tier sees only those
// flagged vendor_visible (custom/composed workbooks default off — see the
// workbook_vendor_visible migration).
//
// WHAT EACH TEMPLATE IS FOR, not just what it is called. A library that lists
// only titles and dates cannot answer the question anybody actually arrives
// with — is this one in use, and is anyone teaching from it right now — so a
// template nobody delivers from looks exactly like one running in three rooms.
// The program and its classes come back with each row to answer that.
//
// THREE FLAT QUERIES, NOT EMBEDS, the same rule usePrograms follows and for the
// same reason: more than one path back to a table makes an un-hinted embed fail,
// and that has taken a live page down here before.
//
// `workbooks.program_id` is the join, and it is on the workbook row itself —
// attaching a template to a program is what "in use" means. A workbook
// belongs to at most one program, so this is a name, never a count.
//
// COUNTS ARE WHAT THE CALLER CAN SEE. RLS scopes sessions to the reader, so a
// vendor trainer may legitimately see fewer classes against a template than a
// super does. That is the honest figure for whoever is looking, not a bug.
export function useTrainerWorkbooks(trainerId, role) {
  const [loading, setLoading] = useState(true);
  const [workbooks, setWorkbooks] = useState([]);

  useEffect(() => {
    if (!trainerId) return undefined;
    let cancelled = false;
    (async () => {
      let q = supabase
        .from('workbooks')
        .select('id, title, description, updated_at, program_id')
        .eq('is_template', true)
        .order('updated_at', { ascending: false });
      if (!isSuperTrainerOrAbove(role)) q = q.eq('vendor_visible', true);
      const { data: wbs } = await q;
      if (cancelled) return;

      const rows = wbs || [];
      const programIds = [...new Set(rows.map(w => w.program_id).filter(Boolean))];

      // Nothing is attached to a program yet, so there is nothing to look up
      // and no reason to ask.
      const [progs, sess] = programIds.length
        ? await Promise.all([
          supabase.from('programs').select('id, title').in('id', programIds),
          supabase
            .from('sessions')
            .select('id, name, program_id, starts_at, ends_at, closed_at, created_at')
            .in('program_id', programIds),
        ])
        : [{ data: [] }, { data: [] }];
      if (cancelled) return;

      const progById = new Map((progs.data || []).map(p => [p.id, p]));
      const sessByProgram = new Map();
      for (const s of sess.data || []) {
        if (!sessByProgram.has(s.program_id)) sessByProgram.set(s.program_id, []);
        sessByProgram.get(s.program_id).push(s);
      }

      setWorkbooks(rows.map(w => ({
        ...w,
        program: w.program_id ? progById.get(w.program_id) || null : null,
        // classSummary rather than a count of our own, so this page and the
        // Programs page cannot disagree about what "running" means.
        classes: classSummary(sessByProgram.get(w.program_id) || []),
      })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [trainerId, role]);

  return { loading, workbooks };
}
