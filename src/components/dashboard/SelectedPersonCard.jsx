import { TONE_LABEL } from './SessionCockpit.jsx';
import { ago } from '../../lib/sessionPace.js';

// The Selected card beside the class: one person's state, their raised hand,
// and their actions (the same ⋯ the table row has, passed in as `actions`).
export default function SelectedPersonCard({ sp, pace, help, helpError, setHelpError, onClear, onOpenAnswers, actions }) {
  const delta = sp.answered - pace;
  return (
    <section className="cockpit-card cockpit-selected" aria-label={`${sp.name}, selected`}>
      <header className="cockpit-selected-head">
        <h3 className="cockpit-card-title">Selected</h3>
        <button type="button" className="icon-btn" onClick={onClear} aria-label="Clear selection">×</button>
      </header>
      <div className="cockpit-selected-name">
        <span className={`cockpit-dot tone-${sp.tone}`} aria-hidden="true" />
        {sp.name}
        <span className={`cockpit-tone tone-${sp.tone}`}>{TONE_LABEL[sp.tone]}</span>
      </div>
      {sp.hand && (
        <div className={`cockpit-hand${sp.hand.acknowledged_at ? ' is-coming' : ''}`}>
          <div>
            <strong>✋ {sp.hand.acknowledged_at ? `${sp.hand.acknowledged_by_name || 'Someone'} is on the way` : 'Asked for help'}</strong>
            <span>{ago(sp.hand.raised_at)}{sp.hand.section_title ? ` · ${sp.hand.section_title}` : ''}</span>
          </div>
          {sp.hand.acknowledged_at ? (
            <button type="button" className="cockpit-hand-btn" onClick={async () => { setHelpError(''); const { error: e } = await help.resolve(sp.hand.id); if (e) setHelpError(e.message); }}>✓ Helped</button>
          ) : (
            <button type="button" className="cockpit-hand-btn is-primary" onClick={async () => { setHelpError(''); const { error: e } = await help.acknowledge(sp.hand.id); if (e) setHelpError(e.message); }}>👋 I'm coming over</button>
          )}
        </div>
      )}
      {helpError && <p className="error">{helpError}</p>}
      {sp.dropped && (
        <p className="cockpit-selected-reason">
          {sp.p.deactivation_reason || 'No reason recorded'}
          <span> — {sp.p.deactivated_by_name ? `${sp.p.deactivated_by_name}, ` : ''}{new Date(sp.p.deactivated_at).toLocaleDateString()}</span>
        </p>
      )}
      <dl className="cockpit-facts">
        <div><dt>Progress</dt><dd>{sp.answered} / {sp.total}</dd></div>
        <div>
          <dt>Against class pace</dt>
          <dd className={sp.dropped ? '' : sp.tone === 'bad' ? 'is-bad' : delta < 0 ? 'is-warn' : 'is-ok'}>
            {sp.dropped ? '–' : delta === 0 ? 'On pace' : `${delta > 0 ? '+' : ''}${delta}`}
          </dd>
        </div>
        <div><dt>On now</dt><dd>{sp.presence.label}</dd></div>
        <div><dt>Last activity</dt><dd>{ago(sp.lastActive)}</dd></div>
        {sp.noPrep && <div><dt>Prep</dt><dd className="is-warn">None allocated</dd></div>}
      </dl>
      <div className="cockpit-selected-actions">
        <button type="button" className="cockpit-open-answers" onClick={onOpenAnswers}>Open answers</button>
        <div className="row-actions">{actions}</div>
      </div>
    </section>
  );
}
