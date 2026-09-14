import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { joinQuiz, recallRun, forgetRun } from '../lib/quizGuest.js';
import QuizParticipant from '../components/quiz/QuizParticipant.jsx';
import '../styles/quiz-live.css';

// The whole of a guest's app: a code, a name, and then the answering pad.
//
// NO SIGN-IN, and that is the point — this is the one route in the app that a
// person with no account can reach. It asks for a name because a name has to
// go on the wall, not because it identifies anybody.
//
// TWO WAYS IN. A scan arrives at /play/HQ4M2T with the code already in the
// link and goes straight to the name box. Someone typing arrives at /play and
// gets the code screen first, which is the fallback for a locked phone or a
// camera that will not focus across a dark room.
export default function PlayQuizPage() {
  const { code: codeFromUrl } = useParams();
  const navigate = useNavigate();

  const [code, setCode] = useState((codeFromUrl || '').toUpperCase());
  const [name, setName] = useState('');
  const [runId, setRunId] = useState(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef(null);

  // Back into the room this device was already in. Checked before anything is
  // drawn, so a reload mid-question does not flash the join screen at someone
  // who is in the middle of answering.
  useEffect(() => {
    const remembered = recallRun();
    if (!remembered) return;
    let alive = true;
    (async () => {
      // Trust it only as far as the server agrees: the run may have ended
      // while the phone was in a pocket, and the guest row is deleted with it.
      const { data } = await supabase.rpc('quiz_current', { p_run_id: remembered.runId });
      const row = Array.isArray(data) ? data[0] : data;
      if (!alive) return;
      if (row && row.phase && row.phase !== 'ended') setRunId(remembered.runId);
      else forgetRun();
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (codeFromUrl && !runId) nameRef.current?.focus();
  }, [codeFromUrl, runId]);

  async function submit(e) {
    e.preventDefault();
    if (joining) return;
    setError('');
    setJoining(true);
    const { data, error: err } = await joinQuiz(code, name);
    setJoining(false);
    if (err) { setError(err.message); return; }
    setRunId(data.runId);
  }

  // In the room: the ordinary handset, which knows nothing about guests.
  if (runId) {
    return (
      <QuizParticipant
        runId={runId}
        guest
        onDismiss={() => { forgetRun(); setRunId(null); setName(''); navigate('/play'); }}
      />
    );
  }

  const needsCode = !codeFromUrl;

  return (
    <div className="qlive qlive-participant">
      <div className="qlive-stage qlive-centre">
        <form className="qjoin" onSubmit={submit}>
          <h1 className="qlive-big">{needsCode ? 'Join the quiz' : 'Almost in'}</h1>
          <p className="qlive-sub">
            {needsCode
              ? 'Type the six characters on the screen at the front.'
              : 'What should we call you? Everyone will see this.'}
          </p>

          {needsCode && (
            <input
              className="qjoin-field qjoin-code"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="ABC123"
              aria-label="Join code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck="false"
              inputMode="text"
              required
            />
          )}

          <input
            ref={nameRef}
            className="qjoin-field"
            value={name}
            onChange={e => setName(e.target.value.slice(0, 20))}
            placeholder="Your name"
            aria-label="Your name"
            maxLength={20}
            required
          />

          {/* The error sits above the button, where a thumb is already looking. */}
          {error && <p className="qlive-err qjoin-err">{error}</p>}

          <button type="submit" className="qlive-go qjoin-go" disabled={joining || !name.trim() || code.length < 6}>
            {joining ? 'Joining…' : "I'm in"}
          </button>
        </form>
      </div>
    </div>
  );
}
