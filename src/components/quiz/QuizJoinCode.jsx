import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

// The join code, big, on the lobby screen — so a room scans instead of being
// read a URL letter by letter.
//
// LOBBY ONLY. The roster is snapshotted when the run starts and nobody joins
// mid-quiz, so a code still on screen at question four would be an invitation
// the system refuses to honour.
//
// The typed code stays next to the QR. Not everyone will scan — a locked
// phone, a camera that will not focus across a dark room, someone already
// signed in on a laptop — and the six characters are the fallback that always
// works.
export default function QuizJoinCode({ joinCode }) {
  const canvasRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const url = `${window.location.origin}/join/${joinCode}`;

  useEffect(() => {
    if (!canvasRef.current || !joinCode) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: 320,
      margin: 1,
      // Quiet dark-on-light: a projector's contrast is poor and an inverted
      // code is a coin toss as to whether a phone camera finds it at all.
      color: { dark: '#16304d', light: '#ffffff' },
      // Medium recovery: enough to survive a projector's fuzz and someone's
      // head in the corner of the beam, without doubling the module count.
      errorCorrectionLevel: 'M',
    }).catch(() => setFailed(true));
  }, [url, joinCode]);

  if (!joinCode) return null;

  return (
    <div className="qlive-join">
      {!failed && <canvas ref={canvasRef} className="qlive-qr" aria-label={`QR code to join at ${url}`} />}
      <div className="qlive-join-text">
        <span className="qlive-join-label">Join at</span>
        <span className="qlive-join-url">{window.location.host}/join</span>
        <span className="qlive-join-code">{joinCode}</span>
      </div>
    </div>
  );
}
