import '../../styles/question-bank.css';
import { NEAR_COPY } from '../../hooks/useBankSimilar.js';

// "Already in the bank" (T2) under a question in the bank editor: the other
// questions in this bank that read most alike, by meaning. Checked again a
// few seconds after its wording is saved.
//   list    — [{ other_id, similarity }] from useBankSimilar().pairs
//   titleOf — section id → its title
export default function SimilarInBank({ list, titleOf }) {
  if (!list?.length) return null;
  const n = list.length;
  return (
    <p className="q-similar" role="note">
      <span className="q-similar-h">{n} similar already in the bank:</span>
      {list.map(x => (
        <span key={x.other_id} className="q-similar-q">
          {titleOf(x.other_id) || 'a question'}
          <span className="q-similar-n">{x.similarity >= NEAR_COPY ? ' · nearly the same' : ` · ${Math.round(x.similarity * 100)}%`}</span>
        </span>
      ))}
    </p>
  );
}
