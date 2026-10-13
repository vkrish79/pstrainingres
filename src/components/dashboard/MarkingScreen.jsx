import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Block from '../blocks/Block.jsx';
import { labelOf as blockLabel } from '../../lib/blockHelpers.js';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.js';

// Marking an assessment on a screen of its own. Replaces the 720px slide-over,
// where the marking controls sat on top of the answer and "how to mark" notes
// shrank to a grey line.
//
// Two ways through the same marks:
//   By person — one participant's whole paper: a rail of questions with their
//               subtotal and parts left, each part a row with the answer on the
//               left and its marking on the right. ← / → change person and keep
//               the question.
//   By part   — one part for the whole class, one row per person, so answers
//               are judged side by side. ← / → change part.
//
// The marking controls, their rules and the "so far" totals are the tiles'
// own: every row is drawn by renderPart (ExerciseResponses' BlockAnswer in its
// split layout), and tallies come from lib/questionTally.js. Nothing here
// writes anything itself.
//
// people     [{ id, name }] in the Live responses order
// questions  [{ id, heading, narration: [block], fillable: [block] }]
// tallyFor(pid, qid) → questionTally for that person's question
// partChip(pid, blockId) → that person's chip for one part ('open' = still to mark)
// renderPart(pid, block, { showName }) → the row
// prepFor(pid, qid) → [{ label, content }] that person's pre-work for the question
export default function MarkingScreen({
  mode, onMode, people, personId, onPerson, questions, qid, onQuestion, partId, onPart,
  tallyFor, partChip, renderPart, prepFor, labelOf, onClose,
}) {
  useBodyScrollLock(true);
  const bodyRef = useRef(null);
  const [pendingAnchor, setPendingAnchor] = useState(null);

  const q = questions.find(x => x.id === qid) || questions[0];
  const personIdx = Math.max(0, people.findIndex(p => p.id === personId));
  const person = people[personIdx];
  const allParts = questions.flatMap(x => x.fillable.map(b => ({ q: x, block: b })));
  const partIdx = Math.max(0, allParts.findIndex(p => p.block.id === partId));
  const part = allParts[partIdx];

  const prevPerson = personIdx > 0 ? people[personIdx - 1] : null;
  const nextPerson = personIdx < people.length - 1 ? people[personIdx + 1] : null;
  const prevPart = partIdx > 0 ? allParts[partIdx - 1] : null;
  const nextPart = partIdx < allParts.length - 1 ? allParts[partIdx + 1] : null;

  useEffect(() => {
    function onKey(e) {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if (e.key === 'Escape' && !typing) { onClose(); return; }
      if (typing) return;
      if (mode === 'person') {
        if (e.key === 'ArrowLeft' && prevPerson) onPerson(prevPerson.id);
        if (e.key === 'ArrowRight' && nextPerson) onPerson(nextPerson.id);
      } else {
        if (e.key === 'ArrowLeft' && prevPart) onPart(prevPart.block.id);
        if (e.key === 'ArrowRight' && nextPart) onPart(nextPart.block.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, prevPerson, nextPerson, prevPart, nextPart, onPerson, onPart, onClose]);

  // A new person, question or part starts at the top.
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [mode, personId, qid, partId]);
  useEffect(() => {
    if (!pendingAnchor) return;
    const el = document.getElementById(pendingAnchor);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPendingAnchor(null);
  }, [pendingAnchor, qid, partId, personId]);

  const round1 = n => Math.round(n * 10) / 10;

  // ── By person ──────────────────────────────────────────────────────────
  let head;
  let rail;
  let body;
  if (mode === 'person' && person) {
    const tallies = questions.map(x => ({ x, t: tallyFor(person.id, x.id) }));
    const soFar = round1(tallies.reduce((s, { t }) => s + t.soFar, 0));
    const possible = round1(tallies.reduce((s, { t }) => s + t.possible, 0));
    const partsTotal = tallies.reduce((s, { t }) => s + t.parts.length, 0);
    const left = tallies.reduce((s, { t }) => s + t.left, 0);
    const qt = tallyFor(person.id, q.id);

    // The first part still to mark, from the question on screen onwards; then
    // the next person who has one.
    const start = Math.max(0, questions.findIndex(x => x.id === q.id));
    let next = null;
    for (let i = 0; i < questions.length && !next; i += 1) {
      const cand = tallies[(start + i) % questions.length];
      const open = cand.t.parts.find(p => p.chip === 'open');
      if (open) next = { qid: cand.x.id, blockId: open.blockId };
    }
    const goNext = () => {
      if (next) { onQuestion(next.qid); setPendingAnchor(`mk-${person.id}-${next.blockId}`); return; }
      if (nextPerson) onPerson(nextPerson.id);
    };
    const prep = prepFor(person.id, q.id);

    head = (
      <>
        <span className="mk-who">
          <select className="form-input" value={person.id} onChange={e => onPerson(e.target.value)} aria-label="Participant">
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="mk-pos">{personIdx + 1} of {people.length}</span>
        </span>
        <button type="button" className="ghost btn-sm" onClick={() => prevPerson && onPerson(prevPerson.id)} disabled={!prevPerson} data-tip="Previous participant (←)">←</button>
        <button type="button" className="ghost btn-sm" onClick={() => nextPerson && onPerson(nextPerson.id)} disabled={!nextPerson} data-tip="Next participant (→)">→</button>
        <button type="button" className="mk-next" onClick={goNext} disabled={!next && !nextPerson}>
          {next ? 'Next to mark ↓' : nextPerson ? 'Next person →' : 'All marked'}
        </button>
        <span className="mk-total">
          <b className="num">{soFar}</b>
          <span>{left === 0 && partsTotal ? `of ${possible}` : `so far, of ${possible}`} · {partsTotal - left} of {partsTotal} parts marked</span>
        </span>
      </>
    );
    rail = (
      <>
        <div className="mk-rail-h">{person.name}’s paper</div>
        {tallies.map(({ x, t }) => (
          <button key={x.id} type="button" className={`mk-rq${x.id === q.id ? ' on' : ''}`} onClick={() => onQuestion(x.id)}>
            <b>{x.heading}</b>
            <span className="num mk-rq-s">{t.parts.length && (t.left < t.parts.length || t.complete) ? t.soFar : '—'}/{t.possible}</span>
            <small className={t.complete ? 'is-done' : 'is-left'}>{t.complete ? 'done' : `${t.left} part${t.left === 1 ? '' : 's'} left`}</small>
          </button>
        ))}
        <div className="mk-rail-foot"><span>So far</span><span className="num">{soFar} / {possible}</span></div>
      </>
    );
    body = (
      <>
        <div className="mk-qtop">
          <h3>{q.heading}</h3>
          <span className="muted">{q.fillable.length} part{q.fillable.length === 1 ? '' : 's'}</span>
          <span className="mk-qsum num">{qt.soFar} <small>{qt.complete ? `of ${qt.possible}` : `so far, of ${qt.possible}`}</small></span>
        </div>
        <Scenario narration={q.narration} />
        {prep.length > 0 && <PrepLine items={prep} />}
        {q.fillable.map(b => (
          <div key={b.id} id={`mk-${person.id}-${b.id}`} className="mk-row">
            {renderPart(person.id, b, { showName: false })}
          </div>
        ))}
      </>
    );
  } else if (part) {
    // ── By part ──────────────────────────────────────────────────────────
    const chips = people.map(p => ({ p, chip: partChip(p.id, part.block.id) }));
    const marked = chips.filter(c => c.chip && c.chip !== 'open').length;
    const scored = chips.filter(c => c.chip).length;
    const nextOpen = chips.find(c => c.chip === 'open');
    head = (
      <>
        <span className="mk-who"><b>{labelOf(part.block.id) || part.q.heading}</b><span className="mk-pos">part {partIdx + 1} of {allParts.length}</span></span>
        <button type="button" className="ghost btn-sm" onClick={() => prevPart && onPart(prevPart.block.id)} disabled={!prevPart} data-tip="Previous part (←)">←</button>
        <button type="button" className="ghost btn-sm" onClick={() => nextPart && onPart(nextPart.block.id)} disabled={!nextPart} data-tip="Next part (→)">→</button>
        <button
          type="button"
          className="mk-next"
          disabled={!nextOpen}
          onClick={() => nextOpen && setPendingAnchor(`mk-${nextOpen.p.id}-${part.block.id}`)}
        >
          {nextOpen ? 'Next to mark ↓' : 'All marked'}
        </button>
        <span className="mk-total"><b className="num">{marked}</b><span>of {scored || people.length} marked on this part</span></span>
      </>
    );
    rail = (
      <>
        <div className="mk-rail-h">Parts</div>
        {questions.map(x => (
          <div key={x.id} className="mk-rgroup">
            <span className="mk-rgroup-h">{x.heading}</span>
            {x.fillable.map(b => {
              const m = people.filter(p => { const c = partChip(p.id, b.id); return c && c !== 'open'; }).length;
              return (
                <button key={b.id} type="button" className={`mk-rp${b.id === part.block.id ? ' on' : ''}`} onClick={() => onPart(b.id)}>
                  <span>{labelOf(b.id)}</span>
                  <small className={m === people.length ? 'is-done' : 'is-left'}>{m}/{people.length}</small>
                </button>
              );
            })}
          </div>
        ))}
      </>
    );
    body = (
      <>
        <div className="mk-qtop">
          <h3>{part.q.heading}</h3>
          <span className="muted">part {labelOf(part.block.id)}</span>
        </div>
        {/* The part's question, once — each row below is just a person. */}
        <p className="mk-partq">{blockLabel(part.block)}</p>
        <Scenario narration={part.q.narration} />
        {people.map(p => (
          <div key={p.id} id={`mk-${p.id}-${part.block.id}`} className="mk-row">
            {renderPart(p.id, part.block, { showName: true, prep: prepFor(p.id, part.q.id) })}
          </div>
        ))}
      </>
    );
  }

  return createPortal(
    <div className="mk-screen" role="dialog" aria-modal="true" aria-label="Marking">
      <header className="mk-head">
        <button type="button" className="mk-back" onClick={onClose}>← Live responses</button>
        <span className="mk-mode" role="group" aria-label="Mark by">
          <button type="button" className={mode === 'person' ? 'active' : ''} aria-pressed={mode === 'person'} onClick={() => onMode('person')}>By person</button>
          <button type="button" className={mode === 'part' ? 'active' : ''} aria-pressed={mode === 'part'} onClick={() => onMode('part')}>By part</button>
        </span>
        {head}
      </header>
      <div className="mk-cols">
        <nav className="mk-rail" aria-label={mode === 'person' ? 'Questions' : 'Parts'}>{rail}</nav>
        <main className="mk-body" ref={bodyRef}>{body}</main>
      </div>
    </div>,
    document.body,
  );
}

// The question's own text, folded away until wanted.
function Scenario({ narration }) {
  if (!narration?.length) return null;
  return (
    <details className="mk-scen">
      <summary>Show the question</summary>
      <div className="mk-scen-body">{narration.map(b => <Block key={b.id} block={b} readOnly />)}</div>
    </details>
  );
}

// What this participant was given for the question.
function PrepLine({ items }) {
  return (
    <div className="mk-prep">
      <span className="mk-prep-h">Their pre-work for this question</span>
      {items.map((it, i) => (
        <span key={i} className="mk-prep-v">{items.length > 1 && it.label ? <small>{it.label}</small> : null}{it.content}</span>
      ))}
    </div>
  );
}
