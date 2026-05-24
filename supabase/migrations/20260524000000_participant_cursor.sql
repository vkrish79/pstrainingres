-- Live participant cursor: which exercise each participant is currently
-- looking at, powering the trainer dashboard's "On now" column.
--
-- Transport is an RLS-protected table (NOT a Supabase Presence channel) on
-- purpose: a shared presence channel is all-or-nothing for membership, so any
-- participant who knows the session id could read every classmate's position.
-- Postgres RLS gives the exact rule we want — the trainer reads every cursor in
-- their session; a participant can read/write ONLY their own row — so peers
-- cannot see each other. Mirrors the participant_prep policy shape.
-- Uses RLS helpers that live only in the DB ([[rls-helpers-not-in-tree]]).
--
-- Idempotent ([[supabase-idempotent-migrations]]).

create table if not exists participant_cursor (
  session_id uuid not null references sessions(id) on delete cascade,
  participant_id uuid not null references profiles(id) on delete cascade,
  section_id uuid references sections(id) on delete set null,
  section_title text,
  moved_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (session_id, participant_id)
);

create index if not exists participant_cursor_session_idx
  on participant_cursor (session_id);

-- Server-authoritative timestamps so the trainer never trusts a participant's
-- clock: last_seen on every write (heartbeat → "online"); moved_at only when
-- the section actually changes (lets the trainer tell "live" from "idle").
create or replace function set_cursor_timestamps() returns trigger as $$
begin
  new.last_seen := now();
  if tg_op = 'INSERT' or new.section_id is distinct from old.section_id then
    new.moved_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_participant_cursor_ts on participant_cursor;
create trigger trg_participant_cursor_ts
  before insert or update on participant_cursor
  for each row execute function set_cursor_timestamps();

alter table participant_cursor enable row level security;

-- Participant: read + write ONLY their own cursor.
drop policy if exists participant_cursor_self_rw on participant_cursor;
create policy participant_cursor_self_rw on participant_cursor
  for all using (participant_id = auth.uid())
  with check (participant_id = auth.uid());

-- Trainer (super OR vendor_manager of the session's vendor OR the session's
-- trainer): read every cursor in the session. No write path needed.
drop policy if exists participant_cursor_trainer_read on participant_cursor;
create policy participant_cursor_trainer_read on participant_cursor
  for select using (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.id = participant_cursor.session_id
        and (
          (s.vendor_id is not null and s.vendor_id = my_vendor_id())
          or s.trainer_id = auth.uid()
        )
    )
  );

-- Realtime so the trainer dashboard updates live as participants move. RLS
-- still applies to the stream, so a participant's subscription only ever sees
-- their own row.
do $$ begin
  alter publication supabase_realtime add table participant_cursor;
exception when duplicate_object then null;
  when others then null;
end $$;
