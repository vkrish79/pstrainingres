import { supabase } from './supabase.js';

// A guest of a standalone quiz: signed in anonymously, remembered on the
// device, and gone when the quiz ends.
//
// WHY ANONYMOUS SIGN-IN rather than a token of our own: it makes a guest an
// ordinary auth.uid(), so every function that already asks "who is calling" —
// the answer clock, the one-answer-per-person lock, the leaderboard — works
// for them unchanged. The alternative was teaching eight functions a second
// kind of caller, in code the session route also runs.
//
// The account is deleted when the run ends. See quiz_purge_run.

const KEY = 'quiz.guest.run';

// Which run this device is in, so a phone that locks, reloads or wanders off
// to another app comes back to the room rather than to the join screen.
export function rememberRun(runId, name) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ runId, name, at: Date.now() }));
  } catch { /* private window, or storage full — the page still works */ }
}

export function recallRun() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    // Twelve hours, the same boundary the rest of the quiz uses to decide a
    // run is not really live any more. Without it, tomorrow's scan lands in
    // yesterday's room.
    if (!v?.runId || Date.now() - (v.at || 0) > 12 * 60 * 60 * 1000) return null;
    return v;
  } catch { return null; }
}

export function forgetRun() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to do */ }
}

// Sign in, but only if nobody is signed in already.
//
// THE ORDER MATTERS. A trainer testing their own quiz on their own laptop is
// already signed in as themselves, and signing them in anonymously here would
// throw away the session they are working in — on the machine that is driving
// the room. So an existing session always wins, whoever it belongs to.
export async function ensureGuestSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return { data: session.user };

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    // The one failure worth naming: the project has anonymous sign-ins turned
    // off, and no amount of retrying will change that.
    const off = /anonymous/i.test(error.message || '');
    return {
      error: new Error(off
        ? 'This quiz cannot take guests — anonymous sign-in is switched off for this app.'
        : error.message),
    };
  }
  return { data: data.user };
}

// Join a run by its code. Returns { runId, displayName, quizTitle } or an
// error already phrased for somebody standing in a room holding a phone.
export async function joinQuiz(code, name) {
  const signedIn = await ensureGuestSession();
  if (signedIn.error) return { error: signedIn.error };

  const { data, error } = await supabase.rpc('quiz_join', {
    p_code: (code || '').trim().toUpperCase(),
    p_name: name,
  });

  if (error) {
    // The database raises with a specific SQLSTATE per case; the message it
    // carries is already the sentence we want on screen, so this only has to
    // recognise them rather than rewrite them.
    const msg = error.message || '';
    if (/no quiz with that code/i.test(msg)) {
      return { error: new Error('No quiz with that code. Check the six characters on the screen at the front.') };
    }
    if (/already started/i.test(msg)) {
      return { error: new Error('This quiz started without you. Watch the screen — you can join the next one.') };
    }
    if (/name is taken/i.test(msg)) {
      return { error: new Error('That name is taken. Someone got there first — try another one.') };
    }
    if (/2 to 20/i.test(msg)) {
      return { error: new Error('A name needs to be 2 to 20 characters.') };
    }
    return { error: new Error(msg) };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.run_id) return { error: new Error('That did not work. Try the code again.') };

  rememberRun(row.run_id, row.display_name);
  return { data: { runId: row.run_id, displayName: row.display_name, quizTitle: row.quiz_title } };
}
