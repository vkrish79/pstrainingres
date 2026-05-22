-- Reassign a session's trainer.
--
-- Super trainers (super_admin / super_trainer) and vendor managers can change
-- which trainer runs a session. Scoping (mirrors create_session_with_workbook_clone):
--   * vendor_manager: only sessions in their own vendor.
--   * the new trainer must belong to the SAME vendor as the session (both NULL
--     for super-delivered sessions) — we never move a session across vendors,
--     so the prep pool partition stays intact.
--   * closed sessions can't be reassigned (participants are already gone).
--
-- SECURITY DEFINER so it can update the row after its own authorization checks;
-- the broad sessions UPDATE RLS already lets any trainer write, but this RPC is
-- the well-defined, vendor-scoped path the UI uses.
--
-- Idempotent (see [[supabase-idempotent-migrations]]): CREATE OR REPLACE.

create or replace function set_session_trainer(p_session_id uuid, p_trainer_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_role text;
  v_caller_vendor uuid;
  v_sess_vendor uuid;
  v_sess_closed timestamptz;
  v_new_role text;
  v_new_vendor uuid;
begin
  select role, vendor_id into v_role, v_caller_vendor
  from profiles where id = auth.uid();

  if v_role not in ('super_admin', 'super_trainer', 'vendor_manager') then
    raise exception 'only super trainers and vendor managers can reassign a session trainer';
  end if;

  select vendor_id, closed_at into v_sess_vendor, v_sess_closed
  from sessions where id = p_session_id;
  if not found then
    raise exception 'session not found';
  end if;
  if v_sess_closed is not null then
    raise exception 'cannot reassign a closed session';
  end if;

  if v_role = 'vendor_manager' and v_sess_vendor is distinct from v_caller_vendor then
    raise exception 'vendor managers can only reassign sessions in their own vendor';
  end if;

  select role, vendor_id into v_new_role, v_new_vendor
  from profiles where id = p_trainer_id;
  if not found then
    raise exception 'trainer not found';
  end if;
  if v_new_role not in ('super_admin', 'super_trainer', 'vendor_manager', 'vendor_trainer', 'trainer') then
    raise exception 'target user is not a trainer';
  end if;

  -- Same-vendor only: the new trainer must belong to the session's vendor.
  -- `is distinct from` treats NULL = NULL as equal (super-delivered sessions).
  if v_new_vendor is distinct from v_sess_vendor then
    raise exception 'the new trainer must belong to the same vendor as the session';
  end if;

  update sessions set trainer_id = p_trainer_id where id = p_session_id;
end $$;

grant execute on function set_session_trainer(uuid, uuid) to authenticated;
