// DEV PREVIEW, NOT PART OF THE APP. Mounts the real AssessmentReportView with
// fabricated props so the re-sit rendering can be seen and asserted on in a
// browser WITHOUT SIGNING IN — which matters here because the .verify harnesses
// cannot log in and the only live re-sit has never been sat.
//
// It is reachable only at /resit-preview.html on the dev server. Vite builds
// just index.html, so neither this nor that entry is in the production bundle,
// and nothing in the app imports either. Driven by
// .verify/resit-report-render.mjs; delete both together or not at all.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AssessmentReportView } from '../components/dashboard/AssessmentReport.jsx';
import { questionResults } from '../lib/assessmentReport.js';
import '../styles/index.css';

const sec = { id: 'S1', order_index: 0, title: 'Scenario 1 — PNR creation' };
const mk = (id, tpl, label) => ({
  id, section_id: 'S1', order_index: Number(id.replace(/\D/g, '')), block_type: 'field',
  template_block_id: tpl, config: { input_type: 'short_text', label },
});
const blocks = [mk('b1', 'T1', 'Build the PNR'), mk('b2', 'T2', 'Divide and ATC'), mk('b3', 'T3', 'Name correction')];
const answerKey = { b1: 'right', b2: 'right', b3: 'right' };
const answerPoints = { b1: 10, b2: 10, b3: 10 };
const answerModes = { b1: 'auto', b2: 'auto', b3: 'auto' };

const participants = [
  { id: 'p1', full_name: 'Sofia Rossi', email: 'srossi@x.pstrainingres.local' },
  { id: 'p2', full_name: 'Liam Doyle', email: 'ldoyle@x.pstrainingres.local' },
  { id: 'p3', full_name: 'Aarti Nair', email: 'anair@x.pstrainingres.local' },
];
const answers = {
  p1: { b1: { value: 'no' }, b2: { value: 'no' }, b3: { value: 'no' } },      // 0% — re-sat, so the pair reads 0% -> 33%
  p2: { b1: { value: 'right' }, b2: { value: 'no' }, b3: { value: 'no' } },   // 33% — re-sit due
  p3: { b1: { value: 'right' }, b2: { value: 'right' }, b3: { value: 'right' } }, // 100%
};

// Sofia's re-sit paper: q1 identical, q2 amended, q3 swapped from the bank.
const rBlocks = [
  { ...mk('r1', 'T1', 'Build the PNR') },
  { ...mk('r2', 'T2', 'Divide and ATC'), config: { input_type: 'short_text', label: 'Divide and ATC', date: '2027-01-02' } },
  { id: 'r3', section_id: 'S1', order_index: 3, block_type: 'field', template_block_id: null,
    config: { input_type: 'short_text', label: 'Refund, partially unused' } },
];
const rRows = questionResults({
  blocks: rBlocks,
  answersForP: { r1: { value: 'right' }, r2: { value: 'no' }, r3: { value: 'no' } }, // 10/30
  answerKey: { r1: 'right', r2: 'right', r3: 'right' },
  answerPoints: { r1: 10, r2: 10, r3: 10 },
  answerModes: { r1: 'auto', r2: 'auto', r3: 'auto' },
  marksForP: {},
  labelByBlockId: { r1: '1', r2: '2', r3: '3' },
});

const resits = new Map([['p1', {
  rows: rRows, earned: 10, possible: 30, pct: 33, unmarked: 0,
  sat: true, marked: true,
  resitSessionName: 'ARDW re-sit', resitJoinCode: 'VHX8DL', resitStartsAt: '2026-10-24',
  replacedSectionCount: 1,
}]]);

// A second scenario on the same page: the re-sit exists but nobody has sat it.
const pendingResits = new Map([['p1', {
  rows: new Map(), earned: 0, possible: 30, pct: 0, unmarked: 0,
  sat: false, marked: false,
  resitSessionName: 'ARDW re-sit', resitJoinCode: 'VHX8DL', resitStartsAt: '2026-10-24',
  replacedSectionCount: 0,
}]]);

const session = {
  name: 'ARDW Sept intake', city_code: 'AUH', starts_at: '2026-09-01', ends_at: '2026-09-05',
  program: { title: 'ARDW Certification' }, trainer: { full_name: 'V Balasubramanian' },
};
const common = {
  session, participants, sections: [sec], blocks, answers, answerKey, answerPoints, answerModes,
  marks: {}, passMark: 60, loading: false, error: null,
};

function App() {
  return (
    <div style={{ padding: '1rem', background: '#fff' }}>
      <h1 id="case-a" style={{ font: '700 15px system-ui' }}>A — re-sit MARKED (33% → 33%, q2 amended, q3 replaced)</h1>
      <AssessmentReportView {...common} resits={resits} />
      <hr style={{ margin: '2rem 0' }} />
      <h1 id="case-b" style={{ font: '700 15px system-ui' }}>B — re-sit arranged, NOT sat (must keep 33%, never 0%)</h1>
      <AssessmentReportView {...common} resits={pendingResits} />
      <hr style={{ margin: '2rem 0' }} />
      <h1 id="case-c" style={{ font: '700 15px system-ui' }}>C — no re-sits at all (unchanged behaviour)</h1>
      <AssessmentReportView {...common} resits={null} />
      <hr style={{ margin: '2rem 0' }} />
      <h1 id="case-d" style={{ font: '700 15px system-ui' }}>D — CLOSED: same failures, but no &ldquo;re-sit due&rdquo; anywhere</h1>
      <AssessmentReportView {...common} resits={null} closed />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
