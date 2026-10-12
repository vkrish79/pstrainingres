import { useEffect, useRef } from 'react';
import { whenStopped } from '../../lib/workbookResume.js';
import AssessmentChip from './AssessmentChip.jsx';
import KebabMenu from '../KebabMenu.jsx';
import SaveFailedBar from './SaveFailedBar.jsx';
import { AmadeusShareButton } from './AmadeusShare.jsx';

// The sticky bar under the workbook header: save state, the reading drawers,
// the assessment chip, raise hand, and ⋯.
export default function WorkbookActionsBar({
  session, overallStatus, lastSavedAt, notedSections, totalNoteWords,
  setNotesOpen, prepOpen, setPrepOpen, prepBtnRef, prepCount,
  materials, materialsLoading, setMaterialsOpen, onOpenAssessment,
  handUp, helpBusy, toggleHelp, printWorkbook,
  failures, blocks, sections, retryFailed,
}) {
  const actionsBarRef = useRef(null);
  // Publish the sticky actions-bar height as --page-actions-h so the exercise
  // sidebar's sticky top can stack below it without overlapping.
  useEffect(() => {
    const el = actionsBarRef.current;
    if (!el) return undefined;
    const apply = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      document.body.style.setProperty('--page-actions-h', `${h}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.body.style.removeProperty('--page-actions-h');
    };
  }, []);

  return (
    <div className="participant-actions-bar no-print" ref={actionsBarRef}>
      {/* One spot for "is my work safe": the live status while a save is in
          flight or has failed, otherwise when they last saved. */}
      {/* A failure is not shown here any more: it gets the full-width
          SaveFailedBar below, which says why and whether to try again. */}
      {overallStatus === 'saving' ? (
        <span className="wb-save-indicator saving" role="status">Saving…</span>
      ) : overallStatus !== 'error' && lastSavedAt ? (
        <span className="wb-save-indicator saved">✓ Last saved {whenStopped(lastSavedAt)}</span>
      ) : null}
      {/* The things you read sit together as one group; the assessment says
          its state; asking for help is the one strong button; printing is
          occasional, so it lives behind ⋯. */}
      <div className="pab-group" role="group" aria-label="Your reading">
        <button
          type="button"
          className="pab-seg"
          onClick={() => setNotesOpen(true)}
          data-tip={notedSections > 0
            ? `Your notes — ${notedSections} exercise${notedSections === 1 ? '' : 's'}, ${totalNoteWords} word${totalNoteWords === 1 ? '' : 's'} (press N)`
            : 'Your notes (press N)'}
        >
          📝 Notes{notedSections > 0 && <span className="pab-count">{notedSections}</span>}
        </button>
        {/* Toggles. It used to only ever open, so pressing it again while
            the drawer was already open did nothing — and nothing about the
            button said the drawer was open in the first place. */}
        <button
          type="button"
          ref={prepBtnRef}
          className={`pab-seg${prepOpen ? ' is-on' : ''}`}
          aria-expanded={prepOpen}
          onClick={() => setPrepOpen(o => !o)}
          data-tip={prepOpen ? 'Hide your pre-work' : 'Pre-work from your trainer'}
        >
          🎯 Prep{prepCount > 0 && <span className="pab-count">{prepCount}</span>}
        </button>
        {/* Only when this program HAS handouts. A button that opens an empty
            drawer is a promise of something to read that does not exist, and
            most programs carry none.
            `!materialsLoading` matters as much as the count: without it the
            button pops into a row the participant may already be reaching
            for, moving the buttons after it out from under the cursor. */}
        {!materialsLoading && materials.length > 0 && (
          <button
            type="button"
            className="pab-seg"
            onClick={() => setMaterialsOpen(true)}
            data-tip="Handouts and quick references for this program"
          >
            📎 Handouts<span className="pab-count">{materials.length}</span>
          </button>
        )}
      </div>
      {session?.assessment_id && (
        <AssessmentChip
          unlockedAt={session.assessment_unlocked_at}
          deadlineAt={session.assessment_deadline_at}
          onOpen={onOpenAssessment}
        />
      )}
      <AmadeusShareButton />
      <button
        type="button"
        className={`help-hand${handUp ? ' is-up' : ''}`}
        onClick={toggleHelp}
        disabled={helpBusy || !session?.id}
        aria-pressed={!!handUp}
        data-tip={handUp ? 'Put your hand down' : 'Ask your trainer for help — only they will see it'}
      >
        {handUp ? '✋ Help asked · Cancel' : '✋ Ask for help'}
      </button>
      <KebabMenu
        label="More"
        className="pab-more"
        items={[
          { label: 'Print / Download PDF', glyph: '↓', onClick: printWorkbook },
        ]}
      />
      <SaveFailedBar failures={failures} blocks={blocks} sections={sections} onRetry={retryFailed} where="workbook" />
    </div>
  );
}
