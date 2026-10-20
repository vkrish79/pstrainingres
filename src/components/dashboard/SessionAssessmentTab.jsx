import AssessmentRunStrip from './AssessmentRunStrip.jsx';
import AssessmentResponses from './AssessmentResponses.jsx';
import TrainerAssessmentPreview from './TrainerAssessmentPreview.jsx';
import AssessmentReport from './AssessmentReport.jsx';

// The session dashboard's Assessment tab. The sub-view and the attach error
// are the page's state, so coming back to the tab keeps where you were.
export default function SessionAssessmentTab({
  session, programAssessment, attachProgramAssessment, runBusy, attachError, setAttachError,
  participants, assessmentStarted, hands, assessmentSubView, setAssessmentSubView,
  setAssessmentUnlocked, extendAssessmentDeadline,
}) {
  {/* NOTHING ATTACHED. Three different situations, and a trainer can
      act on only one of them — so each says which it is rather than
      offering the same button three times. */}
  if (!session?.assessment_id) {
    return (
      <div className="assessment-view">
        <div className="assessment-empty">
          <h3>No assessment on this session</h3>
          {/* ONE LINE EACH. The first version explained the snapshot rule
              in full — true, and three sentences a trainer has to read
              before reaching the only button on the screen. What they need
              is which paper, and that pressing it does not start an exam. */}
          {programAssessment ? (
            <>
              <p className="muted">
                <strong>{session?.program?.title || 'This program'}</strong> has{' '}
                <strong>{programAssessment.title}</strong>, added after this session was scheduled.
              </p>
              <div className="assessment-empty-go">
                <button
                  type="button"
                  disabled={!!session?.closed_at}
                  onClick={async () => {
                    const { error: e } = await runBusy('Adding the assessment…', attachProgramAssessment);
                    if (e) setAttachError(e.message);
                  }}
                >
                  Add {programAssessment.title}
                </button>
                <span className="muted">It stays locked until you open it.</span>
              </div>
              {attachError && <p className="error">{attachError}</p>}
            </>
          ) : session?.program_id ? (
            <p className="muted">
              <strong>{session?.program?.title || 'This program'}</strong> has no assessment yet.
            </p>
          ) : (
            <p className="muted">This session was not created from a program.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="assessment-view">
      <AssessmentRunStrip
        unlockedAt={session?.assessment_unlocked_at}
        deadlineAt={session?.assessment_deadline_at}
        onUnlock={(mins) => setAssessmentUnlocked(true, mins)}
        onLock={() => setAssessmentUnlocked(false)}
        onExtend={(mins) => extendAssessmentDeadline(mins)}
      />
      <div className="assessment-subtabs">
        <span className="assessment-subtabs-track" role="group" aria-label="Assessment view">
        <button
          className={`view-subtab ${assessmentSubView === 'responses' ? 'active' : ''}`}
          onClick={() => setAssessmentSubView('responses')}
        >
          Live responses
        </button>
        <button
          className={`view-subtab ${assessmentSubView === 'preview' ? 'active' : ''}`}
          onClick={() => setAssessmentSubView('preview')}
        >
          Preview
        </button>
        <button
          className={`view-subtab ${assessmentSubView === 'report' ? 'active' : ''}`}
          onClick={() => setAssessmentSubView('report')}
        >
          Report
        </button>
        </span>
        {/* Started = saved at least one answer, as of page load. */}
        <span className="assessment-subtabs-summary">
          {participants.filter(x => !x.deactivated_at).length} participants · {participants.filter(x => !x.deactivated_at && assessmentStarted.has(x.id)).length} started
        </span>
      </div>
      {assessmentSubView === 'responses' && (
        <AssessmentResponses
          sessionId={session?.id}
          assessmentId={session?.assessment_id}
          participants={participants}
          hands={hands}
        />
      )}
      {assessmentSubView === 'preview' && (
        <TrainerAssessmentPreview
          assessmentId={session?.assessment_id}
          paperOpen={!!session?.assessment_unlocked_at}
          closed={!!session?.closed_at}
        />
      )}
      {assessmentSubView === 'report' && (
        <AssessmentReport
          sessionId={session?.id}
          assessmentId={session?.assessment_id}
          participants={participants}
          session={session}
        />
      )}
    </div>
  );
}
