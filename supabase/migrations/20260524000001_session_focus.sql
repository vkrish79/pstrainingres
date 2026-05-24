-- Trainer "spotlight": which exercise the trainer is drawing the cohort to.
-- One row per session. The trainer writes it (from their My copy view);
-- enrolled participants read it live to show a "Trainer is on Exercise N"
-- banner with a Jump button.
--
-- A bump of `snap_at` is a one-time "pull everyone here NOW" force-jump:
-- participants compare it for CHANGE (not magnitude → clock-skew-proof) and
-- jump once; the value is seeded from the loaded row so joining mid-session
-- doesn't yank. A soft spotlight leaves snap_at untouched; Clear (section_id =
-- null) never bumps it.
--
-- Idempotent ([[supabase-idempotent-migrations]]). RLS helpers live only in the
-- DB ([[rls-helpers-not-in-tree]]).

create table if not exists session_focus (
  session_id uuid primary key references sessions(id) on delete cascade,
  section_id uuid references sections(id) on delete set null,
  section_title text,
  snap_at timestamptz,
  set_by uuid references profiles(id) on delete set null,
  set_at timestamptz not null default now()
);

alter table session_focus enable row level security;

-- Trainer (super OR vendor_manager of the session's vendor OR the session's
-- trainer): full CRUD on their session's focus.
drop policy if exists session_focus_trainer_all on session_focus;
create policy session_focus_trainer_all on session_focus
  for all using (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.id = session_focus.session_id
        and ((s.vendor_id is not null and s.vendor_id = my_vendor_id()) or s.trainer_id = auth.uid())
    )
  ) with check (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.id = session_focus.session_id
        and ((s.vendor_id is not null and s.vendor_id = my_vendor_id()) or s.trainer_id = auth.uid())
    )
  );

-- Enrolled participant: read their own session's focus only.
drop policy if exists session_focus_participant_read on session_focus;
create policy session_focus_participant_read on session_focus
  for select using (
    exists (
      select 1 from session_participants sp
      where sp.session_id = session_focus.session_id and sp.participant_id = auth.uid()
    )
  );

-- Realtime so participants see the spotlight / snap live.
do $$ begin
  alter publication supabase_realtime add table session_focus;
exception when duplicate_object then null;
  when others then null;
end $$;
