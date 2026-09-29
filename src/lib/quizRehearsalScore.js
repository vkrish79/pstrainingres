// The room's own arithmetic, reimplemented on the client for rehearsal only.
//
// NOTHING IN A REAL RUN COMES THROUGH HERE. quiz_answer, quiz_answer_pin and
// quiz_answer_order score a real room on the server, where the clock is
// trustworthy and a participant cannot reach the numbers. This file exists so
// a trainer playing their own quiz alone sees the score the room would have
// seen, and it is the ONE place that duplicates those functions — when they
// change, this is what has to change with them.
//
// TRANSCRIBED FROM THE LIVE FUNCTIONS on 2026-09-29, read out of pg_proc.
// Every branch below matches one in the SQL, including the two places where
// the three functions disagree with each other. Those are noted where they
// are, because a rehearsal that quietly smoothed them over would be showing a
// trainer a room they are not going to get.

// WHAT A CORRECT ANSWER IS WORTH AT THIS SPEED — `v_earned` in all three
// functions, and computed the same way whether the answer was right or not,
// because a forfeited wager is measured against it too.
//
//   1000 × (1 − (elapsed/limit)/2)   ->  instant ~1000, buzzer ~500
//
// Accuracy gates everything; speed swings the other half.
export function earnedAtSpeed({ elapsedMs, limitSeconds }) {
  const limit = Math.max(1, limitSeconds * 1000);
  const elapsed = Math.min(Math.max(0, elapsedMs), limit);
  return Math.max(0, Math.round(1000 * (1 - (elapsed / limit) / 2)));
}

// The stake the server would actually use: clamped to 1–3, and forced to 1
// where the trainer did not open the betting. Clamped rather than refused
// because a handset sending a stake on an ordinary question is a stale tab,
// not an attack.
function clampWager(stake, allowWager) {
  return allowWager ? Math.min(3, Math.max(1, stake || 1)) : 1;
}

// ── choice and boolean — quiz_answer ─────────────────────────────────────
//   correct                        ->  earned × wager
//   wrong, allow_wager, wager > 1  -> -earned × wager
//   otherwise                      ->  0
//
// THE `wager > 1` GUARD IS LOAD-BEARING: a wrong answer costs nothing unless
// the stake was RAISED, so answering can never be worse than staying silent.
// The migration's own comment calls it the one line it exists for.
export function scoreChoice({ correct, elapsedMs, limitSeconds, stake = 1, allowWager = false }) {
  const wager = clampWager(stake, allowWager);
  const earned = earnedAtSpeed({ elapsedMs, limitSeconds });
  if (correct) return { points: earned * wager, wager };
  if (allowWager && wager > 1) return { points: -earned * wager, wager };
  return { points: 0, wager };
}

// ── drop a pin — quiz_answer_pin ─────────────────────────────────────────
// SCORED EXACTLY LIKE A CHOICE, which is the point: a pin is right or wrong
// the way a shape is, so it earns and forfeits the way a shape does.
//
// It was not always so. quiz_answer_pin's losing branch used to read `WHEN
// q.allow_wager` with no stake test, where quiz_answer reads `WHEN
// q.allow_wager AND v_wager > 1` — so a wrong pin at 1× lost points and the
// free play was not free. The guard had been added to one function and missed
// on the other; RUN-THIS-IN-SUPABASE-pin-wager-guard.txt put it back.
//
// It delegates rather than repeating the branches, so the two cannot drift
// apart again on this side the way they did on the server's.
export function scorePin(args) {
  return scoreChoice(args);
}

// ── put in order — quiz_answer_order ─────────────────────────────────────
//   1000 × (right/total) × (1 − (elapsed/limit)/2)
//
// NO WAGER AT ALL — the function takes no stake parameter, and the editor does
// not offer one on a reorder. Partial credit by ABSOLUTE POSITION: an item
// counts only if it is in the slot it belongs in.
//
// ROUNDED ONCE, at the end. Scaling an already-rounded `earned` by the
// fraction gives a different number in the last digit or two, and a rehearsal
// that is off by one against the room is a rehearsal someone will eventually
// have to debug.
export function scoreOrder({ right, total, elapsedMs, limitSeconds }) {
  if (!total) return { points: 0, wager: 1 };
  const limit = Math.max(1, limitSeconds * 1000);
  const elapsed = Math.min(Math.max(0, elapsedMs), limit);
  const points = Math.max(0, Math.round(
    1000 * (right / total) * (1 - (elapsed / limit) / 2),
  ));
  return { points, wager: 1 };
}

// AN INCOMPLETE SEQUENCE IS NOT AN ANSWER. quiz_answer_order refuses it
// outright — "that ordering is incomplete" — so nothing is recorded and the
// question scores zero. Exported so the rehearsal asks the same question the
// server does rather than deciding for itself what half a sequence is worth.
export function orderIsSubmittable(seqLength, total) {
  return total > 0 && seqLength === total;
}

// AN ORDER ANSWER CANNOT BE CHANGED. quiz_answer_order inserts ON CONFLICT DO
// NOTHING and returns 'already answered', where quiz_answer and
// quiz_answer_pin both DO UPDATE. So the FIRST complete sequence stands, and
// a second one is refused — the opposite of every other question type.
export const ORDER_IS_FINAL = true;
