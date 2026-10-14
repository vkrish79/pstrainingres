import { sessionDay } from '../../lib/sessionPace.js';

// End-of-day pulse (A4), the trainer's side: a card in the cockpit rail.
// "Ask how today went" opens today's three questions in every workbook; the
// card then counts answers as they arrive and keeps one bar per asked day.
// Totals only: who said what is never sent to this screen.
//
//   pulse  — useDayPulse(sessionId) (trainer mode)
//   active — how many are still in the class (the "of N")
export default function DayPulseCockpit({ pulse, startsAt, endsAt, active }) {
  const day = sessionDay(startsAt, endsAt);
  const today = day && !day.before && !day.after ? day.n : null;
  const asked = pulse.days || [];
  const todayRow = asked.find(d => d.day_no === today);
  // Nothing to show outside the course days unless days were already asked.
  if (!today && asked.length === 0) return null;

  return (
    <section className="cockpit-card pulse-cockpit" aria-label="End of day">
      <div className="pulse-cockpit-head">
        <h3 className="cockpit-card-title">End of day</h3>
        {today && !todayRow && (
          <button type="button" className="ghost btn-sm" onClick={() => pulse.ask(today)}>Ask how today went</button>
        )}
      </div>
      {todayRow && (
        <p className="pulse-cockpit-now">
          <strong>Day {today}</strong> · {todayRow.answers} of {active} answered
          {todayRow.answers > 0 && <> · {Number(todayRow.avg_useful).toFixed(1)} useful</>}
          {todayRow.fast > 0 && <> · {todayRow.fast} said too fast</>}
          {todayRow.slow > 0 && <> · {todayRow.slow} said too slow</>}
        </p>
      )}
      {!todayRow && today && asked.length === 0 && (
        <p className="cockpit-empty">Three quick questions for everyone in the workbook: how useful, the pace, one word.</p>
      )}
      {asked.length > 0 && (
        <ul className="pulse-days" aria-label="Usefulness by day">
          {asked.map(d => {
            const avg = d.answers ? Number(d.avg_useful) : 0;
            const tone = !d.answers ? '' : avg >= 4 ? 'ok' : avg >= 3 ? 'mid' : 'poor';
            return (
              <li key={d.day_no}>
                <span className="pulse-day-n">Day {d.day_no}</span>
                <span className={`pulse-bar ${tone}`}><i style={{ width: `${(avg / 5) * 100}%` }} /></span>
                <span className="pulse-day-v">
                  {d.answers ? avg.toFixed(1) : '–'}
                  {d.fast > 0 && <> · {d.fast} too fast</>}
                  {d.slow > 0 && <> · {d.slow} too slow</>}
                </span>
                {Array.isArray(d.words) && d.words.length > 0 && (
                  <span className="pulse-words">{d.words.slice(0, 4).map(w => (w.n > 1 ? `${w.word} ×${w.n}` : w.word)).join(' · ')}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {pulse.error && <p className="error">{pulse.error}</p>}
    </section>
  );
}
