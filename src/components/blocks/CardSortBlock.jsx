import { useState } from 'react';
import { useCardDrag } from '../../hooks/useCardDrag.jsx';

const TRAY = '__tray__';

// Card sort: drag (or tap-to-place) labelled cards into category buckets.
// config: { prompt, cards: [{id,text}], buckets: [{id,label}] }.
// Value shape: { [cardId]: bucketId }. Correct mapping lives in the answer key.
// `correct` — the key, { [cardId]: bucketId }, drawn only by the super-trainer
// previews that pass it. Showing it means laying the cards out where they
// belong, which is the whole question answered in one look.
export default function CardSortBlock({ block, value, onChange, readOnly = false, correct = undefined }) {
  const cfg = block.config || {};
  const cards = Array.isArray(cfg.cards) ? cfg.cards : [];
  const buckets = Array.isArray(cfg.buckets) ? cfg.buckets : [];
  const key = correct && typeof correct === 'object' && !Array.isArray(correct) ? correct : null;
  const placement = key || (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
  // A board showing the answer is not something to drag cards around on.
  const inert = readOnly || !!key;
  const [selected, setSelected] = useState(null);

  function place(cardId, bucketId) {
    const next = { ...placement };
    if (bucketId === TRAY) delete next[cardId];
    else next[cardId] = bucketId;
    onChange(next);
    setSelected(null);
  }

  const drag = useCardDrag({
    disabled: inert,
    onDrop: place,
    onTap: (cardId) => setSelected((s) => (s === cardId ? null : cardId)),
  });

  const cardsIn = (bucketId) =>
    cards.filter((c) => (bucketId === TRAY ? !placement[c.id] : placement[c.id] === bucketId));

  function renderCard(card) {
    const isSel = selected === card.id;
    return (
      <span
        key={card.id}
        className={`sort-card ${isSel ? 'selected' : ''} ${drag.draggingId === card.id ? 'dragging' : ''}`}
        // Stop the tap from also reaching the enclosing zone's tap-to-place
        // handler — selecting a card and placing the previously-selected one
        // must not happen in the same tap.
        onClick={inert ? undefined : (e) => e.stopPropagation()}
        {...(inert ? {} : drag.handlers(card.id, card.text))}
      >
        {card.text}
      </span>
    );
  }

  // When a card is selected (tap-to-place), tapping a zone drops it there.
  const zoneTap = (bucketId) => (inert || !selected ? undefined : () => place(selected, bucketId));

  return (
    <div className="wb-field wb-cardsort">
      {cfg.prompt && <div className="wb-label">{cfg.prompt}</div>}
      {!inert && (
        <p className="cardsort-hint">Drag a card into a category — or tap a card, then tap a category.</p>
      )}

      <div
        className={`cardsort-tray ${selected ? 'droppable' : ''}`}
        data-dropzone={TRAY}
        onClick={zoneTap(TRAY)}
      >
        <span className="cardsort-tray-label">Cards</span>
        <div className="cardsort-cards">
          {cardsIn(TRAY).map(renderCard)}
          {cardsIn(TRAY).length === 0 && <span className="muted">All cards sorted.</span>}
        </div>
      </div>

      <div className={`cardsort-buckets ${key ? 'answer' : ''}`}>
        {buckets.map((b) => (
          <div
            key={b.id}
            className={`cardsort-bucket ${selected ? 'droppable' : ''}`}
            data-dropzone={b.id}
            onClick={zoneTap(b.id)}
          >
            <div className="cardsort-bucket-label">{b.label}</div>
            <div className="cardsort-cards">
              {cardsIn(b.id).map(renderCard)}
              {cardsIn(b.id).length === 0 && <span className="muted">Drop here</span>}
            </div>
          </div>
        ))}
      </div>
      {drag.ghost}
      {key && <p className="wb-answer-note"><span aria-hidden="true">✓</span> Each card is shown in its correct category.</p>}
    </div>
  );
}
