import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Enrolment rows -> the participant list every view reads. The deactivation
// fields ride along on the participant so the roster, the close check and the
// menus all ask "is this person a dropout?" of the same object.
//
// The enrolment is read with `*` rather than by naming the deactivation
// columns: until 20260917000000_participant_dropout_close_check.sql is applied
// those columns do not exist, and naming them would fail the whole dashboard.
//
// The profiles embed NAMES its foreign key. An un-hinted `profiles (...)` is
// refused outright ("more than one relationship was found") the moment a
// second FK from session_participants to profiles exists — which happened
// once, briefly, and took this page down.
function toParticipants(rows) {
  return (rows || [])
    .filter(sp => sp.profiles)
    .map(sp => ({
      ...sp.profiles,
      deactivated_at: sp.deactivated_at ?? null,
      deactivated_by_name: sp.deactivated_by_name ?? null,
      deactivation_reason: sp.deactivation_reason ?? null,
    }))
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
}

// Fetches a session's participants + workbook structure + all answers,
// and keeps answers live via a realtime subscription.
export function useSessionDashboard(sessionId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [session, setSession] = useState(null);
  const [workbook, setWorkbook] = useState(null);
  const [sections, setSections] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [participants, setParticipants] = useState([]);   // [{ id, full_name, email, deactivated_at, deactivated_by_name, deactivation_reason }]
  // Participants with at least one assessment answer, read once on load. With
  // the workbook answers (which are live) this decides whether someone has
  // "started" — and so is deactivated rather than removed.
  const [assessmentStarted, setAssessmentStarted] = useState(() => new Set());
  const [answers, setAnswers] = useState({});              // { [participantId]: { [blockId]: { value, updated_at } } }
  const [prepEnabled, setPrepEnabled] = useState(false);   // master workbook has a prep template

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    (async () => {
      try {
        const { data: sess, error: e1 } = await supabase
          .from('sessions')
          .select(`
            id, name, workbook_id, assessment_id, assessment_unlocked_at, assessment_deadline_at, program_id, created_at, starts_at, ends_at, city_code, join_code,
            closed_at, closed_by, closed_summary, trainer_id, vendor_id,
            workbooks ( id, title, description, template_id ),
            program:programs ( id, title, program_type:program_types ( id, name ) ),
            trainer:profiles!sessions_trainer_id_fkey ( id, full_name ),
            session_participants ( *, profiles!session_participants_participant_id_fkey ( id, full_name, email ) )
          `)
          .eq('id', sessionId)
          .single();
        if (e1) throw e1;

        const wb = sess.workbooks;
        const parts = toParticipants(sess.session_participants);

        // A closed session whose copies the retention job has removed has no
        // workbook any more — the closed view reads only the saved summary, so
        // that is fine. A LIVE session without one cannot happen (a table
        // constraint forbids it) and would be a real fault, so it says so.
        if (!wb && !sess.closed_at) throw new Error('This session has no workbook.');

        // Does this session's workbook expect prep? The prep template lives on
        // the MASTER (template) workbook, not the per-session clone.
        let prepIsEnabled = false;
        if (wb?.template_id) {
          const { data: master } = await supabase
            .from('workbooks').select('prep_template').eq('id', wb.template_id).maybeSingle();
          prepIsEnabled = Array.isArray(master?.prep_template) && master.prep_template.length > 0;
        }

        const { data: secs, error: e2 } = wb
          ? await supabase.from('sections').select('*').eq('workbook_id', wb.id).order('order_index')
          : { data: [], error: null };
        if (e2) throw e2;

        const sectionIds = (secs || []).map(s => s.id);
        const { data: blks, error: e3 } = sectionIds.length
          ? await supabase.from('blocks').select('*').in('section_id', sectionIds).order('order_index')
          : { data: [], error: null };
        if (e3) throw e3;

        const { data: ans, error: e4 } = await supabase
          .from('answers')
          .select('participant_id, block_id, value, updated_at')
          .eq('session_id', sessionId);
        if (e4) throw e4;

        const ansMap = {};
        (ans || []).forEach(a => {
          ansMap[a.participant_id] = ansMap[a.participant_id] || {};
          ansMap[a.participant_id][a.block_id] = { value: a.value, updated_at: a.updated_at };
        });

        // Non-fatal: at worst a participant who has only touched the
        // assessment shows "Remove", and the check made on click catches it.
        let started = new Set();
        if (sess.assessment_id) {
          const { data: aRows } = await supabase
            .from('assessment_answers').select('participant_id').eq('session_id', sessionId);
          started = new Set((aRows || []).map(r => r.participant_id));
        }

        if (cancelled) return;
        setSession({
          id: sess.id, name: sess.name,
          starts_at: sess.starts_at, ends_at: sess.ends_at, city_code: sess.city_code,
          join_code: sess.join_code,
          closed_at: sess.closed_at, closed_by: sess.closed_by, closed_summary: sess.closed_summary,
          trainer_id: sess.trainer_id, vendor_id: sess.vendor_id, trainer: sess.trainer || null,
          program_id: sess.program_id, program: sess.program || null,
          assessment_id: sess.assessment_id,
          assessment_unlocked_at: sess.assessment_unlocked_at,
          assessment_deadline_at: sess.assessment_deadline_at,
          // Back-compat for components still reading session.session_type.
          session_type: sess.program?.program_type || null,
        });
        setWorkbook(wb);
        setSections(secs || []);
        setBlocks(blks || []);
        setParticipants(parts);
        setAnswers(ansMap);
        setAssessmentStarted(started);
        setPrepEnabled(prepIsEnabled);
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setError(err.message); setLoading(false); }
      }
    })();

    return () => { cancelled = true; };
  }, [sessionId]);

  // Realtime subscription on answers for this session
  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`session-${sessionId}-answers`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'answers', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          setAnswers(prev => {
            const next = { ...prev };
            if (payload.eventType === 'DELETE') {
              const { participant_id, block_id } = payload.old || {};
              if (next[participant_id]) {
                const inner = { ...next[participant_id] };
                delete inner[block_id];
                next[participant_id] = inner;
              }
            } else {
              const { participant_id, block_id, value, updated_at } = payload.new || {};
              next[participant_id] = {
                ...(next[participant_id] || {}),
                [block_id]: { value, updated_at },
              };
            }
            return next;
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);

  async function refreshParticipants() {
    const { data, error: e } = await supabase
      .from('session_participants')
      .select('*, profiles!session_participants_participant_id_fkey ( id, full_name, email )')
      .eq('session_id', sessionId);
    if (e) return { error: e };
    const parts = toParticipants(data);
    setParticipants(parts);
    return { data: parts };
  }

  async function addSessionParticipants(rows) {
    const { data: { session: authSess } } = await supabase.auth.getSession();
    if (!authSess) return { error: new Error('Not authenticated') };

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/add-session-participants`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authSess.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ session_id: sessionId, participants: rows }),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      return { error: new Error(msg) };
    }
    const data = await res.json();
    await refreshParticipants();
    return { data: data.results || [] };
  }

  async function resetParticipantPassword(participantId) {
    const { data: { session: authSess } } = await supabase.auth.getSession();
    if (!authSess) return { error: new Error('Not authenticated') };

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-participant-password`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authSess.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ session_id: sessionId, participant_id: participantId }),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      return { error: new Error(msg) };
    }
    const data = await res.json();
    return { data };
  }

  async function deleteParticipant(participantId) {
    const { data: { session: authSess } } = await supabase.auth.getSession();
    if (!authSess) return { error: new Error('Not authenticated') };

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-participant`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authSess.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ session_id: sessionId, participant_id: participantId }),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      return { error: new Error(msg) };
    }
    setParticipants(prev => prev.filter(p => p.id !== participantId));
    setAnswers(prev => {
      const next = { ...prev };
      delete next[participantId];
      return next;
    });
    return {};
  }

  // Retroactively draw prep kits for already-enrolled participants who have
  // none. Pass a participantId to allocate for just one; omit it to allocate
  // for everyone who's un-prepped. The participant_prep realtime sub will
  // surface the new rows, but callers can also refresh prep explicitly.
  async function allocateSessionPrep(participantId) {
    const { data: { session: authSess } } = await supabase.auth.getSession();
    if (!authSess) return { error: new Error('Not authenticated') };

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/allocate-session-prep`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authSess.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(participantId ? { session_id: sessionId, participant_id: participantId } : { session_id: sessionId }),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      return { error: new Error(msg) };
    }
    const data = await res.json();
    return { data };
  }

  // Reassign the session's trainer (super / vendor_manager only; enforced by
  // the set_session_trainer RPC). `trainer` is { id, full_name } so we can
  // update the displayed name without a re-query.
  async function setSessionTrainer(trainer) {
    const { error: e } = await supabase.rpc('set_session_trainer', {
      p_session_id: sessionId,
      p_trainer_id: trainer.id,
    });
    if (e) return { error: new Error(e.message) };
    setSession(prev => prev ? { ...prev, trainer_id: trainer.id, trainer: { id: trainer.id, full_name: trainer.full_name } } : prev);
    return { data: true };
  }

  // Change when a session runs.
  //
  // Both rules are enforced by a trigger (20260914000000_session_dates_required):
  // neither date may be null, and the end may not precede the start. The form
  // checks the same two so the reader is told before a round trip, but the
  // trigger is the authority — it covers create_session_from_program and every
  // other path into the table.
  //
  // .select() IS NOT OPTIONAL. An update that RLS refuses comes back 200 with
  // no error and zero rows, so without reading the row back this would report
  // success on a write that never happened.
  async function updateSessionDates(startsAt, endsAt) {
    const { data, error: e } = await supabase
      .from('sessions')
      .update({ starts_at: startsAt, ends_at: endsAt })
      .eq('id', sessionId)
      .select('id, starts_at, ends_at');

    if (e) return { error: new Error(e.message) };
    if (!data || data.length === 0) {
      return { error: new Error('That change was not saved — you may not have permission to edit this session.') };
    }

    const row = data[0];
    setSession(prev => (prev ? { ...prev, starts_at: row.starts_at, ends_at: row.ends_at } : prev));
    return { data: row };
  }

  // `check` is { progress_check, assessment } from CloseSessionModal — see the
  // close-session edge function for what it enforces.
  async function closeSession(check) {
    const { data: { session: authSess } } = await supabase.auth.getSession();
    if (!authSess) return { error: new Error('Not authenticated') };

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/close-session`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authSess.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ session_id: sessionId, ...check }),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      return { error: new Error(msg) };
    }
    const data = await res.json();
    // Drop participants + answers from local state — they're gone now.
    setParticipants([]);
    setAnswers({});
    setSession(prev => prev ? { ...prev, closed_at: data.closed_at, closed_summary: data.closed_summary } : prev);
    return { data };
  }

  async function deleteSession() {
    const { data: { session: authSess } } = await supabase.auth.getSession();
    if (!authSess) return { error: new Error('Not authenticated') };

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-session`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authSess.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ session_id: sessionId }),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      return { error: new Error(msg) };
    }
    const data = await res.json();
    return { data };
  }

  // durationMinutes is optional: a positive number stamps a session-wide
  // deadline now()+N min; null/0 unlocks untimed (open until re-locked).
  async function setAssessmentUnlocked(unlocked, durationMinutes = null) {
    const mins = unlocked && durationMinutes && durationMinutes > 0 ? Math.round(durationMinutes) : null;
    const { data, error: e } = await supabase.rpc('set_assessment_unlocked', {
      p_session_id: sessionId,
      p_unlocked: !!unlocked,
      p_duration_minutes: mins,
    });
    if (e) return { error: new Error(e.message) };
    // data is { unlocked_at, deadline_at } jsonb.
    setSession(prev => prev ? {
      ...prev,
      assessment_unlocked_at: data?.unlocked_at ?? null,
      assessment_deadline_at: data?.deadline_at ?? null,
    } : prev);
    return { data };
  }

  // Add minutes to the live deadline (greatest(now, deadline) + N). Reopens an
  // already-expired timer for N fresh minutes. Requires the assessment unlocked.
  async function extendAssessmentDeadline(addMinutes) {
    const mins = Math.round(Number(addMinutes));
    if (!Number.isFinite(mins) || mins <= 0) return { error: new Error('Enter a positive number of minutes') };
    const { data, error: e } = await supabase.rpc('extend_assessment_deadline', {
      p_session_id: sessionId,
      p_add_minutes: mins,
    });
    if (e) return { error: new Error(e.message) };
    setSession(prev => prev ? {
      ...prev,
      assessment_unlocked_at: data?.unlocked_at ?? prev.assessment_unlocked_at,
      assessment_deadline_at: data?.deadline_at ?? null,
    } : prev);
    return { data };
  }

  // Mark a participant as having dropped out (reason required), or undo it.
  // Their account and answers are untouched either way.
  async function setParticipantDeactivated(participantId, deactivate, reason = null) {
    const { data, error: e } = await supabase.rpc('set_participant_deactivated', {
      p_session_id: sessionId,
      p_participant_id: participantId,
      p_deactivate: !!deactivate,
      p_reason: deactivate ? reason : null,
    });
    if (e) return { error: new Error(e.message) };
    setParticipants(prev => prev.map(p => (p.id === participantId ? {
      ...p,
      deactivated_at: data?.deactivated_at ?? null,
      deactivated_by_name: data?.deactivated_by_name ?? null,
      deactivation_reason: data?.deactivation_reason ?? null,
    } : p)));
    return { data };
  }

  // Asked of the DATABASE at the moment "Remove" is chosen, not of this page's
  // state: assessment answers here were read once on load, so a participant
  // who has started the assessment since would otherwise be hard-deleted along
  // with everything they wrote.
  async function participantHasProgress(participantId) {
    const [w, a] = await Promise.all([
      supabase.from('answers').select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId).eq('participant_id', participantId),
      supabase.from('assessment_answers').select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId).eq('participant_id', participantId),
    ]);
    // "Has progress" is the safe answer to a failed check: the worst it does
    // is offer Deactivate where Remove would have been fine.
    if (w.error || a.error) return true;
    return (w.count || 0) + (a.count || 0) > 0;
  }

  return { loading, error, session, workbook, sections, blocks, participants, answers, assessmentStarted, prepEnabled, setParticipantDeactivated, participantHasProgress, addSessionParticipants, resetParticipantPassword, deleteParticipant, allocateSessionPrep, setSessionTrainer, updateSessionDates, closeSession, deleteSession, setAssessmentUnlocked, extendAssessmentDeadline };
}
