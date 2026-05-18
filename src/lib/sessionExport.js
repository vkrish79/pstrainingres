// Builds a long-format CSV of every saved answer for a session.
// Columns: session, participant, section, block, cell, value, updated_at,
//          flag, note, participant_note
// One row per (participant × answered field) — table blocks expand to one row
// per filled input cell. Plus one synthetic row per (participant × section)
// when the participant left a section-level note but didn't answer anything
// in that section, so notes aren't silently dropped.

import { isFillableBlock, labelOf, inputCellsOf } from './blockHelpers.js';

export function buildAnswersCsv({
  session, sections, blocks, participants, answers,
  notes = {}, participantNotes = {},
}) {
  const sectionTitle = Object.fromEntries(sections.map(s => [s.id, s.title]));
  const fillable = blocks.filter(isFillableBlock);

  const rows = [['session', 'participant', 'section', 'block', 'cell', 'value', 'updated_at', 'flag', 'note', 'participant_note']];

  for (const p of participants) {
    const pname = p.full_name || p.email || p.id;
    const pAnswers = answers[p.id] || {};
    const pNotes = notes[p.id] || {};
    const pSectionNotes = participantNotes[p.id] || {};
    // Track which sections had at least one answer row so we can emit a
    // synthetic row for any orphaned section notes below.
    const sectionsWithAnswer = new Set();
    for (const b of fillable) {
      const a = pAnswers[b.id];
      if (!a) continue;
      const sect = sectionTitle[b.section_id] || '';
      const noteEntry = pNotes[b.id];
      const flag = noteEntry?.flag ? 'flagged' : '';
      const note = noteEntry?.note || '';
      const participantNote = pSectionNotes[b.section_id]?.note || '';

      if (b.block_type === 'field') {
        const v = Array.isArray(a.value) ? a.value.join('; ') : (a.value ?? '');
        if (v === '' || v == null) continue;
        rows.push([session.name, pname, sect, labelOf(b), '', String(v), a.updated_at || '', flag, note, participantNote]);
        sectionsWithAnswer.add(b.section_id);
      } else if (b.block_type === 'table') {
        const cellMap = (a.value && typeof a.value === 'object' && !Array.isArray(a.value)) ? a.value : {};
        // Same flag/note repeats for every cell of the same block (block-level annotations).
        for (const c of inputCellsOf(b)) {
          const v = cellMap[c.id];
          if (v == null || v === '') continue;
          rows.push([session.name, pname, sect, labelOf(b), c.label, String(v), a.updated_at || '', flag, note, participantNote]);
          sectionsWithAnswer.add(b.section_id);
        }
      }
    }
    // Emit section notes that had no accompanying answer in that section.
    for (const [sectionId, n] of Object.entries(pSectionNotes)) {
      if (!n?.note || sectionsWithAnswer.has(sectionId)) continue;
      rows.push([session.name, pname, sectionTitle[sectionId] || '', '', '', '', n.updated_at || '', '', '', n.note]);
    }
  }

  return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
