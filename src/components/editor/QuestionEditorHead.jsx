import { Link } from 'react-router-dom';
import KebabMenu from '../KebabMenu.jsx';
import SaveStatus from '../SaveStatus.jsx';

// The one-row header of the assessment and question bank editors — the same
// shape as the workbook editor's (.wbe-head), in place of the old hero card
// plus a separate title card plus a draft bar.
//
// The STAGED save stays. Moving, adding and removing questions is held until
// Save (hooks/useAssessmentDraft.js); wording, keys and marks save themselves
// and show on the SaveStatus chip. While there are staged changes the header
// says so with Save / Discard beside it, and it is sticky, so the Save is
// never a scroll away — the reason the old draft bar was sticky.
export default function QuestionEditorHead({
  backTo, backLabel, kindLabel, titleLabel,
  title, onTitleChange, onTitleCommit,
  saves, onReload, draft, onSaveDraft, savedHint,
  menuItems, children,
}) {
  return (
    <section className="wbe-head qe-head">
      <Link to={backTo} className="wbe-back">{backLabel}</Link>
      <input
        className="wbe-title"
        value={title}
        onChange={e => onTitleChange(e.target.value)}
        onBlur={onTitleCommit}
        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
        aria-label={titleLabel}
        data-tip={`Click to rename the ${kindLabel.toLowerCase()}`}
      />
      <span className="wbe-sub">{kindLabel}</span>
      <div className="wbe-actions">
        {draft.dirty ? (
          <span className="qe-draft" data-tip={savedHint}>
            <span className="qe-draft-text">● Unsaved question changes</span>
            <button type="button" className="qe-draft-save" disabled={draft.saving} onClick={onSaveDraft}>
              {draft.saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="qe-draft-discard" disabled={draft.saving} onClick={draft.discard}>
              Discard
            </button>
          </span>
        ) : (
          <SaveStatus tracker={saves} onReload={onReload} />
        )}
        {children}
        <KebabMenu label={`More ${kindLabel.toLowerCase()} actions`} items={menuItems} />
      </div>
    </section>
  );
}

// A failed staged save, as a sentence. It used to be a code/message/details/
// hint table — useful to whoever debugs it, so the detail is still here, small.
//
// The save runs in steps (useAssessmentDraft.save), so the steps before the
// failing one ARE stored. Saving the same draft again would replay them — new
// questions would be inserted twice — so this points to a reload, never to
// "try again".
export function DraftSaveError({ error, onDismiss, onReload }) {
  if (!error) return null;
  const real = v => v && v !== '(none)';
  const detail = [error.message, error.details, error.hint].filter(real).join(' — ');
  return (
    <div className="qe-save-error" role="alert">
      <p className="qe-save-error-head">
        Couldn't finish saving the question changes — it stopped at “{error.stage}”.
        Anything before that step was stored; nothing after it was. Reload to see
        what was kept before changing more.
      </p>
      {detail && <p className="qe-save-error-detail">{real(error.code) ? `${error.code}: ` : ''}{detail}</p>}
      <div className="qe-save-error-actions">
        {onReload && <button type="button" className="qe-save-error-reload" onClick={onReload}>Reload</button>}
        <button type="button" className="qe-save-error-dismiss" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}
