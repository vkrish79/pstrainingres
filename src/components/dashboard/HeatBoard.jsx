import { useMemo } from 'react';
import { isFillableBlock, expectedInputs, filledInputs } from '../../lib/blockHelpers.js';
import { LEVEL_BY_ID } from '../../hooks/useExerciseConfidence.js';

// The heat board: every participant against every exercise, each cell shaded
// by how much of that exercise they have filled in.
//
// It answers the two questions a table of totals cannot: WHICH exercise is the
// class stuck on (a column that stays pale), and who is stuck where (a pale
// cell in an otherwise gold row). The outlined cell is where that person is
// right now, from the same cursor the table's "On now" column reads.
//
// Counts are INPUTS, not blocks — the same unit the roster's "39 / 338" uses —
// so a row here always adds up to the number in the table.
//
// "How did that exercise go?" (engagement rec 1) rides on the same grid: a
// coloured corner on each person's cell, a "How it went" row of counts under
// the class average, and a line above the board for any exercise where half or
// more of those who answered said lost or not sure. The design drew exercises
// as rows; here they are columns, so the counts are a row instead.
//   confidence — { byParticipant: { pid: { sectionId: row } }, byExercise } or null

// A heading short enough for a narrow column. "Exercise 12" says nothing the
// number does not, and a workbook with thirty of them was a board 2,350px wide.
// Anything else keeps its words (truncated by CSS, full title on hover).
function shortTitle(title) {
  const m = /^\s*(?:exercise|ex\.?|activity|task|section)\s*(\d+)\s*$/i.exec(title || '');
  return m ? m[1] : title;
}

// A cell's fill: pale sand at nothing, the app's gold at all of it.
function shade(frac) {
  if (frac <= 0) return 'var(--heat-0)';
  return `color-mix(in srgb, var(--gold) ${Math.round(18 + frac * 82)}%, var(--heat-base))`;
}

export default function HeatBoard({
  sections, blocks, participants, answers, cursors, isOnline, presenceStateFor,
  selectedId, onPickParticipant, onOpenCell, hands = {}, confidence = null,
}) {
  const columns = useMemo(() => sections
    .map(sec => {
      const sBlocks = blocks.filter(b => b.section_id === sec.id && isFillableBlock(b));
      return { sec, sBlocks, inputs: sBlocks.reduce((n, b) => n + expectedInputs(b), 0) };
    })
    .filter(c => c.inputs > 0), [sections, blocks]);

  const rows = useMemo(() => participants.map(p => {
    const ans = answers[p.id] || {};
    let answered = 0; let total = 0;
    const cells = columns.map(c => {
      let filled = 0;
      for (const b of c.sBlocks) filled += filledInputs(b, ans[b.id]?.value);
      answered += filled; total += c.inputs;
      return { filled, frac: c.inputs ? filled / c.inputs : 0 };
    });
    return { p, cells, answered, total };
  }), [participants, answers, columns]);

  // Class average per exercise, dropouts left out as everywhere else.
  const averages = useMemo(() => {
    const active = rows.filter(r => !r.p.deactivated_at);
    return columns.map((_, i) => (active.length
      ? active.reduce((a, r) => a + r.cells[i].frac, 0) / active.length
      : 0));
  }, [rows, columns]);

  // The slowest exercise the class has actually reached: lowest average among
  // those started but not finished. An exercise nobody has opened yet is not
  // "slow", it is simply next.
  const slowest = useMemo(() => {
    let best = -1;
    averages.forEach((a, i) => {
      if (a > 0 && a < 1 && (best < 0 || a < averages[best])) best = i;
    });
    return best;
  }, [averages]);

  const confBy = confidence?.byParticipant || {};
  const confEx = confidence?.byExercise || {};
  const hasConf = columns.some(c => confEx[c.sec.id]?.total > 0);
  const recaps = columns.filter(c => confEx[c.sec.id]?.recap);

  if (columns.length === 0) return <p className="muted">No exercises to fill in this workbook.</p>;

  const pct = f => `${Math.round(f * 100)}%`;

  return (
    <div className="heat-board">
      {recaps.length > 0 && (
        <ul className="heat-recaps" aria-label="Exercises worth a recap">
          {recaps.map(c => {
            const e = confEx[c.sec.id];
            return (
              <li key={c.sec.id}>
                <span className="heat-recap-flag" aria-hidden="true">⚑</span>
                <span><strong>{c.sec.title}</strong>: {e.unsureOrLost} of {e.total} not sure or lost. Worth a recap.</span>
                {e.notesList.length > 0 && (
                  <span className="heat-recap-notes">
                    Tripped on: {e.notesList.slice(0, 3).map(n => `“${n.text}”${n.n > 1 ? ` ×${n.n}` : ''}`).join(' · ')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="heat-scroll">
        <table className="heat-table">
          <thead>
            <tr>
              <th className="heat-name-h" scope="col">Participant</th>
              {columns.map((c, i) => (
                <th
                  key={c.sec.id}
                  scope="col"
                  className={i === slowest ? 'is-slowest' : ''}
                  title={`${c.sec.title} — ${c.inputs} to fill${i === slowest ? ' · slowest for the class right now' : ''}. Click to read everyone's answers.`}
                >
                  <button type="button" className="heat-col" onClick={() => onOpenCell(c.sec.id, null)}>
                    <span className="heat-col-title">{shortTitle(c.sec.title)}</span>
                    <span className="heat-col-n">{c.inputs}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, cells, answered, total }) => {
              const dropped = !!p.deactivated_at;
              const here = !dropped && isOnline(p.id) ? cursors[p.id]?.section_id : null;
              const state = dropped ? 'offline' : presenceStateFor(p.id);
              return (
                <tr key={p.id} className={`${dropped ? 'is-dropped' : ''}${p.id === selectedId ? ' is-selected' : ''}`}>
                  <th scope="row" className="heat-name">
                    <button type="button" className="heat-person" onClick={() => onPickParticipant(p.id)} title={`Open ${p.full_name || 'this person'}'s answers`}>
                      <span className={`presence-dot ${state}`} aria-hidden="true" />
                      <span className="heat-person-name">{!dropped && hands[p.id] && <span aria-label="Asked for help">✋ </span>}{p.full_name || '(unnamed)'}</span>
                      <span className="heat-person-n">{answered}/{total}</span>
                    </button>
                  </th>
                  {cells.map((cell, i) => {
                    const c = columns[i];
                    const isHere = here === c.sec.id;
                    const said = confBy[p.id]?.[c.sec.id];
                    const saidText = said ? ` · said ${LEVEL_BY_ID[said.level]?.label || said.level}${said.note ? ` — “${said.note}”` : ''}` : '';
                    return (
                      <td key={c.sec.id}>
                        <button
                          type="button"
                          className={`heat-cell${isHere ? ' is-here' : ''}`}
                          style={{ background: shade(cell.frac) }}
                          onClick={() => onOpenCell(c.sec.id, p.id)}
                          aria-label={`${p.full_name || 'Participant'}, ${c.sec.title}: ${cell.filled} of ${c.inputs}${isHere ? ', here now' : ''}${saidText}`}
                          title={`${p.full_name || 'Participant'} · ${c.sec.title}: ${cell.filled} of ${c.inputs}${isHere ? ' · here now' : ''}${saidText}`}
                        >
                          {cell.frac >= 1 ? '✓' : cell.frac > 0 ? pct(cell.frac) : ''}
                          {said && <span className={`heat-conf is-${said.level}`} aria-hidden="true" />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="heat-name heat-avg-label">Class average</th>
              {averages.map((a, i) => (
                <td key={columns[i].sec.id} className={`heat-avg${i === slowest ? ' is-slowest' : ''}`}>
                  {a > 0 ? pct(a) : '–'}
                </td>
              ))}
            </tr>
            {hasConf && (
              <tr className="heat-conf-row">
                <th scope="row" className="heat-name heat-avg-label">How it went</th>
                {columns.map(c => {
                  const e = confEx[c.sec.id];
                  return (
                    <td
                      key={c.sec.id}
                      className={`heat-conf-counts${e?.recap ? ' is-recap' : ''}`}
                      title={e ? `${c.sec.title}: ${e.got} got it · ${e.unsure} not sure · ${e.lost} lost` : `${c.sec.title}: nobody has said yet`}
                    >
                      {e ? (
                        <>
                          {e.lost > 0 && <span className="is-lost">{e.lost}</span>}
                          {e.unsure > 0 && <span className="is-unsure">{e.unsure}</span>}
                          {e.got > 0 && <span className="is-got">{e.got}</span>}
                        </>
                      ) : '–'}
                    </td>
                  );
                })}
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      <div className="heat-legend" aria-hidden="true">
        <span>Filled in:</span>
        <span><i style={{ background: 'var(--heat-0)' }} />none</span>
        <span><i style={{ background: shade(0.5) }} />half</span>
        <span><i style={{ background: 'var(--gold)' }} />all</span>
        <span><i className="is-here-swatch" />where they are now</span>
        {hasConf && (
          <span className="heat-legend-conf">How it went: <b className="is-lost" /> lost <b className="is-unsure" /> not sure <b className="is-got" /> got it</span>
        )}
        {slowest >= 0 && <span className="heat-legend-slow">Red heading = slowest exercise</span>}
        <span className="heat-legend-tip">Click a cell to read that answer</span>
      </div>
    </div>
  );
}
