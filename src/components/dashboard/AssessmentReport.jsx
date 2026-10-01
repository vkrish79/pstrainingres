import { useMemo, useState } from 'react';
import { SkeletonTable } from '../Skeleton.jsx';
import { useSessionAssessmentResponses } from '../../hooks/useSessionAssessmentResponses.js';
import { useAssessmentMarks } from '../../hooks/useAssessmentMarks.js';
import { useSessionCriteria } from '../../hooks/useSessionCriteria.js';
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
// as blank ruled cells to be completed by hand, unless the trainer types them
// into the "Names for this printout" card (PrintNames, below). That is faithful to the source
// documents, which are forms with empty cells, and it beats inventing data or
// dropping rows the filing expects to see.
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
      passMark={passMark}
      loading={loading}
      error={error}
      notice={marksError}
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
export function AssessmentReportView({
  session, participants, sections, blocks, answers, answerKey, answerPoints, answerModes, marks, guidance = null,
  passMark, loading, error, notice, recorded = null, recordedNote = null, closed = false,
}) {
  const [scope, setScope] = useState('cohort'); // 'cohort' | 'individual'
  const [selectedId, setSelectedId] = useState('');
  // Real names, job titles and staff numbers, keyed by participant id. Held
  // here and NOWHERE else: no table, no browser storage. Participants are
  // enrolled under pseudonyms (trainee1, trainee2…) on purpose, and these
  // exist only to print. The Report subtab unmounts when the trainer leaves
  // it, which is what clears them.
  const [ids, setIds] = useState({});

  const cohort = useMemo(() => {
    if (recorded) {
      // Shaped like buildCohortReport's reports, so GroupReport reads both.
      const reports = recorded
        .map(r => ({
          participant: r.participant,
          score: { earned: r.earned, possible: r.possible, pct: r.pct, unmarked: r.unmarked },
          unmarked: Array.from({ length: r.unmarked || 0 }),
          errors: [],
        }))
        .sort((a, b) => byName(a.participant, b.participant));
      return { reports, commonErrors: [], totalUnmarked: reports.reduce((n, r) => n + r.unmarked.length, 0) };
    }
    return buildCohortReport({
      participants, sections, blocks, answers, answerKey, answerPoints, answerModes, marks, guidance,
    });
  }, [recorded, participants, sections, blocks, answers, answerKey, answerPoints, answerModes, marks, guidance]);

  if (loading) return <SkeletonTable rows={6} label="Loading assessment report…" />;
  if (error) return <div className="error" style={{ padding: '1rem' }}>{error}</div>;
  const marksError = notice;

  const chosen = cohort.reports.find(r => r.participant.id === selectedId) || cohort.reports[0] || null;
  const outstanding = scope === 'individual'
    ? (chosen?.unmarked.length || 0)
    : cohort.totalUnmarked;

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
              {cohort.reports.map(r => {
                const real = ids[r.participant.id]?.name?.trim();
                const app = r.participant.full_name || '(unnamed)';
                return (
                  <option key={r.participant.id} value={r.participant.id}>
                    {real ? `${real} (${app})` : app}
                  </option>
                );
              })}
            </select>
          )}
        </div>
        <div className="report-actions">
          <button type="button" className="primary" onClick={() => window.print()} disabled={cohort.reports.length === 0}>
            ↓ Print / Download PDF
          </button>
        </div>
      </div>

      {cohort.reports.length > 0 && (
        <PrintNames reports={cohort.reports} ids={ids} setIds={setIds} />
      )}

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
        <GroupReport session={session} cohort={cohort} passMark={passMark} ids={ids} />
      )}

      {scope === 'individual' && chosen && (
        <IndividualReport session={session} report={chosen} passMark={passMark} ids={ids} />
      )}
    </div>
  );
}

// ── L&D Training Report (GRP) ───────────────────────────────────────────────
function GroupReport({ session, cohort, passMark, ids }) {
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
            const real = ids[r.participant.id] || {};
            return (
              <tr key={r.participant.id}>
                <td className="col-sr">{i + 1}</td>
                <TypedCell className="col-staff" value={real.staff} />
                <td><PrintedName participant={r.participant} real={real} /></td>
                <TypedCell className="col-role" value={real.job} />
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
function IndividualReport({ session, report, passMark, ids }) {
  const verdict = resultOf(report.score, passMark, report.unmarked.length);
  const real = ids[report.participant.id] || {};

  return (
    <section className="report-page ld-report">
      <ReportTitle>L&amp;D Training Report</ReportTitle>

      <table className="ld-meta">
        <tbody>
          <tr>
            <th>Name &amp; Staff №</th><td><PrintedName participant={report.participant} real={real} /></td>
            <th className="narrow">№:</th><TypedCell value={real.staff} />
          </tr>
          <tr>
            <th>Job Title</th><TypedCell colSpan={3} value={real.job} />
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
                      {/* No per-question mark here on purpose. This is a list
                          of what went wrong, not a second mark sheet: the
                          score is already stated once, above. */}
                      {e.comment && <div className="ld-error-comment">{e.comment}</div>}
                      {/* Where a question was marked against a scorecard, the
                          reasons were written criterion by criterion. They are
                          gathered here as the question's one explanation, in
                          scorecard order rather than the order they were typed. */}
                      {e.criteria?.length > 0 && (
                        <ul className="ld-error-criteria">
                          {e.criteria.map(c => (
                            <li key={c.id} className={c.zero ? 'is-zero' : ''}>
                              {/* Criterion marks are left off for the same
                                  reason the question's own mark is: this is
                                  the explanation, not the arithmetic. */}
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

// ── Names for this printout ─────────────────────────────────────────────────

// The trainer types each participant's real details beside the pseudonym the
// app knows them by, and they appear on the sheet below and on paper only.
// Nothing here is saved; see the `ids` state in AssessmentReportView.
//
// PASTE IS THE MAIN ROUTE, NOT A NICETY. Because nothing is kept, the details
// are re-entered every time a report is reprinted. Pasting a block copied
// from the trainer's own spreadsheet (name, job title, staff № — one row per
// person, in trainee order) fills that row and the rows after it, so re-entry
// takes seconds. The sheet updates as they paste, each name beside its
// trainee number and score, which is how a row that slipped out of order gets
// noticed: nothing else can catch it, because the app does not know who
// anyone is.
//
// autoComplete="off" so the browser's own form memory does not quietly keep
// what the app refuses to.
const NAME_FIELDS = [
  { key: 'name', label: 'Actual name', placeholder: 'Full name' },
  { key: 'job', label: 'Job title', placeholder: 'Job title' },
  { key: 'staff', label: 'Staff ID', placeholder: 'Staff ID' },
];

// Spreadsheet copies are tab-separated cells, newline-separated rows.
function splitRows(text) {
  return text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(line => line.split('\t'));
}

function PrintNames({ reports, ids, setIds }) {
  const [pasted, setPasted] = useState(null);

  function setField(id, key, value) {
    setIds(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  }

  // A plain single value (no tab, no newline) is left to the input's normal
  // paste. A block fills from this cell rightwards and this row downwards.
  function onPaste(e, startIndex, startKey) {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text.replace(/[\r\n]+$/, ''))) return;
    e.preventDefault();
    const all = splitRows(text);
    const rows = all.slice(0, reports.length - startIndex);
    const firstCol = NAME_FIELDS.findIndex(f => f.key === startKey);
    setIds(prev => {
      const next = { ...prev };
      rows.forEach((cells, k) => {
        const id = reports[startIndex + k].participant.id;
        const row = { ...next[id] };
        cells.forEach((cell, c) => {
          const field = NAME_FIELDS[firstCol + c];
          if (field) row[field.key] = cell.trim();
        });
        next[id] = row;
      });
      return next;
    });
    setPasted({ count: rows.length, extra: all.length - rows.length });
  }

  const filled = reports.filter(r => ids[r.participant.id]?.name?.trim()).length;

  return (
    <section className="report-names no-print" aria-labelledby="report-names-title">
      <div className="report-names-head">
        <h3 id="report-names-title">Names for this printout</h3>
        <span className="report-names-lock">
          Not saved. Shown on this report only, and cleared when you leave the Report tab.
        </span>
      </div>
      <div className="report-names-scroll">
        <table className="report-names-table">
          <thead>
            <tr>
              <th>Name in the app</th>
              {NAME_FIELDS.map(f => <th key={f.key}>{f.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {reports.map((r, i) => {
              const id = r.participant.id;
              return (
                <tr key={id}>
                  <td className="report-names-app">{r.participant.full_name || '(unnamed)'}</td>
                  {NAME_FIELDS.map(f => (
                    <td key={f.key}>
                      <input
                        type="text"
                        className="form-input"
                        id={`print-${f.key}-${id}`}
                        aria-label={`${f.label} for ${r.participant.full_name || 'participant'}`}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={f.placeholder}
                        value={ids[id]?.[f.key] || ''}
                        onChange={e => setField(id, f.key, e.target.value)}
                        onPaste={e => onPaste(e, i, f.key)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="report-names-foot">
        <span className="muted">
          Paste from Excel: copy the name, job title and staff ID columns from your own sheet, in
          trainee order, and paste into the first Actual name box. {filled} of {reports.length} named;
          anyone left blank prints under their app name.
        </span>
        <button
          type="button"
          onClick={() => { setIds({}); setPasted(null); }}
          disabled={Object.keys(ids).length === 0}
        >
          Clear all
        </button>
      </div>
      {pasted && (
        <div className="report-names-pasted" role="status">
          Filled {pasted.count} row{pasted.count === 1 ? '' : 's'} from the paste.
          {pasted.extra > 0 && ` ${pasted.extra} more row${pasted.extra === 1 ? ' was' : 's were'} left over, so check your list is in the same order as the app names.`}
          {' '}Check each name against its trainee number on the sheet below before printing.
        </div>
      )}
    </section>
  );
}

// The typed real name, or the app's pseudonym when none was typed, so nobody
// drops off the sheet just because a row was left blank.
function PrintedName({ participant, real }) {
  const name = real?.name?.trim();
  if (name) return name;
  return <span className="ld-fallback-name">{participant.full_name || '(unnamed)'}</span>;
}

// A cell the source form leaves blank to complete by hand: the typed value
// when there is one, otherwise the ruled fill-in it always was.
function TypedCell({ value, className = '', ...rest }) {
  const v = value?.trim();
  const cls = `${className} ${v ? '' : 'fill-in'}`.trim();
  return <td className={cls || undefined} {...rest}>{v || null}</td>;
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

// Numeric-aware, so trainee2 sorts before trainee10. Paste fills rows in this
// order, so it has to be the order a trainer's own list is in.
function byName(a, b) {
  return (a.full_name || '').localeCompare(b.full_name || '', undefined, { numeric: true, sensitivity: 'base' });
}

function formatRange(a, b) {
  if (!a && !b) return '';
  const f = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  if (a && b && a !== b) return `${f(a)} – ${f(b)}`;
  return f(a || b);
}
