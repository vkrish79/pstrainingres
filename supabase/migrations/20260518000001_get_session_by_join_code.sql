-- Public lookup of a session by its join code, used by /join/:code to
-- render the session header before the participant signs in.
--
-- Exposes only name + dates — never the participant list, workbook, or
-- vendor. SECURITY DEFINER bypasses the sessions RLS for this narrow
-- read; grant is limited to anon + authenticated, both via execute only.

create or replace function get_session_by_join_code(p_code text)
returns table(id uuid, name text, starts_at timestamptz, ends_at timestamptz, join_code text)
language sql
security definer
stable
as $$
  select id, name, starts_at, ends_at, join_code
  from sessions
  where upper(join_code) = upper(p_code)
  limit 1;
$$;

revoke all on function get_session_by_join_code(text) from public;
grant execute on function get_session_by_join_code(text) to anon, authenticated;
