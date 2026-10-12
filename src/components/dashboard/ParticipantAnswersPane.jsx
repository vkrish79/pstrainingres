import Block from '../blocks/Block.jsx';
import NoteRow from './NoteRow.jsx';
import PrepCallout from '../PrepCallout.jsx';
import { TONE_LABEL } from './SessionCockpit.jsx';
import { itemsForExercise } from '../../lib/prepAttach.js';
import { sanitizeNotesHtml } from '../../lib/notesRichText.js';

// One participant's answers on the Room tab, with Prev / Next to step
// through the class.
export default function ParticipantAnswersPane({
  selected, selectedParticipantId, selectedAnswers, selectedNotes, onBack,
  stepPeople, stepAt, stepPrev, stepNext, stepTo, stayOnExercise, setStayOnExercise,
  sections, blocks, participantNotes, prepBy, standaloneBy, prepLayout, saveNote, deleteNote,
}) {
  return (
    <aside className="answers-pane">
      <header className="answers-pane-header">
        <button type="button" className="ghost answers-back" onClick={onBack} title="Back to the class (Esc)">&larr; Back to the class</button>
        <div className="answers-stepper" role="group" aria-label="Step through participants">
          <button type="button" className="answers-step" onClick={() => stepTo(stepPrev)} disabled={!stepPrev} title="Previous person (←)" aria-label="Previous person">‹ Prev</button>
          <div className="answers-who">
            <h2>{selected.full_name}'s answers</h2>
            {stepAt >= 0 && <span className="answers-count">{stepAt + 1} of {stepPeople.length}</span>}
          </div>
          <button type="button" className="answers-step" onClick={() => stepTo(stepNext)} disabled={!stepNext} title="Next person (→)" aria-label="Next person">Next ›</button>
        </div>
        <label className="answers-stay">
          <input type="checkbox" checked={stayOnExercise} onChange={e => setStayOnExercise(e.target.checked)} />
          Stay on this exercise
        </label>
        <span className="answers-keys" aria-hidden="true">
          <kbd>←</kbd><kbd>→</kbd> person <kbd>Esc</kbd> back <kbd>1</kbd>–<kbd>5</kbd> tabs
        </span>
      </header>
      <nav className="answers-strip" aria-label="Participants">
        {stepPeople.map(x => (
          <button
            key={x.id}
            type="button"
            className="answers-chip"
            aria-pressed={x.id === selectedParticipantId}
            onClick={() => stepTo(x.id)}
            title={`${x.name} — ${TONE_LABEL[x.tone]}`}
          >
            <span className={`cockpit-dot tone-${x.tone}`} aria-hidden="true" />
            {x.hand && <span aria-label="Asked for help">✋</span>}
            {x.name}
          </button>
        ))}
      </nav>
      <div className="answers-pane-body">
        {sections.map(sec => {
          const pNote = participantNotes[selected.id]?.[sec.id]?.note;
          const prepItems = itemsForExercise(prepBy[selected.id]?.[sec.id]?.content, standaloneBy[selected.id], prepLayout, sec.id);
          return (
            <section key={sec.id} className="wb-section answers-section" data-answers-section={sec.id}>
              <h3>{sec.title}</h3>
              <PrepCallout heading="Prep" items={prepItems} />
              {pNote && (
                <div className="participant-note-readonly">
                  <span className="participant-note-readonly-label">Participant note</span>
                  <div className="participant-note-readonly-text" dangerouslySetInnerHTML={{ __html: sanitizeNotesHtml(pNote) }} />
                </div>
              )}
              {blocks.filter(b => b.section_id === sec.id).map(b => (
                <div key={b.id} className="answers-block">
                  <Block block={b} value={selectedAnswers[b.id]?.value} onChange={() => {}} readOnly />
                  {(b.block_type === 'field' || b.block_type === 'table') && (
                    <NoteRow
                      note={selectedNotes[b.id]}
                      participantId={selected.id}
                      blockId={b.id}
                      onSaveNote={saveNote}
                      onDeleteNote={deleteNote}
                    />
                  )}
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
