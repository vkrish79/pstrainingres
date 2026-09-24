// The seven tables behind Analytics → Download for Excel.
//
// CSV, not .xlsx: a CSV opens straight in Excel and needs no new dependency.
// One table per file, because a CSV holds exactly one table.
//
// Numbers go in as numbers, never as "84%", so Excel can sort and total them.
// The header says what the unit is.

import { csvEscape, downloadCsv } from './sessionExport.js';
import {
  papersOf, assessmentStats, sessionAvgPct, sessionPassRate,
  headline, monthlyRows, groupSessions, median, PAPER_STATES, hasUnlistedPapers,
} from './analyticsMetrics.js';

const r1 = v => (v == null ? '' : Math.round(v * 10) / 10);
const day = d => (d ? String(d).slice(0, 10) : '');

function summaryRows(sessions, rangeLabel) {
  const h = headline(sessions);
  const a = h.assessment;
  return [
    ['Measure', 'Value'],
    ['Date range', rangeLabel],
    ['Downloaded', day(new Date().toISOString())],
    ['Sessions closed', h.closed],
    ['Sessions still open', h.open],
    ['People trained', h.people],
    ['Dropped out', h.dropouts],
    ['Completion % (weighted by class size)', r1(h.completion)],
    ['Finished every exercise', h.fullyCompleted],
    ['Finished under half', h.belowHalf],
    ['Never started', h.notStarted],
    ['Training days', h.trainingDays],
    ['Trainers', h.trainers],
    ['Cities', h.cities],
    ['Median class size', h.medianClass ?? ''],
    ['Largest class', h.largestClass ?? ''],
    ['Assessment papers sat', a.sat],
    ['Marked papers (with a pass mark)', a.marked],
    ['Passed', a.pass],
    ['Failed', a.fail],
    ['Didn’t sit', a.absent + a.incomplete],
    ['Pass rate %', r1(a.passRate)],
    ['Average score %', r1(a.avgPct)],
    ['Median score %', r1(median(a.pcts))],
  ];
}

function monthlySheet(sessions) {
  return [
    ['Month', 'Sessions closed', 'People trained', 'Completion %', 'Papers sat', 'Pass rate %'],
    ...monthlyRows(sessions).map(m => [m.key, m.sessions, m.people, r1(m.completion), m.papers, r1(m.passRate)]),
  ];
}

function sessionSheet(sessions) {
  const rows = [[
    'Session', 'Start date', 'Status', 'Type', 'Trainer', 'City', 'Days', 'Exercises',
    'People', 'Dropped out', 'Completion %', 'Finished every exercise', 'Finished under half',
    'Never started', 'Assessment', 'Pass mark %', 'Sat', 'Average score %', 'Passed', 'Failed', 'Pass rate %',
  ]];
  const sorted = [...sessions].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const s of sorted) {
    const st = assessmentStats([s]);
    rows.push([
      s.name, day(s.date), s.isClosed ? 'Closed' : 'Open', s.typeName || 'Untyped',
      s.trainerName || '', s.cityName || '', s.trainingDays ?? '', s.blockCount ?? '',
      s.participants, s.dropouts || 0, r1(s.completionPct), s.fullyCompleted ?? '',
      s.belowThreshold ?? '', s.notStarted ?? '',
      s.assessment ? s.assessment.title : '', s.assessment?.passMark ?? '',
      s.assessment ? st.sat : '', r1(sessionAvgPct(s)),
      s.assessment ? st.pass : '', s.assessment ? st.fail : '', r1(sessionPassRate(s)),
    ]);
  }
  return rows;
}

function groupSheet(sessions, groupId, label) {
  return [
    [label, 'Sessions closed', 'People trained', 'Completion %', 'Training days', 'Papers sat', 'Passed', 'Failed', 'Pass rate %', 'Average score %'],
    ...groupSessions(sessions, groupId).map(g => [
      g.name, g.closed, g.people, r1(g.completion), g.trainingDays,
      g.assessment.sat, g.assessment.pass, g.assessment.fail,
      r1(g.assessment.passRate), r1(g.assessment.avgPct),
    ]),
  ];
}

function resultsSheet(sessions) {
  // Earned / possible are the marks behind the percentage, and dropped-out
  // says why a paper may be missing. Both were in the old export; a
  // percentage on its own can't settle a borderline paper.
  const rows = [[
    'Person', 'Username', 'Session', 'Date', 'Type', 'Trainer', 'Assessment',
    'Pass mark %', 'Score %', 'Earned', 'Possible', 'Result', 'Dropped out',
  ]];
  const papers = papersOf(sessions).sort((a, b) => String(b.session.date).localeCompare(String(a.session.date)));
  for (const p of papers) {
    const s = p.session;
    rows.push([
      p.name, p.username, s.name, day(s.date), s.typeName || 'Untyped', s.trainerName || '',
      s.assessment.title, s.assessment.passMark ?? '', p.pct ?? '',
      p.earned ?? '', p.possible ?? '', PAPER_STATES[p.state], p.deactivated ? 'yes' : '',
    ]);
  }
  // Sessions whose names were never recorded still get a line, so the file
  // can't quietly show fewer papers than the Summary counts.
  for (const s of sessions.filter(hasUnlistedPapers)) {
    rows.push([
      '(names not recorded)', '', s.name, day(s.date), s.typeName || 'Untyped', s.trainerName || '',
      s.assessment.title, s.assessment.passMark ?? '', '', '', '', `${s.assessment.sat} sat this paper`, '',
    ]);
  }
  return rows;
}

export function analyticsTables(sessions, rangeLabel) {
  return [
    { id: 'summary', name: 'Summary', note: 'Every headline figure on the page, for the chosen date range.', rows: summaryRows(sessions, rangeLabel) },
    { id: 'monthly', name: 'Monthly', note: 'The three trend lines, plus papers and pass rate per month.', rows: monthlySheet(sessions) },
    { id: 'sessions', name: 'Sessions', note: 'One row per session: everything on the heat board and more.', rows: sessionSheet(sessions) },
    { id: 'by-type', name: 'By type', note: 'The Breakdown table, by session type.', rows: groupSheet(sessions, 'type', 'Type') },
    { id: 'by-trainer', name: 'By trainer', note: 'The Breakdown table, by trainer.', rows: groupSheet(sessions, 'trainer', 'Trainer') },
    { id: 'by-city', name: 'By city', note: 'The Breakdown table, by city.', rows: groupSheet(sessions, 'city', 'City') },
    { id: 'by-assessment', name: 'By assessment', note: 'One row per paper, wherever it was run — is this assessment too hard?', rows: groupSheet(sessions, 'assessment', 'Assessment') },
    { id: 'by-vendor', name: 'By vendor', note: 'The Breakdown table, by vendor.', rows: groupSheet(sessions, 'vendor', 'Vendor') },
    { id: 'assessment-results', name: 'Assessment results', note: 'One row per person per paper.', rows: resultsSheet(sessions) },
  ];
}

export function tableFilename(table, rangeId) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `analytics_${table.id}_${rangeId}_${stamp}.csv`;
}

// A BOM keeps non-ASCII names (Arabic, accents) readable when Excel opens the
// file by double-click, which otherwise assumes the system codepage.
export function downloadTable(table, rangeId) {
  const csv = table.rows.map(r => r.map(csvEscape).join(',')).join('\n');
  downloadCsv(tableFilename(table, rangeId), '﻿' + csv);
}
