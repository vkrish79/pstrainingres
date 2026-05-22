-- Trainer "practice copy" answers, persisted SERVER-SIDE and scoped to the
-- SESSION (not the individual trainer) so that when a session's trainer is
-- reassigned, the new trainer resumes the same practice progress.
--
-- Previously these answers lived in browser localStorage keyed by
-- (session, trainer): device-private and lost on handoff. Now a session has one
-- shared practice copy; whoever is the assigned trainer — plus super trainers
-- and the vendor's manager — reads/writes it. Never visible to participants and
-- never counted in cohort progress or CSV exports.
--
-- Idempotent (see [[supabase-idempotent-migrations]]).

create table if not exists trainer_practice (
  session_id uuid not null references sessions(id) on delete cascade,
  block_id uuid not null references blocks(id) on delete cascade,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (session_id, block_id)
);

create index if not exists trainer_practice_session_idx on trainer_practice (session_id);

alter table trainer_practice enable row level security;

drop trigger if exists trg_trainer_practice_updated on trainer_practice;
create trigger trg_trainer_practice_updated
  before update on trainer_practice
  for each row execute function set_updated_at();

-- Trainer-only (no participant access): super OR vendor_manager of the
-- session's vendor OR the session's current trainer. Mirrors participant_prep.
drop policy if exists trainer_practice_trainer_all on trainer_practice;
create policy trainer_practice_trainer_all on trainer_practice
  for all using (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.id = trainer_practice.session_id
        and ((s.vendor_id is not null and s.vendor_id = my_vendor_id())
             or s.trainer_id = auth.uid())
    )
  )
  with check (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.id = trainer_practice.session_id
        and ((s.vendor_id is not null and s.vendor_id = my_vendor_id())
             or s.trainer_id = auth.uid())
    )
  );
