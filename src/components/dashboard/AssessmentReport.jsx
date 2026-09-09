import { useMemo, useState } from 'react';
import { useSessionAssessmentResponses } from '../../hooks/useSessionAssessmentResponses.js';
import { useAssessmentMarks } from '../../hooks/useAssessmentMarks.js';
import { buildCohortReport } from '../../lib/assessmentReport.js';
import '../../styles/report.css';

// The printable outcome of a marked assessment: who sat it, how they did, and
// exactly where they went wrong — with the trainer's own comment against each
// question they lost marks on.
//
// PRINTING, NOT PDF GENERATION. This is the same window.print() route the
// participant workbook and the closed-session view already use ("Print /
// Download PDF"), and the browser's own print dialogue is what writes the PDF.
// No PDF library, one rendering path, and what you see on screen is what comes
// out — see print.css for the print rules.
//
// TWO SCOPES, ONE DOCUMENT AT A TIME. One print call produces one file, so
// "individual report for every staff" is a picker plus a print rather than a
// button that emits N files at once: choose a person, print, repeat. The
// cohort scope prints everybody as one document with each participant starting
// on a fresh page.
export default function AssessmentReport({ sessionId, assessmentId, participants, session }) {
  const {
    loading, error, sections, blocks, answers, answerKey, answerPoints, answerModes,
  } = useSessionAssessmentResponses(sessionId, assessmentId);
  const { marks, error: marksError } = useAssessmentMarks(sessionId);

  const [scope, setScope] = useState('cohort'); // 'cohort' | 'individual'
  const [selectedId, setSelectedId] = useState('');

  const cohort = useMemo(() => buildCohortReport({
    participants, sections, blocks, answers, answerKey, answerPoints, answerModes, marks,
  }), [participants, sections, blocks, answers, answerKey, answerPoints, answerModes, marks]);

  if (!assessmentId) {
    return <div className="muted" style={{ padding: '1rem' }}>This session has no attached assessment.</div>;
  }
  if (loading) return <div className="loading">Loading assessment report…</div>;
  if (error) return <div className="error" style={{ padding: '1rem' }}>{error}</div>;

  const chosen = cohort.reports.find(r => r.participant.id === selectedId) || cohort.reports[0] || null;
  const shown = scope === 'individual' && chosen ? [chosen] : cohort.reports;

  // The banner has to describe what is actually being printed: in individual
  // scope the cohort's outstanding count would be alarming and irrelevant.
  const outstanding = scope === 'individual'
    ? (chosen?.unmarked.length || 0)
    : cohort.totalUnmarked;

  const printedOn = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="assessment-report">
      {marksError && <div className="error no-print" style={{ padding: '0.5rem 1rem' }}>{marksError}</div>}

      <div className="report-controls no-print">
        <div className="report-scope">
          <label className={`report-scope-opt ${scope === 'cohort' ? 'active' : ''}`}>
            <input
              type="radio"
              name="report-scope"
              checked={scope === 'cohort'}
              onChange={() => setScope('cohort')}
            />
            Whole cohort
            <span className="muted"> — {cohort.reports.length} participant{cohort.reports.length === 1 ? '' : 's'}, one file</span>
          </label>
          <label className={`report-scope-opt ${scope === 'individual' ? 'active' : ''}`}>
            <input
              type="radio"
              name="report-scope"
              checked={scope === 'individual'}
              onChange={() => setScope('individual')}
            />
            Individual
          </label>
          {scope === 'individual' && (
            <select
              className="form-input report-picker"
              value={chosen?.participant.id || ''}
              onChange={e => setSelectedId(e.target.value)}
            >
              {cohort.reports.map(r => (
                <option key={r.participant.id} value={r.participant.id}>
                  {r.participant.full_name || '(unnamed)'}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="report-actions">
          <button
            type="button"
            className="primary"
            onClick={() => window.print()}
            disabled={shown.length === 0}
          >
            ↓ Print / Download PDF
          </button>
        </div>
      </div>

      {/* Marking still outstanding is stated, never hidden, and never blocks
          the print. A trainer may legitimately want an interim report — what
          they must not do is hand someone a total that looks final when three
          questions have not been judged yet. */}
      {outstanding > 0 && (
        <div className="report-warning">
          ✋ {outstanding} question{outstanding === 1 ? '' : 's'} still to mark by hand
          {scope === 'individual' ? ' for this participant' : ' across the cohort'}.
          Totals below are interim until they are marked.
        </div>
      )}

      {cohort.reports.length === 0 && (
        <p className="muted">No participants enrolled, so there is nothing to report on.</p>
      )}

      {scope === 'cohort' && cohort.reports.length > 0 && (
        <section className="report-page report-summary">
          <ReportHeader session={session} printedOn={printedOn} title="Assessment report — cohort summary" />
          <div className="report-stat-strip">
            <div className="report-stat"><b>{cohort.reports.length}</b><span>Participants</span></div>
            <div className="report-stat"><b>{cohort.questionCount}</b><span>Questions</span></div>
            <div className="report-stat"><b>{cohort.avgPct == null ? '—' : `${cohort.avgPct}%`}</b><span>Average score</span></div>
            <div className="report-stat"><b>{cohort.totalUnmarked}</b><span>Still to mark</span></div>
          </div>

          <h3>Results</h3>
          <table className="report-table">
            <thead>
              <tr><th>Name</th><th>Username</th><th className="num">Score</th><th className="num">%</th><th className="num">Errors</th></tr>
            </thead>
            <tbody>
              {cohort.reports.map(r => (
                <tr key={r.participant.id}>
                  <td>{r.participant.full_name || '(unnamed)'}</td>
                  <td className="mono">{r.username || '—'}</td>
                  <td className="num">{r.score.earned}/{r.score.possible}</td>
                  <td className="num">{r.score.pct == null ? '—' : `${r.score.pct}%`}</td>
                  <td className="num">{r.errors.length}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Ordered by how many people got it wrong, not by question number:
              this table exists to decide what to go over in the debrief. */}
          {cohort.commonErrors.length > 0 && (
            <>
              <h3>Most-missed questions</h3>
              <table className="report-table">
                <thead>
                  <tr><th>Q</th><th>Question</th><th className="num">Got it wrong</th></tr>
                </thead>
                <tbody>
                  {cohort.commonErrors.map(e => (
                    <tr key={e.blockId}>
                      <td className="mono">{e.label}</td>
                      <td>{e.title}</td>
                      <td className="num">{e.count} of {cohort.reports.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      {shown.map(r => (
        <section className="report-page" key={r.participant.id}>
          <ReportHeader session={session} printedOn={printedOn} title="Assessment report" />

          <div className="report-participant">
            <dl>
              <dt>Name</dt><dd>{r.participant.full_name || '(unnamed)'}</dd>
              <dt>Username</dt><dd className="mono">{r.username || '—'}</dd>
              <dt>Result</dt>
              <dd>
                <b>{r.score.earned} of {r.score.possible} marks</b>
                {r.score.pct != null && <> · {r.score.pct}%</>}
                {r.unmarked.length > 0 && <span className="report-interim"> (interim — {r.unmarked.length} still to mark)</span>}
              </dd>
            </dl>
          </div>

          <h3>Areas of error</h3>
          {r.errors.length === 0 ? (
            <p className="report-clean">No marks lost{r.unmarked.length > 0 ? ' on the questions marked so far' : ''}.</p>
          ) : (
            <table className="report-table report-errors">
              <thead>
                <tr><th>Q</th><th>Question</th><th className="num">Marks</th><th>Comment</th></tr>
              </thead>
              <tbody>
                {r.errors.map(e => (
                  <tr key={e.blockId}>
                    <td className="mono">{e.label}</td>
                    <td>
                      {e.title}
                      {e.answerText && <div className="report-answer">Answered: {e.answerText}</div>}
                    </td>
                    <td className="num">{e.earned}/{e.possible}</td>
                    <td>
                      {e.comment
                        ? <span className="report-comment">{e.comment}</span>
                        : <span className="muted">{e.manual ? '—' : 'Auto-marked'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {r.unmarked.length > 0 && (
            <>
              <h3>Still to mark</h3>
              <table className="report-table">
                <thead><tr><th>Q</th><th>Question</th><th className="num">Worth</th></tr></thead>
                <tbody>
                  {r.unmarked.map(u => (
                    <tr key={u.blockId}>
                      <td className="mono">{u.label}</td>
                      <td>{u.title}</td>
                      <td className="num">{u.possible}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      ))}
    </div>
  );
}

function ReportHeader({ session, printedOn, title }) {
  return (
    <header className="report-header">
      <h2>{title}</h2>
      <dl>
        <dt>Session</dt><dd>{session?.name || '—'}</dd>
        {session?.program?.title && <><dt>Programme</dt><dd>{session.program.title}</dd></>}
        <dt>Dates</dt><dd>{formatRange(session?.starts_at, session?.ends_at)}</dd>
        {session?.trainer?.full_name && <><dt>Trainer</dt><dd>{session.trainer.full_name}</dd></>}
        {session?.city_code && <><dt>Location</dt><dd>{session.city_code}</dd></>}
        <dt>Printed</dt><dd>{printedOn}</dd>
      </dl>
    </header>
  );
}

function formatRange(a, b) {
  if (!a && !b) return '—';
  const f = d => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (a && b && a !== b) return `${f(a)} – ${f(b)}`;
  return f(a || b);
}
