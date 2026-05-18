-- Session close: capture a JSON snapshot of the session (metadata,
-- participants, answers, notes) and then hard-delete the participants.
-- Once closed, sessions.closed_summary is the only record of who was
-- enrolled and what they answered.
--
-- This migration only adds the columns and updates the public lookup
-- RPC to expose closed_at. The snapshot building + participant delete
-- happens in the close-session edge function (service-role).
--
-- Idempotent (see [[supabase-idempotent-migrations]]).

alter table sessions
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references profiles(id) on delete set null,
  add column if not exists closed_summary jsonb;

create index if not exists sessions_closed_at_idx
  on sessions (closed_at)
  where closed_at is not null;

-- Expose closed_at via the existing anon-callable RPC so /join/:code can
-- render "this session has ended" without exposing other session detail.
-- DROP+CREATE because RETURNS TABLE columns can't change via CREATE OR REPLACE.
drop function if exists get_session_by_join_code(text);

create function get_session_by_join_code(p_code text)
returns table(
  id uuid,
  name text,
  starts_at timestamptz,
  ends_at timestamptz,
  join_code text,
  closed_at timestamptz
)
language sql
security definer
stable
as $$
  select id, name, starts_at, ends_at, join_code, closed_at
  from sessions
  where upper(join_code) = upper(p_code)
  limit 1;
$$;

revoke all on function get_session_by_join_code(text) from public;
grant execute on function get_session_by_join_code(text) to anon, authenticated;
