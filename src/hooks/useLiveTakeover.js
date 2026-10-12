import { useEffect, useRef, useState } from 'react';
import { useActiveQuizRun } from './useActiveQuizRun.js';
import { useActivePoll } from './useActivePoll.js';

const POLL_THANKS_MS = 3500;

// What takes over the participant's screen from the workbook: a running quiz,
// a live poll, or the few seconds of "thanks" after a poll comes down.
export function useLiveTakeover(sessionId) {
  // A quiz is not something a participant navigates to — the trainer says
  // "we're doing a quiz" and it appears. Watching for one beats reading a URL
  // out to sixteen people.
  //
  // STICKY once entered. useActiveQuizRun only reports runs that have not
  // ended, so the moment the trainer ends the quiz it returns null — which
  // yanked the participant back to their workbook before they ever saw the
  // final screen or their score. Holding the id until they dismiss it means
  // the quiz ends the way it should: they close it.
  const { runId: activeQuizRunId } = useActiveQuizRun(sessionId);
  // Polls ask every couple of seconds rather than subscribing: `tally` is a
  // column on poll_runs, so letting a handset SELECT that row to hang a
  // subscription on would hand it the live counts. See useActivePoll.
  const { run: activePoll, refresh: refreshPoll, secondsLeft: pollSecondsLeft } = useActivePoll(sessionId);
  // When the trainer takes a poll down, a few seconds of "thanks" before the
  // workbook comes back — being dropped straight back mid-glance read as the
  // phone having crashed.
  const [pollThanks, setPollThanks] = useState(null);
  const lastPollRef = useRef(null);
  useEffect(() => {
    const prev = lastPollRef.current;
    lastPollRef.current = activePoll;
    if (activePoll) { setPollThanks(null); return undefined; }
    if (!prev) return undefined;
    setPollThanks({ voted: prev.my_vote != null });
    const t = setTimeout(() => setPollThanks(null), POLL_THANKS_MS);
    return () => clearTimeout(t);
  }, [activePoll]);
  const [stickyQuizRunId, setStickyQuizRunId] = useState(null);
  const [quizDismissed, setQuizDismissed] = useState(null);
  useEffect(() => {
    if (activeQuizRunId) setStickyQuizRunId(activeQuizRunId);
  }, [activeQuizRunId]);
  // A later quiz has a new id, so dismissing one never suppresses the next.
  const quizRunId = stickyQuizRunId && stickyQuizRunId !== quizDismissed ? stickyQuizRunId : null;

  return {
    quizRunId,
    dismissQuiz: () => setQuizDismissed(quizRunId),
    activePoll, refreshPoll, pollSecondsLeft,
    pollThanks,
    dismissPollThanks: () => setPollThanks(null),
  };
}
