import { useState } from 'react';
import { diffConfigs } from '../../lib/configDiff.js';
import { adoptLineIntoMaster } from '../../lib/adoptChange.js';
import { setLineDecision } from '../../hooks/useWorkbookEditHeat.js';

// One session's net change to one block, decided a LINE at a time.
//
// Each line gets its own answer because one table edit is usually several
// unrelated things — a corrected route and a corrected phone number — and they
// deserve separate decisions.
//
// "Adopted" writes that line into the master workbook. It is a real edit, and
// the only place in this feature that changes a workbook. Everything else here
// still only records what was concluded.
//
// Shared by the marker modal, the workbook-wide modal and the change log page,
// so all three behave identically and a decision made in one shows in the rest.

const STATUS_LABEL = {
  adopted: 'Adopted into the master',
  not_needed: 'Not needed in the master',
};

export function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// A group's identity, matching the key the RPCs use. NULLs are meaningful
// (an edit whose block could not be mapped), so they are kept, not defaulted.
export function keyOf(r) {
  return `${r.master_block_id || '-'}|${r.session_id || '-'}|${r.actor_id || '-'}`;
}

export default function ChangeEntry({
  row: r, busy = false, onResolve, blockLabel = null,
  lineDecisions = {}, onChanged,
  // workbook_edit_detail returns neither of these — the marker modal already
  // knows them from what was clicked, so they come in as props and the row is
  // only the fallback (the whole-workbook views do carry them).
  workbookId = null, sectionId = null,
}) {
  const diffs = diffConfigs(r.block_type, r.before_config, r.after_config);
  const allKeys = diffs.map(d => d.key);

  const [lineBusy, setLineBusy] = useState(null);
  const [conflicts, setConflicts] = useState({});   // lineKey -> master's current value
  const [lineError, setLineError] = useState('');

  async function record(lineKey, status) {
    const { error } = await setLineDecision({
      workbookId: workbookId ?? r.master_workbook_id ?? null,
      sectionId: sectionId ?? r.master_section_id ?? null,
      blockId: r.master_block_id,
      sessionId: r.session_id,
      actorId: r.actor_id,
      lineKey,
      status,
      allLineKeys: allKeys,
    });
    if (error) { setLineError(error); return false; }
    return true;
  }

  async function decideLine(d, status, force = false) {
    setLineBusy(d.key);
    setLineError('');

    if (status === 'adopted') {
      const res = await adoptLineIntoMaster({
        masterBlockId: r.master_block_id,
        lineKey: d.key,
        expected: d.before,
        value: d.after,
        force,
      });
      if (res.error) { setLineError(res.error); setLineBusy(null); return; }
      if (res.conflict) {
        // Stop and show what the master actually says. Adopting from here is
        // an explicit second click, never the default.
        setConflicts(c => ({ ...c, [d.key]: res.masterValue }));
        setLineBusy(null);
        return;
      }
    }

    const ok = await record(d.key, status);
    setConflicts(c => { const n = { ...c }; delete n[d.key]; return n; });
    setLineBusy(null);
    if (ok) onChanged?.();
  }

  // Every line still waiting, in one go. Stops at the first conflict rather
  // than skipping past it — a line the master has moved on from is exactly the
  // one worth looking at.
  async function adoptAll() {
    setLineBusy('__all__');
    setLineError('');
    for (const d of diffs) {
      if (lineDecisions[d.key]) continue;
      const res = await adoptLineIntoMaster({
        masterBlockId: r.master_block_id,
        lineKey: d.key,
        expected: d.before,
        value: d.after,
      });
      if (res.error) { setLineError(res.error); break; }
      if (res.conflict) {
        setConflicts(c => ({ ...c, [d.key]: res.masterValue }));
        setLineError('Stopped: the master has moved on for one of these lines.');
        break;
      }
      const ok = await record(d.key, 'adopted');
      if (!ok) break;
    }
    setLineBusy(null);
    onChanged?.();
  }

  const undecided = diffs.filter(d => !lineDecisions[d.key]).length;

  return (
    <article className={`eh-entry${r.is_open ? '' : ' eh-entry--resolved'}`}>
      <header className="eh-entry-head">
        <span className="eh-session">{r.session_name || 'Deleted session'}</span>
        {r.city_code && <span className="eh-chip">{r.city_code}</span>}
        {/* Only the whole-workbook views pass this — inside the marker modal
            you already know which block you clicked. */}
        {blockLabel && <span className="eh-chip eh-chip--block">{blockLabel}</span>}
        {!r.is_open && (
          <span className={`eh-pill eh-pill--${r.status === 'adopted' ? 'adopted' : 'notneeded'}`}>
            {r.status === 'adopted' ? '✓ Adopted' : '✕ Not needed'}
          </span>
        )}
        <span className="eh-when">{formatWhen(r.last_changed_at)}</span>
      </header>
      <div className="eh-meta">
        <span>{r.actor_name || 'Unknown trainer'}</span>
        {Number(r.edit_count) > 1 && (
          <span className="muted"> · {r.edit_count} saves, net change shown</span>
        )}
      </div>

      {lineError && <p className="error eh-line-error">{lineError}</p>}

      {diffs.length === 0 ? (
        <p className="muted eh-nodiff">Changed outside the editable text.</p>
      ) : (
        <ul className="eh-diffs">
          {diffs.map(d => {
            const decided = lineDecisions[d.key];
            const conflict = conflicts[d.key];
            const busyLine = lineBusy === d.key || lineBusy === '__all__';
            return (
              <li key={d.key} className={`eh-diff${decided ? ' eh-diff--decided' : ''}`}>
                <span className="eh-diff-label">{d.label}</span>
                {d.formattingOnly ? (
                  <span className="eh-formatting">Formatting only — same wording</span>
                ) : (
                  <div className="eh-diff-pair">
                    {/* "Before" rather than "Master": if two trainers edited the
                        same clone block, the second one's starting point was the
                        first one's wording. */}
                    <div className="eh-was">
                      <span className="eh-tag">Before</span>
                      <span>{d.beforeShown || <em className="muted">(empty)</em>}</span>
                    </div>
                    <div className="eh-now">
                      <span className="eh-tag">After</span>
                      <span>{d.afterShown || <em className="muted">(empty)</em>}</span>
                    </div>
                  </div>
                )}

                {conflict !== undefined && (
                  <div className="eh-conflict">
                    <p>
                      <strong>The master has moved on.</strong> It now says
                      {' '}“{String(conflict) || '(empty)'}”, not what this session started from.
                      Adopting will replace that.
                    </p>
                    <div className="eh-line-actions">
                      <button
                        type="button" className="ghost" disabled={busyLine}
                        onClick={() => decideLine(d, 'adopted', true)}
                      >
                        Adopt anyway
                      </button>
                      <button
                        type="button" className="ghost"
                        onClick={() => setConflicts(c => {
                          const n = { ...c }; delete n[d.key]; return n;
                        })}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {conflict === undefined && (
                  decided ? (
                    <div className="eh-line-decided">
                      <span className={`eh-pill eh-pill--${decided.status === 'adopted' ? 'adopted' : 'notneeded'}`}>
                        {decided.status === 'adopted' ? '✓ Written into the master' : '✕ Not needed'}
                      </span>
                      {decided.by && <span className="muted"> by {decided.by}</span>}
                      <button
                        type="button" className="link-btn" disabled={busyLine}
                        title={decided.status === 'adopted'
                          ? 'Reopens the decision. The wording already written into the master stays — edit the master to undo that.'
                          : 'Reopens the decision.'}
                        onClick={() => decideLine(d, 'open')}
                      >
                        undo
                      </button>
                    </div>
                  ) : (
                    <div className="eh-line-actions">
                      <button
                        type="button" className="ghost" disabled={busyLine}
                        onClick={() => decideLine(d, 'adopted')}
                      >
                        {busyLine ? 'Saving…' : '✓ Adopt this'}
                      </button>
                      <button
                        type="button" className="ghost" disabled={busyLine}
                        onClick={() => decideLine(d, 'not_needed')}
                      >
                        ✕ Not needed
                      </button>
                    </div>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!r.is_open && (
        <p className="eh-review-meta">
          {STATUS_LABEL[r.status] || r.status}
          {r.reviewed_by_name ? ` by ${r.reviewed_by_name}` : ''}
          {r.reviewed_at ? ` · ${formatWhen(r.reviewed_at)}` : ''}
          {r.note ? <span className="eh-review-note">“{r.note}”</span> : null}
        </p>
      )}

      <div className="eh-entry-actions">
        {undecided > 1 && (
          <button
            type="button" className="ghost" disabled={lineBusy !== null}
            onClick={adoptAll}
          >
            {lineBusy === '__all__' ? 'Adopting…' : `✓ Adopt all ${undecided}`}
          </button>
        )}
        {!r.is_open && (
          <button
            type="button" className="ghost" disabled={busy}
            onClick={() => onResolve?.(r, 'open')}
          >
            {busy ? 'Saving…' : '↩ Reopen'}
          </button>
        )}
      </div>
    </article>
  );
}
