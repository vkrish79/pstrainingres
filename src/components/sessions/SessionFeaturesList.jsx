import { FEATURES, FEATURE_BY_KEY, featureOn } from '../../lib/sessionFeatures.js';
import '../../styles/session-features.css';

// "What this class uses": the tick list in the New session drawer and in the
// cockpit's Session features panel. Controlled — `off` in, `onChange(nextOff)`
// out — so the drawer can hold it until Create and the panel until Save.
//
//   facts  — what the program brings, to word each line and grey out what it
//            lacks: { workbookTitle, hasPrep, materialsCount, assessmentTitle }.
//            A missing fact (still loading) never greys anything out.
//   locked — { key: reason } for features that can't be changed right now
//            (a quiz running); the box keeps its state and says why.
//   kept   — { key: label } for "Has answers, kept" beside features with data.
const GROUPS = [
  { id: 'work', title: 'What participants work in' },
  { id: 'room', title: 'In the room' },
];

function describe(key, facts) {
  switch (key) {
    case 'workbook': return facts.workbookTitle
      ? `${facts.workbookTitle}. Turn off for a paper-only or talk-only class.`
      : 'The exercises participants fill in. Turn off for a paper-only or talk-only class.';
    case 'prep': return 'Personal prep notes beside each exercise.';
    case 'materials': return facts.materialsCount
      ? `${facts.materialsCount} handout${facts.materialsCount === 1 ? '' : 's'} and quick-reference PDFs from the program.`
      : 'Handouts and quick-reference PDFs from the program.';
    case 'assessment': return facts.assessmentTitle
      ? `${facts.assessmentTitle}, unlocked by you when it's time.`
      : 'Lets you attach an assessment to this class later.';
    case 'quiz': return 'Quizzes you launch on the projector, answered on phones.';
    case 'polls': return 'Library polls and ad-hoc ones typed during class.';
    case 'review': return "Show the class's grouped answers to an exercise and mark them together.";
    case 'spotlight': return "Send everyone to the exercise you're on.";
    case 'hand': return 'A help button for participants. Hands show in your bar on every tab.';
    case 'confidence': return '"How did that go?" after each exercise. Feeds the heat board\'s How it went row.';
    case 'pulse': return 'A short question at the end of each day. Goes to Analytics › Course feedback.';
    case 'amadeus': return 'Participants share their Amadeus screen with you. Shows in the Screens view.';
    default: return '';
  }
}

// Why a feature can't be used at all in this class, or '' if it can.
function unavailable(key, off, facts) {
  const f = FEATURE_BY_KEY[key];
  if (f.needs && off.includes(f.needs)) return 'Needs Workbook exercises';
  if (key === 'prep' && facts.hasPrep === false) return 'This workbook has no prep template';
  if (key === 'materials' && facts.materialsCount === 0) return 'This program has no materials';
  return '';
}

export default function SessionFeaturesList({ off, onChange, facts = {}, locked = {}, kept = {}, idPrefix = 'sf', isNew = false, warning = null }) {
  function set(key, isOn) {
    const next = new Set(off);
    if (isOn) next.delete(key); else next.add(key);
    onChange([...next]);
  }
  function setRoom(isOn) {
    const next = new Set(off);
    for (const f of FEATURES) {
      if (f.group !== 'room' || locked[f.key]) continue;
      if (isOn) next.delete(f.key); else next.add(f.key);
    }
    onChange([...next]);
  }

  let used = 0; let total = 0;
  for (const f of FEATURES) {
    if (unavailable(f.key, off, facts)) continue;
    total += 1;
    if (featureOn(off, f.key)) used += 1;
  }
  // Only what the trainer can act on: a feature the program simply lacks
  // (no materials) is not "off for this class".
  const offList = FEATURES
    .filter(f => !unavailable(f.key, [], facts) && !featureOn(off, f.key))
    .map(f => (f.needs && !off.includes(f.key) ? `${f.name} (needs workbook)` : f.name));

  return (
    <fieldset className={`sf${isNew ? ' sf--new' : ''}`}>
      <div className="sf-top">
        <legend className="sf-title">What this class uses</legend>
        <span className="sf-count">{used} of {total} on</span>
      </div>
      {GROUPS.map(g => (
        <div key={g.id} className="sf-group">
          <h4 className="sf-group-title">{g.title}</h4>
          {g.id === 'room' && (
            <div className="sf-links">
              <button type="button" onClick={() => setRoom(true)}>Tick all</button>
              <button type="button" onClick={() => setRoom(false)}>Untick all room interactions</button>
            </div>
          )}
          {FEATURES.filter(f => f.group === g.id).map(f => {
            const why = unavailable(f.key, off, facts);
            const lock = locked[f.key];
            const id = `${idPrefix}-${f.key}`;
            return (
              <label key={f.key} htmlFor={id} className={`sf-item${why ? ' is-na' : ''}`}>
                <input
                  id={id}
                  type="checkbox"
                  checked={!why && featureOn(off, f.key)}
                  disabled={!!why || !!lock}
                  onChange={e => set(f.key, e.target.checked)}
                />
                <span className="sf-name">
                  {f.name}
                  {why && <span className="sf-pill is-grey">{why}</span>}
                  {kept[f.key] && <span className="sf-pill is-kept">{kept[f.key]}</span>}
                  {lock && <span className="sf-pill">{lock}</span>}
                </span>
                <span className="sf-desc">{describe(f.key, facts)}</span>
              </label>
            );
          })}
        </div>
      ))}
      {warning}
      <p className="sf-summary">
        {offList.length === 0
          ? <><strong>Everything on.</strong> This class works like every session today.</>
          : <><strong>Off for this class:</strong> {offList.join(', ')}.</>}
      </p>
    </fieldset>
  );
}
