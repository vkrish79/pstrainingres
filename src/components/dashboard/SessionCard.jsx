import { Link } from 'react-router-dom';

function formatDateRange(start, end) {
  const fmt = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (start && end) return `${fmt(start)} → ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  if (end) return `Until ${fmt(end)}`;
  return '';
}

// Card used by the trainer home, vendor drill-in, and "my sessions" strip.
// `showTrainer` adds a "Trainer: X" line; useful in views where the caller
// isn't necessarily the trainer (vendor_manager / super).
export default function SessionCard({ session, showTrainer = false }) {
  const participants = session.session_participants || [];
  const closed = !!session.closed_at;
  return (
    <Link to={`/trainer/sessions/${session.id}`} className={`session-card ${closed ? 'closed' : ''}`}>
      <div className="session-card-head">
        <h3>{session.name}</h3>
        {session.session_type?.name && <span className="type-tag">{session.session_type.name}</span>}
        {session.city_code && <span className="city-tag">{session.city_code}</span>}
        {closed && <span className="closed-pill small">Closed</span>}
      </div>
      <p className="session-card-workbook">{session.workbooks?.title}</p>
      {(session.starts_at || session.ends_at) && (
        <p className="session-card-dates">{formatDateRange(session.starts_at, session.ends_at)}</p>
      )}
      {showTrainer && session.trainer?.full_name && (
        <p className="session-card-meta">Trainer: {session.trainer.full_name}</p>
      )}
      <p className="session-card-meta">
        {participants.length} participant{participants.length === 1 ? '' : 's'}
      </p>
    </Link>
  );
}
