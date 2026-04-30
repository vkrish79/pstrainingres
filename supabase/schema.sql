-- pstrainingres schema. Idempotent — safe to re-run.
-- Preserves profiles (so the bootstrap trainer row survives a re-run).

-- ========== TEAR DOWN (children first) ==========

drop table if exists answers cascade;
drop table if exists session_participants cascade;
drop table if exists sessions cascade;
drop table if exists blocks cascade;
drop table if exists exercises cascade;          -- legacy from v1
drop table if exists sections cascade;
drop table if exists workbooks cascade;

drop function if exists is_trainer() cascade;
drop function if exists in_session(uuid) cascade;
drop function if exists set_updated_at() cascade;

-- Strip any stale realtime subscriptions for renamed/removed tables
do $$ begin
  alter publication supabase_realtime drop table exercises;
exception when undefined_object then null; when undefined_table then null;
end $$;
do $$ begin
  alter publication supabase_realtime drop table blocks;
exception when undefined_object then null; when undefined_table then null;
end $$;
do $$ begin
  alter publication supabase_realtime drop table answers;
exception when undefined_object then null; when undefined_table then null;
end $$;

-- ========== TABLES ==========

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  role text not null check (role in ('trainer', 'participant')),
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table workbooks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sections (
  id uuid primary key default gen_random_uuid(),
  workbook_id uuid not null references workbooks(id) on delete cascade,
  title text not null,
  order_index int not null,
  created_at timestamptz not null default now()
);
create index on sections(workbook_id, order_index);

-- A "block" is a unit of content within a section.
--   block_type='prose' : config = { "html": "..." }            (no answer)
--   block_type='field' : config = { "label": "...", "input_type": "short_text"|"long_text"|"choice"|"check_group", "options": ["A","B"]? }
--                        answer.value: string OR string[]
--   block_type='table' : config = { "headers": [...]?, "rows": [[{kind:'static',text}|{kind:'input',id,input_type}], ...] }
--                        answer.value: { "<cellId>": value, ... }
create table blocks (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references sections(id) on delete cascade,
  order_index int not null,
  block_type text not null check (block_type in ('prose', 'field', 'table')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on blocks(section_id, order_index);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  workbook_id uuid not null references workbooks(id),
  name text not null,
  trainer_id uuid not null references profiles(id),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table session_participants (
  session_id uuid not null references sessions(id) on delete cascade,
  participant_id uuid not null references profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (session_id, participant_id)
);

create table answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  participant_id uuid not null references profiles(id) on delete cascade,
  block_id uuid not null references blocks(id) on delete cascade,
  value jsonb,
  updated_at timestamptz not null default now(),
  unique (session_id, participant_id, block_id)
);

-- ========== TRIGGERS ==========

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger trg_workbooks_updated before update on workbooks
  for each row execute function set_updated_at();
create trigger trg_blocks_updated before update on blocks
  for each row execute function set_updated_at();
create trigger trg_answers_updated before update on answers
  for each row execute function set_updated_at();

-- ========== HELPERS ==========

create or replace function is_trainer()
returns boolean language sql stable security definer as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'trainer');
$$;

create or replace function in_session(sess uuid)
returns boolean language sql stable security definer as $$
  select exists(select 1 from session_participants
                where session_id = sess and participant_id = auth.uid());
$$;

-- ========== RLS ==========

alter table profiles enable row level security;
alter table workbooks enable row level security;
alter table sections enable row level security;
alter table blocks enable row level security;
alter table sessions enable row level security;
alter table session_participants enable row level security;
alter table answers enable row level security;

-- profiles
drop policy if exists profiles_self_read on profiles;
drop policy if exists profiles_self_update on profiles;
drop policy if exists profiles_trainer_insert on profiles;
drop policy if exists profiles_trainer_update on profiles;
create policy profiles_self_read on profiles for select using (id = auth.uid() or is_trainer());
create policy profiles_self_update on profiles for update using (id = auth.uid());
create policy profiles_trainer_insert on profiles for insert with check (is_trainer());
create policy profiles_trainer_update on profiles for update using (is_trainer());

-- workbooks
create policy workbooks_trainer_all on workbooks for all using (is_trainer()) with check (is_trainer());
create policy workbooks_participant_read on workbooks for select using (
  exists (select 1 from sessions s
          join session_participants sp on sp.session_id = s.id
          where s.workbook_id = workbooks.id and sp.participant_id = auth.uid())
);

-- sections
create policy sections_trainer_all on sections for all using (is_trainer()) with check (is_trainer());
create policy sections_participant_read on sections for select using (
  exists (select 1 from sessions s
          join session_participants sp on sp.session_id = s.id
          where s.workbook_id = sections.workbook_id and sp.participant_id = auth.uid())
);

-- blocks
create policy blocks_trainer_all on blocks for all using (is_trainer()) with check (is_trainer());
create policy blocks_participant_read on blocks for select using (
  exists (select 1 from sections sec
          join sessions s on s.workbook_id = sec.workbook_id
          join session_participants sp on sp.session_id = s.id
          where sec.id = blocks.section_id and sp.participant_id = auth.uid())
);

-- sessions
create policy sessions_trainer_all on sessions for all using (is_trainer()) with check (is_trainer());
create policy sessions_participant_read on sessions for select using (in_session(id));

-- session_participants
create policy sp_trainer_all on session_participants for all using (is_trainer()) with check (is_trainer());
create policy sp_self_read on session_participants for select using (participant_id = auth.uid());

-- answers
create policy answers_trainer_read on answers for select using (is_trainer());
create policy answers_self_read on answers for select using (participant_id = auth.uid() and in_session(session_id));
create policy answers_self_insert on answers for insert with check (participant_id = auth.uid() and in_session(session_id));
create policy answers_self_update on answers for update using (participant_id = auth.uid() and in_session(session_id));

-- ========== REALTIME ==========

alter publication supabase_realtime add table blocks;
alter publication supabase_realtime add table answers;
