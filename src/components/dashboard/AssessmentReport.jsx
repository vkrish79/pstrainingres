import { useMemo, useState } from 'react';
import { SkeletonTable } from '../Skeleton.jsx';
import { useSessionAssessmentResponses } from '../../hooks/useSessionAssessmentResponses.js';
import { useAssessmentMarks } from '../../hooks/useAssessmentMarks.js';
import { useSessionCriteria } from '../../hooks/useSessionCriteria.js';
import { useSessionResits } from '../../hooks/useSessionResits.js';
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
//
// RE-SITS ARE PRINTED FROM HERE, the ORIGINAL session, and never from the
// paper-only session somebody sat the second time. That session has one person
// in it and no programme context; this sheet is the cohort's record, and a
// re-sitter belongs in it on their own row with both marks visible.
export default function AssessmentReport({ sessionId, assessmentId, participants, session }) {
  const {
    loading, error, sections, blocks, answers, answerKey, answerPoints, answerModes,
  } = useSessionAssessmentResponses(sessionId, assessmentId);
  const { marks, error: marksError } = useAssessmentMarks(sessionId);
  const { passMark } = useAssessmentPassMark(assessmentId);
  // Same source as the marking screen, so the report cannot reach a different
  // verdict from the one the trainer just gave — including which questions are
  // still only part-marked and therefore not scored at all.
  const { guidance, points: criteriaPoints } = useSessionCriteria(sessionId);
  // Second sittings, found through the re-sit sessions that point back here.
  // A session nobody has re-sat returns an empty map and nothing below changes.
  const { resitsByPriorParticipant, error: resitError } = useSessionResits(sessionId);

  if (!assessmentId) {
    return <div className="muted" style={{ padding: '1rem' }}>This session has no attached assessment.</div>;
  }
  return (
    <AssessmentReportView
      session={session}
      participants={participants}
      sections={sections}
      blocks={blocks}
      answers={answers}
      answerKey={answerKey}
      answerPoints={{ ...answerPoints, ...criteriaPoints }}
      answerModes={answerModes}
      guidance={guidance}
      marks={marks}
      resits={resitsByPriorParticipant}
      passMark={passMark}
      loading={loading}
      error={error}
      notice={marksError || resitError}
    />
  );
}

// The report itself, from data rather than from the database. The live Report
// tab feeds it from the session's tables; a CLOSED session feeds it from the
// saved summary (ClosedAssessmentReport). One component, so a report printed
// after close is laid out and scored exactly like one printed before it.
//
// `recorded` — scores saved at close, used when the answers themselves are
// gone (a session slimmed by the retention job). The group sheet needs only
// scores, so it still prints; the individual sheet, which lists areas of
// error, is not offered because there is nothing left to list.
//
// `resits` — optional, and absent on every closed-session path. See the note
// on the recorded branch below for why that is the honest default rather than
// an oversight.
export function AssessmentReportView({
  session, participants, sections, blocks, answers, answerKey, answerPoints, answerModes, marks, guidance = null,
  resits = null, passMark, loading, error, notice, recorded = null, recordedNote = null, closed = false,
}) {
  const [scope, setScope] = useState('cohort'); // 'cohort' | 'individual'
  const [selectedId, setSelectedId] = useState('');

  const cohort = useMemo(() => {
    if (recorded) {
      // Shaped like buildCohortReport's reports, so GroupReport reads both.
      //
      // `record` is the sitting itself and `resit` is null on purpose. These
      // are the figures frozen at close, already the result of record at that
      // moment; there is nothing left to supersede them with, and no re-sit
      // information survives in the summary to look one up by.
      const reports = recorded
        .map(r => {
          const score = { earned: r.earned, possible: r.possible, pct: r.pct, unmarked: r.unmarked };
          return {
            participant: r.participant,
            score,
            record: { ...score, source: 'first' },
            verdict: resultOf(score, passMark, r.unmarked || 0),
            resit: null,
            resitDue: false,
            unmarked: Array.from({ length: r.unmarked || 0 }),
            errors: [],
          };
        })
        .sort((a, b) => (a.participant.full_name || '').localeCompare(b.participant.full_name || ''));
      return {
        reports, commonErrors: [], resatCount: 0, resitDueCount: 0,
        totalUnmarked: reports.reduce((n, r) => n + r.unmarked.length, 0),
      };
    }
    return buildCohortReport({
      participants, sections, blocks, answers, answerKey, answerPoints, answerModes, marks, guidance,
      resits, passMark,
    });
  }, [recorded, participants, sections, blocks, answers, answerKey, answerPoints, answerModes, marks,
    guidance, resits, passMark]);

  if (loading) return <SkeletonTable rows={6} label="Loading assessment report…" />;
  if (error) return <div className="error" style={{ padding: '1rem' }}>{error}</div>;
  const marksError = notice;

  const chosen = cohort.reports.find(r => r.participant.id === selectedId) || cohort.reports[0] || null;
  const outstanding = scope === 'individual'
    ? (chosen?.unmarked.length || 0)
    : cohort.totalUnmarked;

  // Re-sits arranged but not yet sat, or sat but not yet marked. Called out
  // because until one of them IS marked the sheet keeps printing the first
  // attempt, and a reader who knows a re-sit happened needs telling why the
  // old mark is still there.
  const pendingResits = cohort.reports.filter(r => r.resit && !r.resit.marked);

  return (
    <div className="assessment-report">
      {marksError && <div className="error no-print" style={{ padding: '0.5rem 1rem' }}>{marksError}</div>}
      {recordedNote && <div className="report-warning no-print">{recordedNote}</div>}

      <div className="report-controls no-print">
        <div className="report-scope">
          <label className={`report-scope-opt ${scope === 'cohort' ? 'active' : ''}`}>
            <input type="radio" name="report-scope" checked={scope === 'cohort'} onChange={() => setScope('cohort')} />
            Group (GRP)
            <span className="muted"> — {cohort.reports.length} participant{cohort.reports.length === 1 ? '' : 's'}, one file</span>
          </label>
          {!recorded && (
            <label className={`report-scope-opt ${scope === 'individual' ? 'active' : ''}`}>
              <input type="radio" name="report-scope" checked={scope === 'individual'} onChange={() => setScope('individual')} />
              Individual (IND)
            </label>
          )}
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
          {closed ? (
            <>
              ✋ {outstanding} question{outstanding === 1 ? ' was' : 's were'} left unmarked when the session closed
              {scope === 'individual' ? ' for this participant' : ' across the cohort'}.
              Those scores are incomplete, and Result is blank for them.
            </>
          ) : (
            <>
              ✋ {outstanding} question{outstanding === 1 ? '' : 's'} still to mark by hand
              {scope === 'individual' ? ' for this participant' : ' across the cohort'}.
              Scores below are interim, and Result stays blank until marking is finished.
            </>
          )}
        </div>
      )}

      {pendingResits.length > 0 && (
        <div className="report-warning no-print">
          ↻ {pendingResits.length === 1 ? 'A re-sit has' : `${pendingResits.length} re-sits have`} been
          arranged but {pendingResits.length === 1 ? 'has' : 'have'} no result yet
          ({pendingResits.map(r => r.participant.full_name || '(unnamed)').join(', ')}).
          The first attempt is still the result of record and is what prints below — a paper nobody
          has marked is not a score of nought.
        </div>
      )}

      {passMark == null && (
        <div className="report-warning no-print">
          {closed
            ? 'No pass mark was set when this session closed, so Result prints blank.'
            : 'No pass mark is set for this assessment, so Result prints blank. Set one in the assessment editor.'}
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
            // The verdict comes off the row, where it was reached from the
            // result of record. Computing it again here from r.score would
            // quietly judge a re-sitter on the paper they already failed.
            const verdict = r.verdict;
            const superseded = !!r.resit && r.resit.marked;
            return (
              <tr key={r.participant.id} className={r.resit ? 'ld-row-resit' : undefined}>
                <td className="col-sr">{i + 1}</td>
                <td className="col-staff fill-in" />
                <td>
                  {r.participant.full_name || '(unnamed)'}
                  {r.resit && <ResitNote resit={r.resit} />}
                </td>
                <td className="col-role fill-in" />
                <td className="col-score">
                  {superseded ? (
                    <span className="score-pair">
                      {/* The first attempt is kept visible and struck through
                          rather than dropped. It is a real sitting that really
                          happened, and a sheet that simply showed the better
                          number would be a sheet nobody could audit. */}
                      <span className="score-first">{pct(r.score.pct)}</span>
                      <span className="score-record">{pct(r.record.pct)}</span>
                    </span>
                  ) : pct(r.record.pct)}
                </td>
                <td className={`col-result ${verdict ? `result-${verdict.toLowerCase()}` : ''}`}>
                  {verdict || ''}
                  {r.resit && <span className="report-chip chip-resit">re-sit</span>}
                  {r.resitDue && <span className="report-chip chip-due">re-sit due</span>}
                </td>
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

      {(cohort.resatCount > 0 || cohort.resitDueCount > 0) && (
        <p className="ld-resit-legend">
          {/* Described rather than illustrated. A legend with specimen
              percentages in it would be inventing figures on a document that
              goes into somebody's file. */}
          {cohort.resatCount > 0 && (
            <>
              A struck-through score is a first sitting that has been superseded; the bold figure
              beside it is the result of record, and is the one every total on this sheet counts.
            </>
          )}
          {cohort.resitDueCount > 0 && (
            <>
              {cohort.resatCount > 0 && ' '}
              <span className="report-chip chip-due">re-sit due</span>
              {' '}below the pass mark with no second sitting arranged.
            </>
          )}
        </p>
      )}

      <FacilitatorComments />
      <ReportFootnote />
    </section>
  );
}

// Which second sitting this is, under the name. Three states, because
// "arranged", "sat" and "marked" are three different things to a reader
// wondering why the old mark is still printing.
function ResitNote({ resit }) {
  const when = resit.resitStartsAt ? formatRange(resit.resitStartsAt, null) : '';
  const code = resit.resitJoinCode ? ` · ${resit.resitJoinCode}` : '';
  const text = resit.marked
    ? `re-sat ${when}${code}`
    : resit.sat
      ? `re-sat ${when}${code} — not marked yet`
      : `re-sit arranged ${when}${code} — not sat yet`;
  return <small className="ld-resit-note">{text}</small>;
}

// ── L&D Training Report (IND) ───────────────────────────────────────────────
function IndividualReport({ session, report, passMark }) {
  const verdict = report.verdict;
  const superseded = !!report.resit && report.resit.marked;

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
              {superseded ? (
                <span className="score-pair">
                  <span className="score-first">{pct(report.score.pct)}</span>
                  <span className="score-record">{pct(report.record.pct)}</span>
                </span>
              ) : pct(report.record.pct)}
            </td>
            <th className="narrow">Result</th>
            <td className={verdict ? `result-${verdict.toLowerCase()}` : ''}>
              {verdict || ''}
              {report.resit && <span className="report-chip chip-resit">re-sit</span>}
              {report.resitDue && <span className="report-chip chip-due">re-sit due</span>}
            </td>
          </tr>
        </tbody>
      </table>

      {superseded && (
        <p className="ld-resit-lead">
          Sat again on {formatRange(report.resit.resitStartsAt, null)}
          {report.resit.resitJoinCode ? ` (${report.resit.resitJoinCode})` : ''}.
          The feedback below is from that second paper, which is the result of record;
          the first sitting scored {pct(report.score.pct)} and is shown struck through above.
        </p>
      )}

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
                      {/* How this question relates to the one first sat. Only
                          present when a re-sit is the result of record, and
                          the reason the two papers can be compared at all. */}
                      {e.pairing === 'amended' && (
                        <span className="q-flag flag-amended" data-tip="Same question, with a value changed for the re-sit">amended</span>
                      )}
                      {e.pairing === 'replaced' && (
                        <span className="q-flag flag-replaced" data-tip="A different question, drawn from the bank — there is nothing to compare it with">replaced</span>
                      )}
                      {e.first && (
                        <span className="q-first" data-tip="What this question scored at the first sitting">
                          first sitting {e.first.earned}/{e.first.possible}
                        </span>
                      )}
                      {e.comment && <div className="ld-error-comment">{e.comment}</div>}
                      {/* Where a question was marked against a scorecard, the
                          reasons were written criterion by criterion. They are
                          gathered here as the question's one explanation, in
                          scorecard order rather than the order they were typed. */}
                      {e.criteria?.length > 0 && (
                        <ul className="ld-error-criteria">
                          {e.criteria.map(c => (
                            <li key={c.id} className={c.zero ? 'is-zero' : ''}>
                              <span className="ld-crit-marks">{c.awarded}/{c.marks}</span>
                              <span className="ld-crit-what">
                                <strong>{c.label || 'Criterion'}</strong>
                                {c.comment ? ` — ${c.comment}` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
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

// The masthead both reports share, so the logo sits in exactly one place
// rather than being pasted into the cohort sheet and the individual one.
//
// Served from public/ rather than imported: an import would be inlined or
// hashed into the bundle, and this file is also the one a trainer replaces
// when the branding changes — dropping a new public/logo.png should be the
// whole job, with no rebuild.
//
// alt is EMPTY on purpose. The organisation's name is already the first
// thing under it, and a screen reader announcing it twice is worse than not
// announcing the picture at all.
function ReportTitle({ children }) {
  return (
    <header className="ld-masthead">
      {/* Hidden rather than left broken: a missing-image icon at the top of
          a report about to be printed and filed is worse than no logo. */}
      <img
        className="ld-logo"
        src="/logo.png"
        alt=""
        onError={e => { e.currentTarget.style.display = 'none'; }}
      />
      <h2 className="ld-title">{children}</h2>
    </header>
  );
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

// A percentage, or nothing at all. Never "0%" standing in for "not known" —
// that is the whole distinction a re-sit with no result depends on.
function pct(v) {
  return v == null ? '' : `${v}%`;
}

function formatRange(a, b) {
  if (!a && !b) return '';
  const f = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  if (a && b && a !== b) return `${f(a)} – ${f(b)}`;
  return f(a || b);
}
