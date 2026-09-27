import { supabase } from './supabase.js';

// Arranging a re-sit takes three calls, and only the first and last are ours.
//
//   1. create_resit_session   the session, a copy of the paper they sat, and the
//                             re-lock of the original
//   2. add-session-participants  the EDGE FUNCTION. Participant accounts are auth
//                             users created with the service role; SQL cannot
//                             make one, which is the whole reason this is not a
//                             single RPC.
//   3. link_resit_participant per person: the pointer back to who they were, and
//                             the frozen headline of their first attempt
//
// Step 2 is not idempotent and steps 1 and 3 are not in one transaction with it,
// so a failure part-way leaves a real session behind. That is reported rather
// than hidden: a trainer who sees "the session exists, these two people are not
// in it" can finish by hand, where a silent rollback attempt could delete a
// session somebody had already started using.
export async function arrangeResit({ ofSessionId, name, startsAt, endsAt, people, swaps = null }) {
  // 1 ── the session and its paper
  const { data: newSessionId, error: rpcErr } = await supabase.rpc('create_resit_session', {
    p_of_session_id: ofSessionId,
    p_name: name,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_swaps: swaps,
  });
  if (rpcErr) return { error: rpcErr, sessionId: null, enrolled: [], failures: [] };

  // 2 ── the accounts. Same username as in the session being re-sat: the sign-in
  // email is scoped by join code, so the same name in a different session is a
  // different account, and the person has one less new thing to remember.
  const { data: { session: authSess } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/add-session-participants`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authSess?.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        session_id: newSessionId,
        participants: people.map(p => ({ username: p.username, full_name: p.name })),
      }),
    },
  );
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* keep statusText */ }
    return { error: new Error(msg), sessionId: newSessionId, enrolled: [], failures: [] };
  }
  const created = await res.json();

  // 3 ── link each new account to who they were. The enrolment response is
  // matched back by USERNAME rather than by position: the function may reorder,
  // skip a duplicate, or rename a clash, and pairing by index would then attach
  // someone's first attempt to somebody else.
  const { data: enrolledRows } = await supabase
    .from('session_participants')
    .select('participant_id, profiles!session_participants_participant_id_fkey ( email, full_name )')
    .eq('session_id', newSessionId);

  const byUsername = new Map(
    (enrolledRows || [])
      .filter(r => r.profiles?.email)
      .map(r => [r.profiles.email.split('@')[0].toLowerCase(), r.participant_id]),
  );

  const enrolled = [];
  const failures = [];
  for (const p of people) {
    const newId = byUsername.get(String(p.username).toLowerCase());
    if (!newId) { failures.push({ name: p.name, why: 'no account was created for them' }); continue; }
    const { error: linkErr } = await supabase.rpc('link_resit_participant', {
      p_resit_session_id: newSessionId,
      p_resit_participant_id: newId,
      p_prior_participant_id: p.id,
    });
    if (linkErr) failures.push({ name: p.name, why: linkErr.message });
    else enrolled.push(p.name);
  }

  return { error: null, sessionId: newSessionId, enrolled, failures, created };
}
