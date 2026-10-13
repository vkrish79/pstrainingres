import { scoreBlocks } from '../../../lib/assessmentScoring.js';
import { questionTally } from '../../../lib/questionTally.js';
import { sanitizeNotesHtml } from '../../../lib/notesRichText.js';
import PrepCallout from '../../PrepCallout.jsx';
import QuestionScoreStrip from '../QuestionScoreStrip.jsx';
import BlockAnswer from './BlockAnswer.jsx';
import { relativeTime } from './relativeTime.js';

export default function ParticipantTile({ stat, blocks, answersForP, notesForP, sectionNote, prepItems, expanded, onToggle, onFocus = null, onSaveNote, onDeleteNote, showNotes = true, answerKey = null, answerPoints = null, questionNumbers = null, answerModes = null, marksForP = null, onMark = null, onComment = null, markingIds = null, guidance = null, onBreakdown = null, hands = null, reviewMarks = null, questionHeading = null }) {
  const { participant, answered, total, lastTs, flaggedCount, noteCount } = stat;
  // Their raised hand, if any. Only the assessment view passes these — on the
  // workbook the hands already show on the Room tiles.
  const hand = hands ? hands[participant.id] : null;
  const pct = total ? Math.round((answered / total) * 100) : 0;
  const progressClass = answered === 0 ? 'none' : answered === total ? 'full' : 'partial';
  const lastLabel = lastTs ? relativeTime(lastTs) : 'No activity yet';
  // Auto-mark score for this section's scorable blocks (assessment view only).
  // In marks, not questions: a 4-mark matching question answered three-quarters
  // right contributes 3.
  const score = (answerKey || answerModes)
    ? scoreBlocks(blocks, answerKey || {}, answersForP, answerPoints, answerModes, marksForP, guidance)
    : null;
  const scoreClass = score == null ? '' : score.pct === 100 ? 'full' : score.pct === 0 ? 'none' : 'partial';
  // While marking, the pill shows the same running figure as the question's
  // score strip — criteria judged so far included — and says "so far" until
  // every part has a mark. Otherwise the two would disagree on one screen.
  const tally = answerModes
    ? questionTally(blocks, answerKey || {}, answersForP, answerPoints, answerModes, marksForP, guidance)
    : null;

  return (
    <div id={`exresp-tile-${participant.id}`} className={`exresp-tile ${expanded ? 'expanded' : 'collapsed'} ${flaggedCount > 0 ? 'has-flag' : ''} ${hand ? 'has-hand' : ''}`}>
      <div className="exresp-tile-head">
      <button className="exresp-tile-headbtn" onClick={onToggle} aria-expanded={expanded}>
        <div className="exresp-tile-head-left">
          <span className="exresp-chevron" aria-hidden>{expanded ? '▾' : '▸'}</span>
          <span className="exresp-tile-name">{participant.full_name || '(unnamed)'}</span>
          {/* Says it in words rather than repeating ✋. This tile already
              carries "✋ N to mark" on its right-hand side, and two unrelated
              hands on one row would be read as one. */}
          {hand && (
            <span className="exresp-needs-you" title={hand.acknowledged_at ? 'You said you’re coming over' : 'Asked for help'}>
              {hand.acknowledged_at ? 'you’re going' : 'needs you'}
            </span>
          )}
          {flaggedCount > 0 && <span className="exresp-flag-badge" title={`${flaggedCount} flagged`}>🚩 {flaggedCount}</span>}
          {noteCount > 0 && <span className="exresp-note-badge" title={`${noteCount} note${noteCount === 1 ? '' : 's'}`}>💬 {noteCount}</span>}
        </div>
        <div className="exresp-tile-head-right">
          <span className="exresp-tile-meta">{lastLabel}</span>
          {tally && tally.possible > 0 && (
            <span
              className={`exresp-score-pill ${tally.complete ? (tally.soFar >= tally.possible ? 'full' : tally.soFar === 0 ? 'none' : 'partial') : 'is-interim'}`}
              title={tally.complete
                ? `${tally.soFar} of ${tally.possible} marks`
                : `${tally.soFar} of ${tally.possible} marks so far — ${tally.left} part${tally.left === 1 ? '' : 's'} still to mark, so this is not the final score`}
            >
              {tally.soFar}/{tally.possible} marks{tally.complete ? ` · ${Math.round((tally.soFar / tally.possible) * 100)}%` : ' so far'}
            </span>
          )}
          {!tally && score && score.possible > 0 && (
            <span
              className={`exresp-score-pill ${scoreClass}`}
              title={score.unmarked
                ? `${score.earned} of ${score.possible} marks so far — ${score.unmarked} question${score.unmarked === 1 ? '' : 's'} still to mark by hand, so this is not the final score`
                : `${score.earned} of ${score.possible} marks across ${score.marked} marked question${score.marked === 1 ? '' : 's'}`}
            >
              {score.earned}/{score.possible} marks{score.pct != null ? ` · ${score.pct}%` : ''}
            </span>
          )}
          {/* A percentage with marking outstanding is an interim figure. Say so
              on the tile rather than only in a tooltip — otherwise a half-marked
              paper reads as a finished, poor one. */}
          {(tally ? tally.left : score?.unmarked) > 0 && (
            <span className="exresp-unmarked-pill" title="Parts marked by hand that are not finished yet">
              ✋ {tally ? tally.left : score.unmarked} to mark
            </span>
          )}
          <span className={`exresp-progress-pill ${progressClass}`}>{answered} / {total} ({pct}%)</span>
        </div>
      </button>
      {onFocus && (
        <button
          type="button"
          className="exresp-tile-expand"
          onClick={onFocus}
          title={`Open ${participant.full_name || 'this participant'}'s answers in a full-width view`}
          aria-label={`Expand ${participant.full_name || 'participant'}'s answers`}
        >⤢</button>
      )}
      </div>
      {expanded && (
        <div className="exresp-tile-body">
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
            questionHeading={questionHeading}
          />
        </div>
      )}
    </div>
  );
}

// One participant's answers for the selected exercise. Rendered inside the
// tile, and again in the expanded view — same component, so a mark awarded in
// either place is the same control with the same rules.
export function ParticipantAnswers({ participant, blocks, answersForP, notesForP, sectionNote, prepItems, onSaveNote, onDeleteNote, showNotes, answerKey, answerPoints, questionNumbers, answerModes, marksForP, onMark, onComment, markingIds, guidance = null, onBreakdown = null, reviewMarks = null, questionHeading = null, showStrip = true }) {
  const tally = answerModes && showStrip
    ? questionTally(blocks, answerKey || {}, answersForP, answerPoints, answerModes, marksForP, guidance)
    : null;
  return (
    <>
          {tally && tally.parts.length > 0 && (
            <QuestionScoreStrip
              heading={questionHeading}
              tally={tally}
              labelOf={id => questionNumbers?.[id] || ''}
              anchorOf={id => `exresp-b-${participant.id}-${id}`}
            />
          )}
          <PrepCallout heading="Prep" items={prepItems} />
          {sectionNote && (
            <div className="participant-note-readonly">
              <span className="participant-note-readonly-label">Participant note</span>
              <div className="participant-note-readonly-text" dangerouslySetInnerHTML={{ __html: sanitizeNotesHtml(sectionNote) }} />
            </div>
          )}
          {blocks.map(b => (
            <BlockAnswer
              key={b.id}
              anchorId={`exresp-b-${participant.id}-${b.id}`}
              block={b}
              entry={answersForP[b.id]}
              note={notesForP[b.id]}
              participantId={participant.id}
              onSaveNote={onSaveNote}
              onDeleteNote={onDeleteNote}
              showNotes={showNotes}
              answerKey={answerKey}
              answerPoints={answerPoints}
              questionNumber={questionNumbers ? questionNumbers[b.id] : null}
              answerModes={answerModes}
              markForBlock={marksForP ? marksForP[b.id] : null}
              reviewMarks={reviewMarks}
              onMark={onMark}
              onComment={onComment}
              guidanceForBlock={guidance ? guidance[b.id] : null}
              onBreakdown={onBreakdown}
              marking={markingIds ? markingIds.has(`${participant.id}:${b.id}`) : false}
            />
          ))}
          {blocks.length === 0 && <p className="muted" style={{ margin: 0 }}>No questions in this exercise.</p>}
    </>
  );
}
