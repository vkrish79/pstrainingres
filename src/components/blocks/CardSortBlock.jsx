import { useState } from 'react';
import { useCardDrag } from '../../hooks/useCardDrag.jsx';

const TRAY = '__tray__';

// Card sort: drag (or tap-to-place) labelled cards into category buckets.
// config: { prompt, cards: [{id,text}], buckets: [{id,label}] }.
// Value shape: { [cardId]: bucketId }. Correct mapping lives in the answer key.
export default function CardSortBlock({ block, value, onChange, readOnly = false }) {
  const cfg = block.config || {};
  const cards = Array.isArray(cfg.cards) ? cfg.cards : [];
  const buckets = Array.isArray(cfg.buckets) ? cfg.buckets : [];
  const placement = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const [selected, setSelected] = useState(null);

  function place(cardId, bucketId) {
    const next = { ...placement };
    if (bucketId === TRAY) delete next[cardId];
    else next[cardId] = bucketId;
    onChange(next);
    setSelected(null);
  }

  const drag = useCardDrag({
    disabled: readOnly,
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
        onClick={readOnly ? undefined : (e) => e.stopPropagation()}
        {...(readOnly ? {} : drag.handlers(card.id, card.text))}
      >
        {card.text}
      </span>
    );
  }

  // When a card is selected (tap-to-place), tapping a zone drops it there.
  const zoneTap = (bucketId) => (readOnly || !selected ? undefined : () => place(selected, bucketId));

  return (
    <div className="wb-field wb-cardsort">
      {cfg.prompt && <div className="wb-label">{cfg.prompt}</div>}
      {!readOnly && (
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

      <div className="cardsort-buckets">
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
    </div>
  );
}
