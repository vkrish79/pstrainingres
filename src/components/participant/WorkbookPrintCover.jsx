// The first page of the printed / downloaded workbook. Print-only: on screen
// the WorkbookHeader does this job, and in print it is hidden (its progress
// ring and "Continue" button mean nothing on paper).
//
// Says whose workbook this is — the one thing a PDF passed to a trainer or
// kept for later must answer — then the course facts, how far through it they
// are, and a contents list of the chapters (Word H1 groups).
//
// Printed edge to edge on its own named page (see `@page wbp-cover` in
// print.css): a compact midnight band carrying the logo and title, then the
// rest on white.

export default function WorkbookPrintCover({ workbook, session, participantName, progress, sections }) {
  const trainer = session?.trainer?.full_name;
  const dates = formatDateRange(session?.starts_at, session?.ends_at);
  const printed = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  // Chapters in order, each with the exercises beneath it up to the next one.
  // Exercises before the first chapter (a workbook with no H1s) sit in an
  // untitled bucket that only shows up in the count.
  const chapters = [];
  let current = null;
  for (const s of sections) {
    if (s.kind === 'group') { current = { id: s.id, title: s.title, n: 0 }; chapters.push(current); }
    else if (current) current.n += 1;
  }
  const exerciseCount = sections.filter(s => s.kind !== 'group').length;
  const pct = progress.total ? Math.round((progress.filled / progress.total) * 100) : 0;

  const facts = [
    ['Session', session?.name],
    ['Location', session?.city_code],
    ['Dates', dates],
    ['Trainer', trainer],
  ].filter(([, v]) => v);

  const stats = [
    [exerciseCount, exerciseCount === 1 ? 'Exercise' : 'Exercises'],
    chapters.length > 0 && [chapters.length, chapters.length === 1 ? 'Chapter' : 'Chapters'],
    progress.total > 0 && [`${pct}%`, `${progress.filled} of ${progress.total} answers filled in`],
  ].filter(Boolean);

  return (
    <div className="print-only wbp-cover">
      {/* logo-on-dark.png is logo.png with its white ground taken out (colour
          to alpha), so the gold sits straight on the midnight band. */}
      <header className="wbp-cover-band">
        <span className="wbp-cover-arc is-outer" aria-hidden="true" />
        <span className="wbp-cover-arc is-inner" aria-hidden="true" />
        <img className="wbp-cover-logo" src="/logo-on-dark.png" alt="Etihad Airways" />
        <div className="wbp-cover-heading">
          <h1 className="wbp-cover-title">{programName(workbook.title)}</h1>
          {workbook.description && <p className="wbp-cover-desc">{workbook.description}</p>}
        </div>
      </header>

      <div className="wbp-cover-body">
        {participantName && (
          <div className="wbp-cover-for">
            <span>Prepared for</span>
            <strong>{participantName}</strong>
          </div>
        )}

        {facts.length > 0 && (
          <dl className="wbp-cover-facts">
            {facts.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        )}

        <div className="wbp-cover-stats">
          {stats.map(([n, label]) => (
            <div key={label} className="wbp-cover-stat">
              <b>{n}</b>
              <span>{label}</span>
            </div>
          ))}
          {progress.total > 0 && (
            <div className="wbp-cover-meter" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
          )}
        </div>

        {chapters.length > 0 && (
          <div className="wbp-contents">
            <div className="wbp-contents-cap">Contents</div>
            <ol>
              {chapters.map(c => (
                <li key={c.id}>
                  <span className="wbp-contents-title">{c.title}</span>
                  {c.n > 0 && <span className="wbp-contents-n">{c.n} exercise{c.n === 1 ? '' : 's'}</span>}
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="wbp-cover-foot">
          <span>Printed {printed}</span>
        </div>
      </div>
    </div>
  );
}

// The running header and footer on every page after the cover: logo and
// workbook along the top, participant, session and page x of y along the
// bottom. @page rules cannot read the DOM, so the text is written into a
// stylesheet here; the look (rules, type) lives in print.css.
//
// Chrome 131+ draws margin boxes. With "Headers and footers" ticked (the print
// dialog's default) it still prints its own date / page title / URL / page
// number in any of those spots the page leaves empty — checked, not assumed —
// so the page fills both top and bottom. Older browsers print without them.
export function WorkbookPrintFooter({ workbook, session, participantName }) {
  const left = [participantName, session?.name].filter(Boolean).join('   ·   ');
  const css = `@media print {
  @page {
    @top-left { content: image-set(url("/logo.png") 4x); }
    @top-right { content: ${cssString(workbook?.title || '')}; }
    @bottom-left { content: ${cssString(left)}; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); }
  }
}`;
  return <style>{css}</style>;
}

// "ARD Web Certification – Workbook" → "ARD Web Certification". The cover
// names the programme; that the document is a workbook goes without saying.
// Only a trailing "Workbook" (and the dash or colon before it) goes, and a
// title that is nothing but "Workbook" is left alone.
function programName(title = '') {
  const name = title.replace(/\s*[-–—:|]?\s*workbook\s*$/i, '').trim();
  return name || title;
}

function cssString(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;
}

function formatDateRange(start, end) {
  const fmt = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  if (end) return `Until ${fmt(end)}`;
  return '';
}
