// The participant's assessment as an exam: a start screen, then one question
// per page, then a review.
//
// buildQuestions() makes every section a "question", but an imported paper is
// mostly other things — a Cover, Document information, chapter headings with no
// content ("EMD", "RESIDENCE"), and reading material with nothing to answer.
// Listing those as questions is what made the old rail read "Cover — nothing to
// answer". Here:
//
//   • a section with parts to answer is a QUESTION page;
//   • an auto-titled section with no blocks at all is a WITHDRAWN question (the
//     read policy withholds a withdrawn question's blocks) — it keeps its page so
//     the numbering has no silent gap;
//   • a custom-titled section with no blocks is a CHAPTER heading, shown as a
//     label on the questions that follow it;
//   • a section with content but nothing to answer is READING, shown above the
//     next question (or on the start screen, before the first one; or after the
//     last question, if it comes last).
//
// Question headings are left exactly as buildQuestions() names them, so the
// participant, the trainer's marking view and the report all say the same thing.

export function buildPaper(questions) {
  const start = [];
  const pages = [];
  let reading = [];
  let chapter = null;

  for (const q of questions || []) {
    const hasBlocks = q.blocks.length > 0;
    if (q.partCount > 0 || (!hasBlocks && q.isAuto)) {
      pages.push({
        id: q.section.id,
        question: q,
        withdrawn: !hasBlocks,
        chapter,
        reading: pages.length === 0 ? [] : reading,
      });
      if (pages.length === 1) start.push(...reading);
      reading = [];
      continue;
    }
    if (!hasBlocks) { chapter = q.section.title; continue; }
    reading.push(q);
  }

  // Reading after the last question belongs to that question.
  if (reading.length) {
    if (pages.length) pages[pages.length - 1].after = reading;
    else start.push(...reading);
  }

  pages.forEach((p, i) => { p.index = i; });
  return { start, pages };
}

// Parts answered / total for a set of question pages.
export function paperProgress(pages, progress) {
  let answered = 0, total = 0;
  for (const p of pages) {
    const pr = progress[p.id];
    if (!pr || p.withdrawn) continue;
    answered += pr.answered;
    total += pr.total;
  }
  return { answered, total, pct: total ? Math.round((answered / total) * 100) : 0 };
}
