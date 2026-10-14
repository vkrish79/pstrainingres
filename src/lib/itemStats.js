// Question statistics for the bank (A2), from the class's own report.
//
// Pure, and built ONLY from buildCohortReport's output (reports[].rows, which
// are scored by exactly the calls the Report tab makes), so the bank's figures
// can never disagree with the printed report.
//
// A "question" is a section of the paper (what the bank stores); its parts are
// the section's blocks. Per question:
//   sat        people still in the class who sat the paper
//   scored     of those, people for whom every part of this question is marked
//              — an unmarked manual part is left out, never counted as zero
//   mean_frac  average share of the question's marks among the scored
//   top_frac / bottom_frac   the same for the top and bottom thirds of the
//              scored people by their overall score: whether it separates
//              strong from weak
//   group_size how many people are in each third (0 when under 3 scored)
//
//   satIds — Set of participant ids who sat (the close dialog's own test)
export function itemStatsFromCohort({ reports, sections, blocks, satIds }) {
  const sectionOf = Object.fromEntries((blocks || []).map(b => [b.id, b.section_id]));
  const people = (reports || []).filter(r => !r.participant.deactivated_at && satIds.has(r.participant.id));
  const out = [];

  for (const sec of sections || []) {
    const scored = [];
    for (const r of people) {
      const rows = (r.rows || []).filter(x => sectionOf[x.blockId] === sec.id);
      if (!rows.length) continue;                      // nothing scorable in this question
      if (rows.some(x => x.state === 'unmarked')) continue;
      const possible = rows.reduce((n, x) => n + (x.possible || 0), 0);
      if (possible <= 0) continue;
      const earned = rows.reduce((n, x) => n + (x.earned || 0), 0);
      scored.push({ frac: Math.max(0, Math.min(1, earned / possible)), overall: r.score?.pct ?? 0 });
    }
    if (!scored.length) continue;

    const mean = list => list.reduce((n, x) => n + x.frac, 0) / list.length;
    const group = Math.floor(scored.length / 3);
    const ranked = [...scored].sort((a, b) => b.overall - a.overall);
    out.push({
      section_id: sec.id,
      sat: people.length,
      scored: scored.length,
      mean_frac: round(mean(scored)),
      top_frac: group ? round(mean(ranked.slice(0, group))) : null,
      bottom_frac: group ? round(mean(ranked.slice(-group))) : null,
      group_size: group,
    });
  }
  return out;
}

function round(x) { return Math.round(x * 1000) / 1000; }

// How a question reads in the bank, from its combined figures.
//   facility    0–1 share of marks earned       top / bottom   0–1 by thirds
// Below MIN_ANSWERS the numbers are shown but not judged.
export const MIN_ANSWERS = 30;
export function itemVerdict({ scored, facility, top_frac: top, bottom_frac: bottom }) {
  const enough = scored >= MIN_ANSWERS;
  const gap = top != null && bottom != null ? top - bottom : null;
  const separates = gap == null ? null : gap <= -0.1 ? 'reversed' : gap >= 0.2 ? 'yes' : gap > 0.05 ? 'weakly' : 'no';
  let flag = null;
  if (enough) {
    if (separates === 'reversed') flag = 'check';
    else if (facility >= 0.9) flag = 'easy';
    else if (facility <= 0.3) flag = 'hard';
  }
  return { enough, separates, flag };
}
