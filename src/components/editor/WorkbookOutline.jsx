import { useEffect, useMemo, useRef, useState } from 'react';
import { heatLevel } from '../../lib/configDiff.js';
import '../../styles/editor-outline.css';

// The workbook editor's outline: every group heading and exercise, in order,
// with a find box. Picking one shows that exercise alone in the editor (and in
// the preview); "All exercises" goes back to the one long scroll.
//
// A real workbook runs to 31 exercises and ~50 sections; without this the only
// way to reach Exercise 23 was to scroll for it.
//
// The find box searches the wording inside each exercise as well as its title,
// because "Exercise 23" is a number and what the author remembers is the
// scenario ("name correction", "Ms. Apasra").
export const ALL = 'all';

function blockText(b) {
  const c = b.config || {};
  const parts = [];
  if (c.html) parts.push(c.html.replace(/<[^>]+>/g, ' '));
  if (c.label) parts.push(c.label);
  if (c.caption) parts.push(c.caption);
  if (c.prompt) parts.push(c.prompt);
  if (c.text) parts.push(c.text);
  (c.options || []).forEach(o => parts.push(typeof o === 'string' ? o : o?.text || ''));
  (c.headers || []).forEach(h => parts.push(h || ''));
  (c.rows || []).forEach(row => (row || []).forEach(cell => {
    if (cell?.text) parts.push(cell.text);
    (cell?.parts || []).forEach(p => typeof p === 'string' && parts.push(p));
  }));
  return parts.join(' ').toLowerCase();
}

export default function WorkbookOutline({
  sections,
  blocks,
  focusId,
  activeSectionId = null,
  onPick,
  prepBySection = null,
  heatBySection = null,
}) {
  const [filter, setFilter] = useState('');
  const listRef = useRef(null);

  const counts = useMemo(() => {
    const m = new Map();
    blocks.forEach(b => m.set(b.section_id, (m.get(b.section_id) || 0) + 1));
    return m;
  }, [blocks]);

  const textBySection = useMemo(() => {
    const m = new Map();
    blocks.forEach(b => m.set(b.section_id, `${m.get(b.section_id) || ''} ${blockText(b)}`));
    return m;
  }, [blocks]);

  const q = filter.trim().toLowerCase();
  const shown = q
    ? sections.filter(s => s.kind !== 'group'
      && (s.title.toLowerCase().includes(q) || (textBySection.get(s.id) || '').includes(q)))
    : sections;

  // In one-at-a-time view the picked exercise is the current one; in the long
  // scroll it is whichever exercise is on screen.
  const current = focusId === ALL ? activeSectionId : focusId;

  // Keep the current row in view as you step with Prev / Next or scroll.
  useEffect(() => {
    const el = listRef.current?.querySelector('.wo-item.is-current');
    el?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const exerciseCount = sections.filter(s => s.kind !== 'group').length;
  const prepCount = prepBySection ? sections.filter(s => prepBySection.get(s.id)).length : 0;

  return (
    <aside className="wo" aria-label="Workbook outline">
      <div className="wo-head">
        <button
          type="button"
          className={`wo-all${focusId === ALL ? ' is-current' : ''}`}
          onClick={() => onPick(ALL)}
          data-tip="Every exercise on one long page"
        >
          All exercises <span className="wo-n">{exerciseCount}</span>
        </button>
        <input
          className="wo-find"
          type="search"
          placeholder="Find an exercise or wording…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          aria-label="Find an exercise"
        />
      </div>

      <div className="wo-list" ref={listRef}>
        {shown.length === 0 && <p className="wo-empty">Nothing matches “{filter.trim()}”</p>}
        {shown.map(s => {
          const heat = heatBySection?.get(s.id);
          const open = heat?.openSessions || 0;
          const isCur = current === s.id;
          if (s.kind === 'group') {
            return (
              <button
                key={s.id}
                type="button"
                className={`wo-group${isCur ? ' is-current wo-item' : ''}`}
                onClick={() => onPick(s.id)}
              >
                {s.title}
              </button>
            );
          }
          return (
            <button
              key={s.id}
              type="button"
              className={`wo-item${isCur ? ' is-current' : ''}`}
              onClick={() => onPick(s.id)}
              aria-current={isCur ? 'true' : undefined}
            >
              <span className={`wo-prep${prepBySection?.get(s.id) ? ' on' : ''}`} aria-hidden />
              <span className="wo-title">{s.title}</span>
              {open > 0 && (
                <span
                  className={`heat-dot heat-l${heatLevel(open)} wo-heat`}
                  data-tip={`${open} session${open === 1 ? '' : 's'} reworded this — not yet reviewed`}
                />
              )}
              <span className="wo-n">{counts.get(s.id) || 0}</span>
            </button>
          );
        })}
      </div>

      {prepBySection && prepCount > 0 && (
        <div className="wo-foot">
          <span className="wo-prep on" aria-hidden /> needs prep · {prepCount} of {exerciseCount}
        </div>
      )}
    </aside>
  );
}
