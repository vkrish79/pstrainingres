// Builds a long-format CSV of every saved answer for a session.
// Columns: session, participant, section, block, cell, value, updated_at,
//          flag, note, participant_note, prep
// One row per (participant × answered field) — table blocks expand to one row
// per filled input cell. Plus synthetic rows per (participant × section) when
// the section had no answers but still has a note or prep, so nothing drops.

import { isFillableBlock, labelOf, inputCellsOf } from './blockHelpers.js';

export function buildAnswersCsv({
  session, sections, blocks, participants, answers,
  notes = {}, participantNotes = {}, participantPrep = {}, participantStandalone = {},
}) {
  const sectionTitle = Object.fromEntries(sections.map(s => [s.id, s.title]));
  const fillable = blocks.filter(isFillableBlock);

  const rows = [['session', 'participant', 'section', 'block', 'cell', 'value', 'updated_at', 'flag', 'note', 'participant_note', 'prep']];

  for (const p of participants) {
    const pname = p.full_name || p.email || p.id;
    const pAnswers = answers[p.id] || {};
    const pNotes = notes[p.id] || {};
    const pSectionNotes = participantNotes[p.id] || {};
    const pSectionPrep = participantPrep[p.id] || {};
    // Track which sections had at least one answer row so we can emit a
    // synthetic row for any orphaned section notes / prep below.
    const sectionsWithAnswer = new Set();
    for (const b of fillable) {
      const a = pAnswers[b.id];
      if (!a) continue;
      const sect = sectionTitle[b.section_id] || '';
      const noteEntry = pNotes[b.id];
      const flag = noteEntry?.flag ? 'flagged' : '';
      const note = noteEntry?.note || '';
      const participantNote = pSectionNotes[b.section_id]?.note || '';
      const prep = pSectionPrep[b.section_id]?.content || '';

      if (b.block_type === 'field') {
        const v = Array.isArray(a.value) ? a.value.join('; ') : (a.value ?? '');
        if (v === '' || v == null) continue;
        rows.push([session.name, pname, sect, labelOf(b), '', String(v), a.updated_at || '', flag, note, participantNote, prep]);
        sectionsWithAnswer.add(b.section_id);
      } else if (b.block_type === 'table') {
        const cellMap = (a.value && typeof a.value === 'object' && !Array.isArray(a.value)) ? a.value : {};
        // Same flag/note/prep repeats for every cell of the same block.
        for (const c of inputCellsOf(b)) {
          const v = cellMap[c.id];
          if (v == null || v === '') continue;
          rows.push([session.name, pname, sect, labelOf(b), c.label, String(v), a.updated_at || '', flag, note, participantNote, prep]);
          sectionsWithAnswer.add(b.section_id);
        }
      }
    }
    // Emit a synthetic row for any section that has a note or prep but no
    // answer of its own.
    const orphanSections = new Set([
      ...Object.keys(pSectionNotes).filter(id => pSectionNotes[id]?.note),
      ...Object.keys(pSectionPrep).filter(id => pSectionPrep[id]?.content),
    ]);
    for (const sectionId of orphanSections) {
      if (sectionsWithAnswer.has(sectionId)) continue;
      const n = pSectionNotes[sectionId];
      const pr = pSectionPrep[sectionId];
      const ts = (n?.updated_at && pr?.updated_at)
        ? (n.updated_at > pr.updated_at ? n.updated_at : pr.updated_at)
        : (n?.updated_at || pr?.updated_at || '');
      rows.push([
        session.name, pname, sectionTitle[sectionId] || '', '', '', '',
        ts, '', '', n?.note || '', pr?.content || '',
      ]);
    }
    // Standalone prep (not tied to any exercise) — one synthetic row per item.
    for (const item of (participantStandalone[p.id] || [])) {
      if (!item?.content) continue;
      rows.push([
        session.name, pname, 'Pre-work', item.label || '', '', '',
        item.updated_at || '', '', '', '', item.content,
      ]);
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
