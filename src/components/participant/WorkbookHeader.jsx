import { sessionDay } from '../../lib/sessionPace.js';
import { whenStopped } from '../../lib/workbookResume.js';
import '../../styles/workbook-header.css';

const R = 16;
const CIRC = 2 * Math.PI * R;

// The top of a participant's workbook: how far through the whole book they are,
// which day of the course it is, and one button back to where they stopped.
export default function WorkbookHeader({ workbook, session, progress, resume, onContinue }) {
  const pct = progress.total ? Math.round((progress.filled / progress.total) * 100) : 0;
  const day = sessionDay(session?.starts_at, session?.ends_at);
  const trainer = session?.trainer?.full_name;
  const allDone = progress.total > 0 && !resume;

  const facts = [];
  if (day?.n) facts.push(`Day ${day.n} of ${day.total}`);
  else if (day?.before) facts.push(`Starts in ${day.inDays} day${day.inDays === 1 ? '' : 's'}`);
  else if (day?.after) facts.push('Course finished');
  if (trainer) facts.push(`Trainer ${trainer}`);

  return (
    <section className="wbh">
      <svg
        className="wbh-ring"
        viewBox="0 0 40 40"
        role="img"
        aria-label={`${pct}% of the workbook answered`}
      >
        <circle cx="20" cy="20" r={R} className="wbh-ring-track" />
        <circle
          cx="20" cy="20" r={R}
          className={`wbh-ring-fill${allDone ? ' is-done' : ''}`}
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - pct / 100)}
          transform="rotate(-90 20 20)"
        />
        <text x="20" y="23.3" textAnchor="middle" className="wbh-ring-text">{allDone ? '✓' : `${pct}%`}</text>
      </svg>

      <div className="wbh-text">
        <h1>
          {workbook.title}
          {session?.city_code && <span className="city-tag inline">{session.city_code}</span>}
        </h1>
        <p className="wbh-facts">
          {session?.name && <span>{session.name}</span>}
          {facts.map(f => <span key={f}>{f}</span>)}
          {progress.total > 0 && (
            <span className="wbh-count">{progress.filled} / {progress.total} answered</span>
          )}
        </p>
        {workbook.description && <p className="wbh-desc">{workbook.description}</p>}
      </div>

      {progress.total > 0 && (
        <div className="wbh-go no-print">
          {allDone ? (
            <span className="wbh-done">Every question answered</span>
          ) : (
            <>
              <button type="button" className="wbh-continue" onClick={onContinue}>
                {resume.started ? 'Continue' : 'Start'} · {resume.sectionTitle}
                {resume.questionCount > 1 && `, question ${resume.questionNo}`} →
              </button>
              {resume.started && resume.lastAt && (
                <span className="wbh-hint">you last saved an answer {whenStopped(resume.lastAt)}</span>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
