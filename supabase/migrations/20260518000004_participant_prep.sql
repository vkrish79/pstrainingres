-- Per-participant prep data populated by the trainer before a session.
-- Each row: a snippet of pre-work content (e.g. a PNR, a ticket number,
-- a scenario) attached to a participant + section. Rendered as a
-- read-only callout at the top of the section in the participant's
-- workbook and (after close) in the session snapshot.
--
-- Mapping convention (handled in the upload UI, not the schema): rows in
-- the trainer's spreadsheet are auto-distributed to the session's
-- participants sorted alphabetically by full_name. Trainer can edit
-- per-participant prep manually after upload.
--
-- Idempotent (see [[supabase-idempotent-migrations]]).

create table if not exists participant_prep (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  participant_id uuid not null references profiles(id) on delete cascade,
  section_id uuid not null references sections(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table participant_prep
    add constraint participant_prep_unique_per_section
    unique (session_id, participant_id, section_id);
exception when duplicate_object then null;
  when others then null;
end $$;

create index if not exists participant_prep_session_idx
  on participant_prep (session_id);
create index if not exists participant_prep_participant_idx
  on participant_prep (participant_id);

alter table participant_prep enable row level security;

drop trigger if exists trg_participant_prep_updated on participant_prep;
create trigger trg_participant_prep_updated
  before update on participant_prep
  for each row execute function set_updated_at();

-- Participant: read their own prep only.
drop policy if exists participant_prep_self_read on participant_prep;
create policy participant_prep_self_read on participant_prep
  for select using (participant_id = auth.uid());

-- Trainer (super OR vendor_manager of vendor OR session trainer): full CRUD.
drop policy if exists participant_prep_trainer_all on participant_prep;
create policy participant_prep_trainer_all on participant_prep
  for all using (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.id = participant_prep.session_id
        and (
          (s.vendor_id is not null and s.vendor_id = my_vendor_id())
          or s.trainer_id = auth.uid()
        )
    )
  )
  with check (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.id = participant_prep.session_id
        and (
          (s.vendor_id is not null and s.vendor_id = my_vendor_id())
          or s.trainer_id = auth.uid()
        )
    )
  );

-- Realtime so the participant's workbook sees prep appear live after upload.
do $$ begin
  alter publication supabase_realtime add table participant_prep;
exception when duplicate_object then null;
  when others then null;
end $$;
