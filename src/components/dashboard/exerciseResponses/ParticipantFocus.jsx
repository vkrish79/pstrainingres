import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { scoreBlocks } from '../../../lib/assessmentScoring.js';
import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock.js';
import { ParticipantAnswers } from './ParticipantTile.jsx';
import { relativeTime } from './relativeTime.js';

// One participant's answers, full width. A modal rather than a wider tile:
// marking is one person at a time, and ← / → walk the same filtered, sorted
// list the tiles are in, so a trainer can work down the cohort without
// going back to the grid between each one.
export default function ParticipantFocus({
  stat, position, sectionTitle, onPrev, onNext, onClose, blocks, answersForP, notesForP,
  sectionNote, prepItems, onSaveNote, onDeleteNote, showNotes, answerKey, answerPoints,
  questionNumbers, answerModes, marksForP, onMark, onComment, markingIds, guidance = null, onBreakdown = null, hands = null, reviewMarks = null,
}) {
  const { participant, answered, total, lastTs } = stat;
  const pct = total ? Math.round((answered / total) * 100) : 0;
  const score = (answerKey || answerModes)
    ? scoreBlocks(blocks, answerKey || {}, answersForP, answerPoints, answerModes, marksForP, guidance)
    : null;

  useBodyScrollLock(true);
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      // Only when the trainer is not typing a comment or a mark.
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if (typing) return;
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      if (e.key === 'ArrowRight' && onNext) onNext();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  return createPortal(
    <div className="modal-backdrop visible" onClick={onClose}>
      <div className="modal-card exresp-focus" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <div className="exresp-focus-title">
            <h2>{participant.full_name || '(unnamed)'}</h2>
            <span className="muted">
              {sectionTitle ? `${sectionTitle} · ` : ''}{answered} / {total} ({pct}%)
              {score && score.possible > 0 ? ` · ${score.earned}/${score.possible} marks` : ''}
              {lastTs ? ` · ${relativeTime(lastTs)}` : ''}
            </span>
          </div>
          <div className="exresp-focus-nav">
            <span className="muted">{position}</span>
            <button type="button" className="ghost btn-sm" onClick={onPrev} disabled={!onPrev} title="Previous participant (←)">←</button>
            <button type="button" className="ghost btn-sm" onClick={onNext} disabled={!onNext} title="Next participant (→)">→</button>
            <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
          </div>
        </header>
        <div className="modal-body exresp-focus-body">
          <ParticipantAnswers
            participant={participant}
            reviewMarks={reviewMarks}
            blocks={blocks}
            answersForP={answersForP}
            notesForP={notesForP}
            sectionNote={sectionNote}
            prepItems={prepItems}
            onSaveNote={onSaveNote}
            onDeleteNote={onDeleteNote}
            showNotes={showNotes}
            answerKey={answerKey}
            answerPoints={answerPoints}
            questionNumbers={questionNumbers}
            answerModes={answerModes}
            marksForP={marksForP}
            onMark={onMark}
            onComment={onComment}
            hands={hands}
            guidance={guidance}
            onBreakdown={onBreakdown}
            markingIds={markingIds}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
