-- Per-section notes written by participants on their own workbook copy.
-- One note per (session, participant, section). Participants read/write
-- their own; trainers who can see the session can read all notes.
--
-- Idempotent: safe to re-run after manual application via the SQL editor
-- (see [[supabase-idempotent-migrations]]).

create table if not exists participant_notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  participant_id uuid not null references profiles(id) on delete cascade,
  section_id uuid not null references sections(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table participant_notes
    add constraint participant_notes_unique_per_section
    unique (session_id, participant_id, section_id);
exception when duplicate_object then null;
  when others then null;
end $$;

create index if not exists participant_notes_session_idx
  on participant_notes (session_id);
create index if not exists participant_notes_participant_idx
  on participant_notes (participant_id);

alter table participant_notes enable row level security;

-- updated_at trigger (reuses the shared helper defined in schema.sql).
drop trigger if exists trg_participant_notes_updated on participant_notes;
create trigger trg_participant_notes_updated
  before update on participant_notes
  for each row execute function set_updated_at();

-- Participant: read + write their own notes.
drop policy if exists participant_notes_self_read on participant_notes;
drop policy if exists participant_notes_self_insert on participant_notes;
drop policy if exists participant_notes_self_update on participant_notes;
drop policy if exists participant_notes_self_delete on participant_notes;

create policy participant_notes_self_read on participant_notes
  for select using (participant_id = auth.uid());
create policy participant_notes_self_insert on participant_notes
  for insert with check (participant_id = auth.uid());
create policy participant_notes_self_update on participant_notes
  for update using (participant_id = auth.uid())
  with check (participant_id = auth.uid());
create policy participant_notes_self_delete on participant_notes
  for delete using (participant_id = auth.uid());

-- Trainers: read participant notes for sessions they can see. Mirrors the
-- answers_read pattern in add_vendors_and_roles.sql.
drop policy if exists participant_notes_trainer_read on participant_notes;
create policy participant_notes_trainer_read on participant_notes for select using (
  is_super_trainer_or_above()
  or exists (
    select 1 from sessions s
    where s.id = participant_notes.session_id
      and (
        (s.vendor_id is not null and s.vendor_id = my_vendor_id())
        or s.trainer_id = auth.uid()
      )
  )
);

-- Realtime: trainers see participant notes appear live in the dashboard.
do $$ begin
  alter publication supabase_realtime add table participant_notes;
exception when duplicate_object then null;
  when others then null;
end $$;
