-- pstrainingres: vendors + 5-tier role model.
-- Idempotent — safe to re-run.
--
-- Adds:
--   • vendors table (starts empty; super trainers populate via UI)
--   • profiles.vendor_id (nullable; participants/trainers are scoped to a vendor)
--   • sessions.vendor_id (denormalized so trainer reassignment is safe)
--   • widens profiles.role from {trainer,participant} to the 5-tier enum
--   • helper functions (role_of_caller, my_vendor_id, is_*_or_above, can_access_vendor)
--   • RLS splits across profiles, vendors, workbooks, sections, blocks,
--     sessions, session_participants, answers, answer_notes
--   • a self-update guard so users can't promote themselves
--   • updates create_session_with_workbook_clone() to accept an explicit
--     trainer assignment (so vendor managers can create sessions on behalf
--     of a vendor_trainer in their vendor)
--
-- Role tiers (see docs/vendor-trainer-model.md for full spec):
--   super_admin     — vbalasubramanian@etihad.ae (only). Everything.
--   super_trainer   — Riznie, Feroz, Ensio. Everything except adding super trainers.
--   vendor_manager  — One vendor. Full CRUD on its sessions; read-only on workbooks.
--   vendor_trainer  — One vendor. CRUD own sessions; edits the cloned session workbook only.
--   participant     — One vendor. Reads workbooks/sessions they're enrolled in.

-- ========== 1. VENDORS TABLE ==========

create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  code text unique not null check (code ~ '^[A-Z0-9_]{2,12}$'),
  name text not null,
  created_at timestamptz not null default now()
);

alter table vendors enable row level security;

-- ========== 2. PROFILES: vendor_id + widen role ==========

alter table profiles
  add column if not exists vendor_id uuid references vendors(id) on delete set null;

-- Drop the legacy {trainer,participant} check so we can migrate the data.
do $$ begin
  alter table profiles drop constraint profiles_role_check;
exception when undefined_object then null;
end $$;

-- Migrate existing rows. All existing trainers → vendor_trainer with no
-- vendor assigned (no access until a super trainer assigns them).
update profiles set role = 'vendor_trainer' where role = 'trainer';

-- Seed super admin + super trainers by email (silently no-ops if any of
-- these accounts don't exist yet — verify with the SELECT in the doc).
update profiles set role = 'super_admin'
  where lower(email) = lower('vbalasubramanian@etihad.ae');

update profiles set role = 'super_trainer'
  where lower(email) in (
    lower('MRMarleen@etihad.ae'),
    lower('MFeroz@etihad.ae'),
    lower('EnsioM@etihad.ae')
  );

-- Re-add the check with the full 5-tier enum.
alter table profiles add constraint profiles_role_check check (
  role in ('super_admin','super_trainer','vendor_manager','vendor_trainer','participant')
);

-- ========== 3. SESSIONS: vendor_id ==========

alter table sessions
  add column if not exists vendor_id uuid references vendors(id);

create index if not exists sessions_vendor_id_idx on sessions(vendor_id);

-- Existing sessions have vendor_id = null. Only super can see them; they
-- become invisible to vendor managers/trainers. Acceptable since the user
-- confirmed we're provisioning vendors and trainers from scratch.

-- ========== 4. HELPER FUNCTIONS ==========
-- All security definer — they query profiles, which has RLS.

create or replace function role_of_caller()
returns text language sql stable security definer as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function my_vendor_id()
returns uuid language sql stable security definer as $$
  select vendor_id from profiles where id = auth.uid();
$$;

create or replace function is_super_admin()
returns boolean language sql stable security definer as $$
  select role_of_caller() = 'super_admin';
$$;

create or replace function is_super_trainer_or_above()
returns boolean language sql stable security definer as $$
  select role_of_caller() in ('super_admin','super_trainer');
$$;

create or replace function is_vendor_manager_or_above()
returns boolean language sql stable security definer as $$
  select role_of_caller() in ('super_admin','super_trainer','vendor_manager');
$$;

create or replace function is_vendor_trainer_or_above()
returns boolean language sql stable security definer as $$
  select role_of_caller() in ('super_admin','super_trainer','vendor_manager','vendor_trainer');
$$;

-- Backward-compat alias: existing RLS and edge functions call is_trainer().
-- Redefine as "any trainer-tier (above participant)" — semantically equivalent
-- to the old `role='trainer'` check, plus the new tiers.
create or replace function is_trainer()
returns boolean language sql stable security definer as $$
  select is_vendor_trainer_or_above();
$$;

create or replace function can_access_vendor(v_id uuid)
returns boolean language sql stable security definer as $$
  select is_super_trainer_or_above()
      or (v_id is not null and v_id = my_vendor_id());
$$;

-- ========== 5. SELF-UPDATE GUARD ==========
-- Prevents anyone from promoting themselves or moving to a different vendor
-- via a direct profile update. Super admin bypasses.

create or replace function profiles_self_update_guard()
returns trigger language plpgsql as $$
begin
  -- (1) Block all in-app super-tier transitions (both promote AND demote),
  -- regardless of caller. auth.uid() IS NULL in direct SQL sessions
  -- (psql / Supabase SQL editor), so the DBA path still works. The app
  -- always has auth.uid() set, so a super_trainer cannot demote another
  -- super_trainer through the API either — all changes to/from super
  -- tier are SQL-only.
  if auth.uid() is not null
     and new.role is distinct from old.role
     and (new.role in ('super_admin','super_trainer')
          or old.role in ('super_admin','super_trainer')) then
    raise exception 'super-tier role changes can only be done via direct SQL';
  end if;

  -- (2) Self-update guard: a regular user can't change their own role or
  -- vendor assignment by editing their own profile.
  if old.id = auth.uid() and not is_super_admin() then
    if new.role is distinct from old.role then
      raise exception 'cannot change own role';
    end if;
    if new.vendor_id is distinct from old.vendor_id then
      raise exception 'cannot change own vendor assignment';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_self_update_guard on profiles;
create trigger trg_profiles_self_update_guard
  before update on profiles
  for each row execute function profiles_self_update_guard();

-- ========== 6. RLS POLICIES ==========

-- ----- vendors -----
drop policy if exists vendors_super_write on vendors;
drop policy if exists vendors_trainer_read on vendors;

create policy vendors_super_write on vendors for all
  using (is_super_trainer_or_above())
  with check (is_super_trainer_or_above());

create policy vendors_trainer_read on vendors for select
  using (is_vendor_trainer_or_above());

-- ----- profiles -----
drop policy if exists profiles_self_read on profiles;
drop policy if exists profiles_self_update on profiles;
drop policy if exists profiles_trainer_insert on profiles;
drop policy if exists profiles_trainer_update on profiles;

create policy profiles_self_read on profiles for select using (
  id = auth.uid()
  or is_super_trainer_or_above()
  or (is_vendor_trainer_or_above()
      and vendor_id is not null
      and vendor_id = my_vendor_id())
);

create policy profiles_self_update on profiles for update
  using (id = auth.uid());

-- Direct profile inserts/updates are super-only; everyone else goes
-- through the create-participant / create-vendor-trainer edge functions
-- (service-role) which validate the caller's permissions explicitly.
create policy profiles_super_insert on profiles for insert
  with check (is_super_trainer_or_above());

create policy profiles_super_update on profiles for update
  using (is_super_trainer_or_above());

-- ----- workbooks -----
drop policy if exists workbooks_trainer_all on workbooks;
drop policy if exists workbooks_participant_read on workbooks;

-- Templates: super writes, any trainer-tier reads.
create policy workbooks_template_super_all on workbooks for all using (
  is_template = true and is_super_trainer_or_above()
) with check (
  is_template = true and is_super_trainer_or_above()
);

create policy workbooks_template_trainer_read on workbooks for select using (
  is_template = true and is_vendor_trainer_or_above()
);

-- Cloned workbooks (is_template=false): readable by super, by vendor-manager
-- on the session's vendor, by the owning trainer, and by enrolled
-- participants. Writable only by super and the owning trainer.
create policy workbooks_clone_read on workbooks for select using (
  is_template = false and (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.workbook_id = workbooks.id
        and (
          (is_vendor_manager_or_above()
             and s.vendor_id is not null
             and s.vendor_id = my_vendor_id())
          or s.trainer_id = auth.uid()
          or exists (
            select 1 from session_participants sp
            where sp.session_id = s.id and sp.participant_id = auth.uid()
          )
        )
    )
  )
);

create policy workbooks_clone_write on workbooks for update using (
  is_template = false and (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.workbook_id = workbooks.id and s.trainer_id = auth.uid()
    )
  )
) with check (
  is_template = false and (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.workbook_id = workbooks.id and s.trainer_id = auth.uid()
    )
  )
);

-- ----- sections -----
drop policy if exists sections_trainer_all on sections;
drop policy if exists sections_participant_read on sections;

create policy sections_read on sections for select using (
  exists (
    select 1 from workbooks w
    where w.id = sections.workbook_id and (
      (w.is_template = true and is_vendor_trainer_or_above())
      or (w.is_template = false and (
        is_super_trainer_or_above()
        or exists (
          select 1 from sessions s
          where s.workbook_id = w.id and (
            (is_vendor_manager_or_above()
               and s.vendor_id is not null
               and s.vendor_id = my_vendor_id())
            or s.trainer_id = auth.uid()
            or exists (
              select 1 from session_participants sp
              where sp.session_id = s.id and sp.participant_id = auth.uid()
            )
          )
        )
      ))
    )
  )
);

create policy sections_write on sections for all using (
  exists (
    select 1 from workbooks w
    where w.id = sections.workbook_id and (
      (w.is_template = true and is_super_trainer_or_above())
      or (w.is_template = false and (
        is_super_trainer_or_above()
        or exists (
          select 1 from sessions s
          where s.workbook_id = w.id and s.trainer_id = auth.uid()
        )
      ))
    )
  )
) with check (
  exists (
    select 1 from workbooks w
    where w.id = sections.workbook_id and (
      (w.is_template = true and is_super_trainer_or_above())
      or (w.is_template = false and (
        is_super_trainer_or_above()
        or exists (
          select 1 from sessions s
          where s.workbook_id = w.id and s.trainer_id = auth.uid()
        )
      ))
    )
  )
);

-- ----- blocks -----
drop policy if exists blocks_trainer_all on blocks;
drop policy if exists blocks_participant_read on blocks;

create policy blocks_read on blocks for select using (
  exists (
    select 1 from sections sec
    join workbooks w on w.id = sec.workbook_id
    where sec.id = blocks.section_id and (
      (w.is_template = true and is_vendor_trainer_or_above())
      or (w.is_template = false and (
        is_super_trainer_or_above()
        or exists (
          select 1 from sessions s
          where s.workbook_id = w.id and (
            (is_vendor_manager_or_above()
               and s.vendor_id is not null
               and s.vendor_id = my_vendor_id())
            or s.trainer_id = auth.uid()
            or exists (
              select 1 from session_participants sp
              where sp.session_id = s.id and sp.participant_id = auth.uid()
            )
          )
        )
      ))
    )
  )
);

create policy blocks_write on blocks for all using (
  exists (
    select 1 from sections sec
    join workbooks w on w.id = sec.workbook_id
    where sec.id = blocks.section_id and (
      (w.is_template = true and is_super_trainer_or_above())
      or (w.is_template = false and (
        is_super_trainer_or_above()
        or exists (
          select 1 from sessions s
          where s.workbook_id = w.id and s.trainer_id = auth.uid()
        )
      ))
    )
  )
) with check (
  exists (
    select 1 from sections sec
    join workbooks w on w.id = sec.workbook_id
    where sec.id = blocks.section_id and (
      (w.is_template = true and is_super_trainer_or_above())
      or (w.is_template = false and (
        is_super_trainer_or_above()
        or exists (
          select 1 from sessions s
          where s.workbook_id = w.id and s.trainer_id = auth.uid()
        )
      ))
    )
  )
);

-- ----- sessions -----
drop policy if exists sessions_trainer_all on sessions;
drop policy if exists sessions_participant_read on sessions;

create policy sessions_read on sessions for select using (
  is_super_trainer_or_above()
  or (is_vendor_manager_or_above()
      and vendor_id is not null
      and vendor_id = my_vendor_id())
  or trainer_id = auth.uid()
  or in_session(id)
);

create policy sessions_write on sessions for all using (
  is_super_trainer_or_above()
  or (is_vendor_manager_or_above()
      and vendor_id is not null
      and vendor_id = my_vendor_id())
  or (role_of_caller() = 'vendor_trainer' and trainer_id = auth.uid())
) with check (
  is_super_trainer_or_above()
  or (is_vendor_manager_or_above()
      and vendor_id is not null
      and vendor_id = my_vendor_id())
  or (role_of_caller() = 'vendor_trainer' and trainer_id = auth.uid())
);

-- ----- session_participants -----
drop policy if exists sp_trainer_all on session_participants;
drop policy if exists sp_self_read on session_participants;

create policy sp_read on session_participants for select using (
  participant_id = auth.uid()
  or is_super_trainer_or_above()
  or exists (
    select 1 from sessions s
    where s.id = session_participants.session_id and (
      (is_vendor_manager_or_above()
         and s.vendor_id is not null
         and s.vendor_id = my_vendor_id())
      or s.trainer_id = auth.uid()
    )
  )
);

create policy sp_write on session_participants for all using (
  is_super_trainer_or_above()
  or exists (
    select 1 from sessions s
    where s.id = session_participants.session_id and (
      (is_vendor_manager_or_above()
         and s.vendor_id is not null
         and s.vendor_id = my_vendor_id())
      or s.trainer_id = auth.uid()
    )
  )
) with check (
  is_super_trainer_or_above()
  or exists (
    select 1 from sessions s
    where s.id = session_participants.session_id and (
      (is_vendor_manager_or_above()
         and s.vendor_id is not null
         and s.vendor_id = my_vendor_id())
      or s.trainer_id = auth.uid()
    )
  )
);

-- ----- answers -----
drop policy if exists answers_trainer_read on answers;
drop policy if exists answers_self_read on answers;
drop policy if exists answers_self_insert on answers;
drop policy if exists answers_self_update on answers;

create policy answers_read on answers for select using (
  is_super_trainer_or_above()
  or (participant_id = auth.uid() and in_session(session_id))
  or exists (
    select 1 from sessions s
    where s.id = answers.session_id and (
      (is_vendor_manager_or_above()
         and s.vendor_id is not null
         and s.vendor_id = my_vendor_id())
      or s.trainer_id = auth.uid()
    )
  )
);

create policy answers_self_insert on answers for insert
  with check (participant_id = auth.uid() and in_session(session_id));

create policy answers_self_update on answers for update
  using (participant_id = auth.uid() and in_session(session_id));

-- ----- answer_notes -----
drop policy if exists answer_notes_trainer_read on answer_notes;
drop policy if exists answer_notes_trainer_write on answer_notes;
drop policy if exists answer_notes_trainer_update on answer_notes;
drop policy if exists answer_notes_trainer_delete on answer_notes;

create policy answer_notes_read on answer_notes for select using (
  is_super_trainer_or_above()
  or exists (
    select 1 from sessions s
    where s.id = answer_notes.session_id and (
      (is_vendor_manager_or_above()
         and s.vendor_id is not null
         and s.vendor_id = my_vendor_id())
      or s.trainer_id = auth.uid()
    )
  )
);

-- Only the owning trainer (or super) can write notes. Vendor managers are
-- read-only — they observe, they don't annotate.
create policy answer_notes_trainer_insert on answer_notes for insert with check (
  trainer_id = auth.uid() and (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.id = answer_notes.session_id and s.trainer_id = auth.uid()
    )
  )
);

create policy answer_notes_trainer_update on answer_notes for update using (
  is_super_trainer_or_above()
  or (trainer_id = auth.uid() and exists (
    select 1 from sessions s
    where s.id = answer_notes.session_id and s.trainer_id = auth.uid()
  ))
);

create policy answer_notes_trainer_delete on answer_notes for delete using (
  is_super_trainer_or_above()
  or (trainer_id = auth.uid() and exists (
    select 1 from sessions s
    where s.id = answer_notes.session_id and s.trainer_id = auth.uid()
  ))
);

-- ========== 7. UPDATE create_session_with_workbook_clone ==========
-- New parameter: p_trainer_id. When null, the caller becomes the session's
-- trainer (current behavior). When set, the caller must be vendor_manager
-- or above, and the assigned trainer must belong to the same vendor as
-- the caller's vendor (or any vendor if super).

-- Drop the old 5-arg signature so callers don't accidentally hit it.
do $$ begin
  drop function if exists create_session_with_workbook_clone(uuid, text, timestamptz, timestamptz, text);
exception when others then null;
end $$;

create or replace function create_session_with_workbook_clone(
  p_template_id uuid,
  p_name text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_city_code text default null,
  p_trainer_id uuid default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_caller_role text;
  v_caller_vendor uuid;
  v_assigned_trainer uuid;
  v_assigned_vendor uuid;
  v_new_workbook_id uuid;
  v_new_session_id uuid;
  r_section record;
  v_new_section_id uuid;
begin
  v_caller_role := role_of_caller();
  v_caller_vendor := my_vendor_id();

  if v_caller_role not in ('super_admin','super_trainer','vendor_manager','vendor_trainer') then
    raise exception 'only trainer-tier roles can create sessions';
  end if;

  -- Decide who owns the session.
  if p_trainer_id is null then
    v_assigned_trainer := auth.uid();
  else
    if v_caller_role = 'vendor_trainer' and p_trainer_id <> auth.uid() then
      raise exception 'vendor_trainer can only create sessions for themselves';
    end if;
    v_assigned_trainer := p_trainer_id;
  end if;

  -- Pull the assigned trainer's vendor.
  select vendor_id into v_assigned_vendor
  from profiles where id = v_assigned_trainer;

  -- Vendor managers must stay inside their own vendor.
  if v_caller_role = 'vendor_manager'
     and v_assigned_vendor is distinct from v_caller_vendor then
    raise exception 'vendor_manager can only create sessions inside their own vendor';
  end if;

  -- Clone the workbook row (non-template; remember the source).
  insert into workbooks (title, description, is_template, template_id, created_by)
  select title, description, false, id, auth.uid()
  from workbooks
  where id = p_template_id and is_template = true
  returning id into v_new_workbook_id;

  if v_new_workbook_id is null then
    raise exception 'template workbook % not found or is not a template', p_template_id;
  end if;

  -- Clone sections + blocks in order.
  for r_section in
    select id, title, order_index from sections
    where workbook_id = p_template_id order by order_index
  loop
    insert into sections (workbook_id, title, order_index)
    values (v_new_workbook_id, r_section.title, r_section.order_index)
    returning id into v_new_section_id;

    insert into blocks (section_id, block_type, config, order_index)
    select v_new_section_id, block_type, config, order_index
    from blocks where section_id = r_section.id
    order by order_index;
  end loop;

  insert into sessions (workbook_id, name, trainer_id, vendor_id, starts_at, ends_at, city_code)
  values (v_new_workbook_id, p_name, v_assigned_trainer, v_assigned_vendor,
          p_starts_at, p_ends_at, p_city_code)
  returning id into v_new_session_id;

  return v_new_session_id;
end;
$$;

grant execute on function create_session_with_workbook_clone(
  uuid, text, timestamptz, timestamptz, text, uuid
) to authenticated;
