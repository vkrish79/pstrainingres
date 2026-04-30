-- pstrainingres: trainer annotations (flag + note) on individual answers.
-- Idempotent — safe to re-run.

create table if not exists answer_notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  participant_id uuid not null references profiles(id) on delete cascade,
  block_id uuid not null references blocks(id) on delete cascade,
  trainer_id uuid not null references profiles(id),
  note text not null default '',
  flag boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, participant_id, block_id)
);

create index if not exists answer_notes_session_idx on answer_notes(session_id);
create index if not exists answer_notes_participant_idx on answer_notes(session_id, participant_id);

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_answer_notes_updated on answer_notes;
create trigger trg_answer_notes_updated before update on answer_notes
  for each row execute function set_updated_at();

alter table answer_notes enable row level security;

drop policy if exists answer_notes_trainer_read on answer_notes;
drop policy if exists answer_notes_trainer_write on answer_notes;
drop policy if exists answer_notes_trainer_update on answer_notes;
drop policy if exists answer_notes_trainer_delete on answer_notes;

create policy answer_notes_trainer_read on answer_notes
  for select using (is_trainer());

create policy answer_notes_trainer_write on answer_notes
  for insert with check (is_trainer() and trainer_id = auth.uid());

create policy answer_notes_trainer_update on answer_notes
  for update using (is_trainer()) with check (trainer_id = auth.uid());

create policy answer_notes_trainer_delete on answer_notes
  for delete using (is_trainer());

-- Realtime so multi-trainer sessions see each other's annotations live
do $$ begin
  alter publication supabase_realtime add table answer_notes;
exception when duplicate_object then null;
end $$;
