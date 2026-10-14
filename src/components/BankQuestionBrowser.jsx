import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SkeletonLines } from './Skeleton.jsx';
import Block from './blocks/Block.jsx';
import { useBankQuestions } from '../hooks/useBankQuestions.js';
import { questionKeyState } from '../lib/bankQuestions.js';
import { questionTypeKeys, typeGlyph, typeLabel } from '../lib/questionTypeLabels.js';
import { useBankItemStats } from '../hooks/useBankItemStats.js';
import { itemVerdict, MIN_ANSWERS } from '../lib/itemStats.js';
import { useBankSimilar, NEAR_COPY } from '../hooks/useBankSimilar.js';
import '../styles/question-bank.css';

// Reading a question bank.
//
// The library answers "which bank"; this answers the question a list of bank
// titles cannot — what is actually IN one. A trainer picking questions for a
// paper is judging the wording and the marking, so both are on screen: the
// question as a candidate meets it, with the correct answer marked.
//
// Answers are shown by DEFAULT, because browsing is the job here. Hiding them
// is not a permission (this whole page is behind the super-trainer gate, and
// assessment_answer_keys has no participant policy at all) — it is for reading
// a question the way the room will meet it.
export default function BankQuestionBrowser({ bank, onBack }) {
  const { loading, error, sections, blocks, keys, usage } = useBankQuestions(bank?.id);
  // How each question has worked in real classes (A2), recorded at close.
  const itemStats = useBankItemStats(bank?.id);

  const [find, setFind] = useState('');
  const [topic, setTopic] = useState('');
  const [showAnswers, setShowAnswers] = useState(true);
  const [open, setOpen] = useState(() => new Set());
  const [focusIdx, setFocusIdx] = useState(-1);
  const listRef = useRef(null);
  // Questions that read alike, and search by meaning (T2).
  const similar = useBankSimilar(bank?.id);
  const searchBank = similar.search;
  const [byMeaning, setByMeaning] = useState(false);
  const [meaning, setMeaning] = useState(null); // { [sectionId]: similarity } for the current search
  const [meaningErr, setMeaningErr] = useState('');
  useEffect(() => {
    const q = find.trim();
    if (!byMeaning || q.length < 3) { setMeaning(null); setMeaningErr(''); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { results, error: e } = await searchBank(q);
      if (cancelled) return;
      if (e) { setMeaningErr("Search by meaning isn't available right now."); setMeaning(null); return; }
      setMeaningErr('');
      setMeaning(Object.fromEntries(results.map(r => [r.section_id, r.similarity])));
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [byMeaning, find, searchBank]);

  const blocksBySection = useMemo(() => {
    const m = new Map();
    for (const b of blocks) {
      if (!m.has(b.section_id)) m.set(b.section_id, []);
      m.get(b.section_id).push(b);
    }
    return m;
  }, [blocks]);

  const hasKey = b => keys[b.id] != null;

  // One pass over the bank: everything a row shows, worked out once.
  const questions = useMemo(() => sections.map(s => {
    const secBlocks = blocksBySection.get(s.id) || [];
    return {
      section: s,
      blocks: secBlocks,
      state: questionKeyState(secBlocks, hasKey),
      types: questionTypeKeys(secBlocks),
      topics: s.tags || [],
      used: usage[s.id] || 0,
    };
  }).filter(q => q.state !== null), [sections, blocksBySection, keys, usage]);

  const topics = useMemo(() => {
    const t = new Set();
    questions.forEach(q => q.topics.forEach(x => { if (x) t.add(x); }));
    return [...t].sort((a, b) => a.localeCompare(b));
  }, [questions]);

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    // By meaning: the closest questions first, words or not. Anything well
    // below the best match is left out so the list stays short.
    if (byMeaning && meaning) {
      const best = Math.max(0, ...Object.values(meaning));
      return questions
        .filter(q => (!topic || q.topics.includes(topic)) && meaning[q.section.id] != null && meaning[q.section.id] >= best - 0.08)
        .sort((a, b) => meaning[b.section.id] - meaning[a.section.id]);
    }
    return questions.filter(q => {
      if (topic && !q.topics.includes(topic)) return false;
      if (!needle) return true;
      // Searches the wording AND the topics — the question you half-remember is
      // usually remembered by a word in it, not by its title.
      const hay = [
        q.section.title || '',
        q.topics.join(' '),
        q.blocks.map(b => {
          const c = b.config || {};
          return [c.label, c.prompt, c.text, (c.options || []).join(' ')].filter(Boolean).join(' ');
        }).join(' '),
      ].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [questions, topic, find, byMeaning, meaning]);

  // The focused row is an index into the SHOWN list, so anything that shortens
  // that list has to drop it or the next arrow key jumps somewhere arbitrary.
  useEffect(() => { setFocusIdx(-1); }, [topic, find]);

  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (!shown.length) return;
      e.preventDefault();
      setFocusIdx(i => {
        const next = Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
        listRef.current?.querySelectorAll('.qb-row')[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown.length]);

  function toggle(id) {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const allOpen = shown.length > 0 && shown.every(q => open.has(q.section.id));

  return (
    <>
      <section className="qb-strip">
        <button type="button" className="qb-back" onClick={onBack}>&larr; All question banks</button>
        <h2>{bank?.title}</h2>
        <span className="qb-strip-facts">
          <span><b>{questions.length}</b> question{questions.length === 1 ? '' : 's'}</span>
          {bank?.bank?.unkeyed > 0 && <span className="qb-bad"><b>{bank.bank.unkeyed}</b> unkeyed</span>}
          {bank?.bank?.byHand > 0 && <span><b>{bank.bank.byHand}</b> by hand</span>}
        </span>
        <Link to={`/trainer/question-bank/${bank?.id}`} className="qb-open">Open editor</Link>
      </section>

      <div className="qb-bar">
        <div className="qb-chips" role="group" aria-label="Filter by topic">
          <button
            type="button"
            className={`qb-chip ${topic ? '' : 'is-on'}`}
            aria-pressed={!topic}
            onClick={() => setTopic('')}
          >
            All topics
          </button>
          {topics.map(t => (
            <button
              key={t}
              type="button"
              className={`qb-chip ${topic === t ? 'is-on' : ''}`}
              aria-pressed={topic === t}
              onClick={() => setTopic(topic === t ? '' : t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="qb-bar-right">
          <span className="qb-seg" role="group" aria-label="Find by">
            <button type="button" className={byMeaning ? '' : 'is-on'} aria-pressed={!byMeaning} onClick={() => setByMeaning(false)}>By wording</button>
            <button type="button" className={byMeaning ? 'is-on' : ''} aria-pressed={byMeaning} onClick={() => setByMeaning(true)} disabled={similar.unavailable}
              data-tip={similar.unavailable ? "Search by meaning isn't set up yet" : 'Finds questions that mean the same, even in other words'}>
              By meaning
            </button>
          </span>
          <input
            type="search"
            className="form-input qb-find"
            placeholder={byMeaning ? 'Describe the question…' : 'Find a question…'}
            aria-label="Find a question"
            value={find}
            onChange={e => setFind(e.target.value)}
          />
          <span className="qb-seg" role="group" aria-label="Correct answers">
            <button
              type="button"
              className={showAnswers ? 'is-on' : ''}
              aria-pressed={showAnswers}
              onClick={() => setShowAnswers(true)}
            >
              Answers
            </button>
            <button
              type="button"
              className={showAnswers ? '' : 'is-on'}
              aria-pressed={!showAnswers}
              onClick={() => setShowAnswers(false)}
            >
              Hidden
            </button>
          </span>
          <button
            type="button"
            className="qb-mini"
            onClick={() => setOpen(allOpen ? new Set() : new Set(shown.map(q => q.section.id)))}
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
          <span className="qb-count">{shown.length} of {questions.length}</span>
        </div>
      </div>

      {meaningErr && <p className="error">{meaningErr}</p>}
      {loading && <SkeletonLines rows={5} label="Loading questions…" />}
      {error && <p className="error">{error}</p>}

      {!loading && !error && questions.length === 0 && (
        <p className="cockpit-empty">This bank has no questions yet. Open the editor to write the first one.</p>
      )}
      {!loading && !error && questions.length > 0 && shown.length === 0 && (
        <p className="cockpit-empty">Nothing here with that filter.</p>
      )}

      <div className="qb-list" ref={listRef}>
        {shown.map((q, i) => {
          const isOpen = open.has(q.section.id);
          return (
            <article
              key={q.section.id}
              className={`qb-row${isOpen ? ' is-open' : ''}${i === focusIdx ? ' is-focus' : ''}`}
            >
              <button
                type="button"
                className="qb-head"
                aria-expanded={isOpen}
                onClick={() => { setFocusIdx(i); toggle(q.section.id); }}
              >
                <span className="qb-num">{i + 1}</span>
                <span className="qb-meta">
                  <span className="qb-title">
                    {q.section.title || 'Untitled question'}
                    {byMeaning && meaning?.[q.section.id] != null && (
                      <span className="qb-match">{Math.round(meaning[q.section.id] * 100)}% match</span>
                    )}
                  </span>
                  <span className="qb-tags">
                    {q.types.map(k => (
                      <span key={k} className="qb-type">
                        <span aria-hidden="true">{typeGlyph(k)}</span> {typeLabel(k)}
                      </span>
                    ))}
                    {q.topics.map(t => <span key={t} className="qb-topic">{t}</span>)}
                    {q.state === 'unkeyed' && <span className="qb-pill is-bad">unkeyed</span>}
                    {q.state === 'hand' && <span className="qb-pill is-hand">by hand</span>}
                    <ItemStatChip stat={itemStats[q.section.id]} />
                    <span className="qb-used">
                      {q.used
                        ? <>in <b>{q.used}</b> paper{q.used === 1 ? '' : 's'}</>
                        : 'never picked'}
                    </span>
                  </span>
                </span>
                <span className="qb-chev" aria-hidden="true">▶</span>
              </button>

              {isOpen && (
                <div className="qb-body">
                  {q.blocks.length === 0 && <p className="cockpit-empty">(empty)</p>}
                  {/* preview, not just readOnly: this is the QUESTION being
                      read, so it has to show its options. readOnly alone draws
                      the answer that was given, and there isn't one. */}
                  {q.blocks.map(b => (
                    <Block
                      key={b.id}
                      block={b}
                      value={undefined}
                      onChange={() => {}}
                      readOnly
                      preview
                      correct={showAnswers ? keys[b.id] : undefined}
                    />
                  ))}
                  {/* Not gated on the answers toggle: "no key exists" is a fact
                      about the question, not a key being revealed. */}
                  {q.state === 'hand' && (
                    <p className="qb-hand-note">
                      Marked by hand — a written answer carries no key. Marks and marking criteria
                      are set in whichever paper takes this question.
                    </p>
                  )}
                  {q.state === 'unkeyed' && (
                    <p className="qb-unkeyed-note">
                      No correct answer set, so a paper taking this question cannot mark it.
                    </p>
                  )}
                  <SimilarList
                    list={similar.pairs[q.section.id]}
                    titleOf={id => questions.find(x => x.section.id === id)?.section.title}
                    onOpen={id => setOpen(prev => new Set(prev).add(id))}
                  />
                  <ItemStatPanel stat={itemStats[q.section.id]} />
                  <div className="qb-row-acts">
                    <Link to={`/trainer/question-bank/${bank?.id}`} className="qb-open">Open editor</Link>
                    <span className="qb-why">Opens the bank editor at the top.</span>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

// How a question has worked in real classes (A2), on its row: the share of
// marks people earned, and a flag once there are enough answers to judge.
const SEPARATES = { yes: 'Separates strong from weak', weakly: 'Separates a little', no: "Doesn't separate", reversed: 'Strong people do worse' };
const FLAG = { check: 'Check the key or wording', easy: 'Too easy?', hard: 'Very hard' };

function ItemStatChip({ stat }) {
  if (!stat || !stat.scored) return null;
  const v = itemVerdict(stat);
  return (
    <>
      <span className={`qb-stat${v.enough ? '' : ' is-thin'}`}>
        <b>{Math.round(stat.facility * 100)}%</b> of marks · {stat.scored} answer{stat.scored === 1 ? '' : 's'}
      </span>
      {v.flag && <span className={`qb-pill ${v.flag === 'check' ? 'is-bad' : 'is-hand'}`}>{FLAG[v.flag]}</span>}
    </>
  );
}

function ItemStatPanel({ stat }) {
  if (!stat || !stat.scored) {
    return <p className="qb-stat-note">Not sat in a closed class yet. Figures appear here after the first class that took it is closed.</p>;
  }
  const v = itemVerdict(stat);
  const last = stat.last_recorded ? new Date(stat.last_recorded).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  return (
    <div className="qb-stat-panel">
      <div className="qb-stat-figs">
        <span><b>{Math.round(stat.facility * 100)}%</b> of the marks earned on average</span>
        {v.separates && (
          <span>
            <b>{SEPARATES[v.separates]}</b>
            {' '}(top third {Math.round(stat.top_frac * 100)}%, bottom third {Math.round(stat.bottom_frac * 100)}%)
          </span>
        )}
      </div>
      <p className="qb-stat-src">
        From {stat.classes} class{stat.classes === 1 ? '' : 'es'}, {stat.scored} marked answer{stat.scored === 1 ? '' : 's'}{last ? ` · last recorded ${last}` : ''}.
        {!v.enough && <> Too few to judge yet: flags appear from {MIN_ANSWERS} answers.</>}
        {v.flag === 'check' && <> People who did well overall scored lower here than people who struggled. That usually means a wrong key or confusing wording.</>}
      </p>
    </div>
  );
}

// "Similar in this bank" (T2): the closest other questions by meaning.
function SimilarList({ list, titleOf, onOpen }) {
  if (!list?.length) return null;
  return (
    <p className="qb-similar">
      <span className="qb-similar-h">Similar in this bank:</span>
      {list.map(x => (
        <button key={x.other_id} type="button" className="qb-similar-q" onClick={() => onOpen(x.other_id)}>
          {titleOf(x.other_id) || 'a question'} <span className="qb-similar-n">{x.similarity >= NEAR_COPY ? 'nearly the same' : `${Math.round(x.similarity * 100)}%`}</span>
        </button>
      ))}
    </p>
  );
}
