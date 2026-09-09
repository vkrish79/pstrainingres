import { useMemo, useState } from 'react';
import { useSessionAssessmentResponses } from '../../hooks/useSessionAssessmentResponses.js';
import { useAssessmentMarks } from '../../hooks/useAssessmentMarks.js';
import { useAssessmentPassMark, resultOf } from '../../hooks/useAssessmentPassMark.js';
import { buildCohortReport } from '../../lib/assessmentReport.js';
import '../../styles/report.css';

// The L&D Training Report, in the two shapes the business already uses:
// "L&D Training Report (GRP)" for a cohort and "(IND)" for one person. The
// table structure, field labels and footnote below are transcribed from those
// documents so a printed page drops into the existing filing unchanged.
//
// PRINTING, NOT PDF GENERATION. Same window.print() route as the participant
// workbook and closed-session views, so there is one rendering path and what
// is reviewed on screen is what comes out.
//
// WHAT THE TWO REPORTS DELIBERATELY DO NOT SHARE:
// the group report carries NO areas of error. A cohort sheet is a roster with
// scores on it, circulated more widely than any individual's paper, and
// listing what each named person got wrong on it would turn a summary into a
// disclosure. Individual reports keep the error detail.
//
// FIELDS THE SYSTEM DOES NOT HOLD -- Staff №, Role, Team, Assessment № -- print
// as blank ruled cells to be completed by hand. That is faithful to the source
// documents, which are forms with empty cells, and it beats inventing data or
// dropping rows the filing expects to see.
export default function AssessmentReport({ sessionId, assessmentId, participants, session }) {
  const {
    loading, error, sections, blocks, answers, answerKey, answerPoints, answerModes,
  } = useSessionAssessmentResponses(sessionId, assessmentId);
  const { marks, error: marksError } = useAssessmentMarks(sessionId);
  const { passMark } = useAssessmentPassMark(assessmentId);

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
  const outstanding = scope === 'individual'
    ? (chosen?.unmarked.length || 0)
    : cohort.totalUnmarked;

  return (
    <div className="assessment-report">
      {marksError && <div className="error no-print" style={{ padding: '0.5rem 1rem' }}>{marksError}</div>}

      <div className="report-controls no-print">
        <div className="report-scope">
          <label className={`report-scope-opt ${scope === 'cohort' ? 'active' : ''}`}>
            <input type="radio" name="report-scope" checked={scope === 'cohort'} onChange={() => setScope('cohort')} />
            Group (GRP)
            <span className="muted"> — {cohort.reports.length} participant{cohort.reports.length === 1 ? '' : 's'}, one file</span>
          </label>
          <label className={`report-scope-opt ${scope === 'individual' ? 'active' : ''}`}>
            <input type="radio" name="report-scope" checked={scope === 'individual'} onChange={() => setScope('individual')} />
            Individual (IND)
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
          <button type="button" className="primary" onClick={() => window.print()} disabled={cohort.reports.length === 0}>
            ↓ Print / Download PDF
          </button>
        </div>
      </div>

      {/* Kept from the previous report and deliberately not dropped in the
          redesign: a total that looks final while questions are unmarked is
          the one genuinely damaging thing this can print. The source template
          has no row for it, so it sits above the sheet rather than inside it. */}
      {outstanding > 0 && (
        <div className="report-warning">
          ✋ {outstanding} question{outstanding === 1 ? '' : 's'} still to mark by hand
          {scope === 'individual' ? ' for this participant' : ' across the cohort'}.
          Scores below are interim, and Result stays blank until marking is finished.
        </div>
      )}

      {passMark == null && (
        <div className="report-warning no-print">
          No pass mark is set for this assessment, so Result prints blank.
          Set one in the assessment editor.
        </div>
      )}

      {cohort.reports.length === 0 && (
        <p className="muted">No participants enrolled, so there is nothing to report on.</p>
      )}

      {scope === 'cohort' && cohort.reports.length > 0 && (
        <GroupReport session={session} cohort={cohort} passMark={passMark} />
      )}

      {scope === 'individual' && chosen && (
        <IndividualReport session={session} report={chosen} passMark={passMark} />
      )}
    </div>
  );
}

// ── L&D Training Report (GRP) ───────────────────────────────────────────────
function GroupReport({ session, cohort, passMark }) {
  // The source document rules 16 rows whether or not they are used, so the
  // sheet looks the same however many people sat the paper.
  const MIN_ROWS = 16;
  const rows = [...cohort.reports];
  const blanks = Math.max(0, MIN_ROWS - rows.length);

  return (
    <section className="report-page ld-report">
      <ReportTitle>L&amp;D Training Report</ReportTitle>

      <table className="ld-meta">
        <tbody>
          <tr>
            <th>Team &amp; Location</th><td className="fill-in" />
            <th className="narrow">City</th><td>{session?.city_code || <span className="fill-in-inline" />}</td>
          </tr>
          <tr>
            <th>Program Title</th><td colSpan={3}>{session?.program?.title || session?.name || ''}</td>
          </tr>
          <tr>
            <th>Dates &amp; Assessment №</th><td>{formatRange(session?.starts_at, session?.ends_at)}</td>
            <th className="narrow">№</th><td className="fill-in" />
          </tr>
          <tr>
            <th>Facilitator &amp; Staff №</th><td>{session?.trainer?.full_name || ''}</td>
            <th className="narrow">№</th><td className="fill-in" />
          </tr>
        </tbody>
      </table>

      <h3 className="ld-heading">Assessment Summary</h3>
      <table className="ld-table">
        <thead>
          <tr>
            <th className="col-sr">Sr</th>
            <th className="col-staff">Staff №</th>
            <th>Full Name</th>
            <th className="col-role">Role</th>
            <th className="col-score">Score (%)</th>
            <th className="col-result">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const verdict = resultOf(r.score, passMark, r.unmarked.length);
            return (
              <tr key={r.participant.id}>
                <td className="col-sr">{i + 1}</td>
                <td className="col-staff fill-in" />
                <td>{r.participant.full_name || '(unnamed)'}</td>
                <td className="col-role fill-in" />
                <td className="col-score">{r.score.pct == null ? '' : `${r.score.pct}%`}</td>
                <td className={`col-result ${verdict ? `result-${verdict.toLowerCase()}` : ''}`}>{verdict || ''}</td>
              </tr>
            );
          })}
          {/* Ruled but empty, so the printed sheet matches the source form. */}
          {Array.from({ length: blanks }, (_, i) => (
            <tr key={`blank-${i}`} className="ld-blank-row">
              <td className="col-sr">{rows.length + i + 1}</td>
              <td className="col-staff" /><td /><td className="col-role" />
              <td className="col-score" /><td className="col-result" />
            </tr>
          ))}
        </tbody>
      </table>

      <FacilitatorComments />
      <ReportFootnote />
    </section>
  );
}

// ── L&D Training Report (IND) ───────────────────────────────────────────────
function IndividualReport({ session, report, passMark }) {
  const verdict = resultOf(report.score, passMark, report.unmarked.length);

  return (
    <section className="report-page ld-report">
      <ReportTitle>L&amp;D Training Report</ReportTitle>

      <table className="ld-meta">
        <tbody>
          <tr>
            <th>Name &amp; Staff №</th><td>{report.participant.full_name || '(unnamed)'}</td>
            <th className="narrow">№:</th><td className="fill-in" />
          </tr>
          <tr>
            <th>Program Title &amp; Date</th>
            <td colSpan={3}>
              {session?.program?.title || session?.name || ''}
              {' — '}
              {formatRange(session?.starts_at, session?.ends_at)}
            </td>
          </tr>
          <tr>
            <th>Facilitator &amp; Staff №</th><td>{session?.trainer?.full_name || ''}</td>
            <th className="narrow">№:</th><td className="fill-in" />
          </tr>
          <tr>
            <th>Assessment Score</th>
            <td>
              {report.score.pct == null ? '' : `${report.score.pct}%`}
            </td>
            <th className="narrow">Result</th>
            <td className={verdict ? `result-${verdict.toLowerCase()}` : ''}>{verdict || ''}</td>
          </tr>
        </tbody>
      </table>

      <h3 className="ld-heading">Assessment Feedback</h3>
      <table className="ld-table ld-feedback">
        <tbody>
          <tr>
            <th className="ld-feedback-label">Areas of Error</th>
            <td>
              {report.errors.length === 0 ? (
                <p className="ld-clean">
                  No marks lost{report.unmarked.length > 0 ? ' on the questions marked so far' : ''}.
                </p>
              ) : (
                <ol className="ld-error-list">
                  {report.errors.map(e => (
                    <li key={e.blockId}>
                      {/* "Question – 01: (title)", the numbering the source
                          document uses. The question's own label is kept so it
                          matches the paper the participant sat. */}
                      <span className="ld-error-q">Question – {pad(e.label)}:</span>{' '}
                      <span className="ld-error-title">({e.title})</span>
                      <span className="ld-error-marks">{e.earned}/{e.possible}</span>
                      {e.comment && <div className="ld-error-comment">{e.comment}</div>}
                    </li>
                  ))}
                </ol>
              )}
              {report.unmarked.length > 0 && (
                <p className="ld-pending">
                  {report.unmarked.length} question{report.unmarked.length === 1 ? '' : 's'} still
                  to mark: {report.unmarked.map(u => u.label).join(', ')}.
                </p>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      <FacilitatorComments />
      <ReportFootnote />
    </section>
  );
}

// ── shared furniture ────────────────────────────────────────────────────────

function ReportTitle({ children }) {
  return <h2 className="ld-title">{children}</h2>;
}

// The source documents put the facilitator's written comments in a ruled box.
// Nothing in the system captures them yet, so it prints "No comments" rather
// than an empty box that reads as an oversight.
function FacilitatorComments() {
  return (
    <>
      <h3 className="ld-heading">
        Facilitator Comments<sup className="ld-footnote-ref">1</sup>
      </h3>
      <div className="ld-comments-box">No comments</div>
    </>
  );
}

function ReportFootnote() {
  return (
    <p className="ld-footnote">
      <sup>1</sup> Note: Ratings &amp; comments noted by the facilitator are based on the
      assessment, observation and interaction with staff while they are in the classroom
      for the duration of the training program.
    </p>
  );
}

// "3" -> "03", "3(b)" -> "03(b)". Matches the source document's two-digit
// question numbering without disturbing a part letter.
function pad(label) {
  const s = String(label ?? '');
  const m = s.match(/^(\d+)(.*)$/);
  return m ? m[1].padStart(2, '0') + m[2] : s;
}

function formatRange(a, b) {
  if (!a && !b) return '';
  const f = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  if (a && b && a !== b) return `${f(a)} – ${f(b)}`;
  return f(a || b);
}
