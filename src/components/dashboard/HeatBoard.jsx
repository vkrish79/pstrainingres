import { useMemo } from 'react';
import { isFillableBlock, expectedInputs, filledInputs } from '../../lib/blockHelpers.js';

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
  selectedId, onPickParticipant, onOpenCell,
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

  if (columns.length === 0) return <p className="muted">No exercises to fill in this workbook.</p>;

  const pct = f => `${Math.round(f * 100)}%`;

  return (
    <div className="heat-board">
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
                      <span className="heat-person-name">{p.full_name || '(unnamed)'}</span>
                      <span className="heat-person-n">{answered}/{total}</span>
                    </button>
                  </th>
                  {cells.map((cell, i) => {
                    const c = columns[i];
                    const isHere = here === c.sec.id;
                    return (
                      <td key={c.sec.id}>
                        <button
                          type="button"
                          className={`heat-cell${isHere ? ' is-here' : ''}`}
                          style={{ background: shade(cell.frac) }}
                          onClick={() => onOpenCell(c.sec.id, p.id)}
                          aria-label={`${p.full_name || 'Participant'}, ${c.sec.title}: ${cell.filled} of ${c.inputs}${isHere ? ', here now' : ''}`}
                          title={`${p.full_name || 'Participant'} · ${c.sec.title}: ${cell.filled} of ${c.inputs}${isHere ? ' · here now' : ''}`}
                        >
                          {cell.frac >= 1 ? '✓' : cell.frac > 0 ? pct(cell.frac) : ''}
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
          </tfoot>
        </table>
      </div>
      <div className="heat-legend" aria-hidden="true">
        <span>Filled in:</span>
        <span><i style={{ background: 'var(--heat-0)' }} />none</span>
        <span><i style={{ background: shade(0.5) }} />half</span>
        <span><i style={{ background: 'var(--gold)' }} />all</span>
        <span><i className="is-here-swatch" />where they are now</span>
        {slowest >= 0 && <span className="heat-legend-slow">Red heading = slowest exercise</span>}
        <span className="heat-legend-tip">Click a cell to read that answer</span>
      </div>
    </div>
  );
}
