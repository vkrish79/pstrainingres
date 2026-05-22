-- Workbook-level prep repository ("prep kits").
--
-- Replaces the session-level prep upload. A master (template) workbook owns a
-- finite pool of prep kits, partitioned per vendor (vendor_id NULL = the shared
-- super pool). Each session draws one kit per participant from its own vendor's
-- partition, depleting a shared balance. See docs/prep-repository-next.md.
--
-- Idempotent (see [[supabase-idempotent-migrations]]).

-- ========== 1. sections.template_section_id (robust master->clone mapping) ==========
-- Each cloned section records the master section it came from, so prep keyed by
-- master section id can be mapped onto a clone regardless of rename/reorder.

alter table sections
  add column if not exists template_section_id uuid references sections(id) on delete set null;
create index if not exists sections_template_section_id_idx on sections (template_section_id);

-- ========== 2. workbook_prep_kits ==========
-- `payload` (not `values` — reserved word) is keyed by MASTER section id:
--   { "<master_section_id>": "content", ... }

create table if not exists workbook_prep_kits (
  id uuid primary key default gen_random_uuid(),
  workbook_id uuid not null references workbooks(id) on delete cascade,  -- MASTER/template workbook
  vendor_id uuid references vendors(id) on delete cascade,               -- partition; NULL = shared super pool
  kit_index int not null,                                                -- claim order within the partition
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'available' check (status in ('available','allocated','used')),
  consumed_session_id uuid references sessions(id) on delete set null,
  consumed_participant_id uuid references profiles(id) on delete set null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wpk_pool_status_idx on workbook_prep_kits (workbook_id, vendor_id, status);
create index if not exists wpk_consumed_session_idx on workbook_prep_kits (consumed_session_id);
create index if not exists wpk_consumed_participant_idx on workbook_prep_kits (consumed_participant_id);

-- Unique kit_index per partition. Two partial indexes avoid the NULLS-NOT-DISTINCT
-- version dependency and keep the NULL super pool as one logical partition.
create unique index if not exists wpk_unique_kit_vendor
  on workbook_prep_kits (workbook_id, vendor_id, kit_index) where vendor_id is not null;
create unique index if not exists wpk_unique_kit_super
  on workbook_prep_kits (workbook_id, kit_index) where vendor_id is null;

drop trigger if exists trg_wpk_updated on workbook_prep_kits;
create trigger trg_wpk_updated
  before update on workbook_prep_kits
  for each row execute function set_updated_at();

-- ========== 3. RLS ==========
alter table workbook_prep_kits enable row level security;

-- Super reads/writes any partition (incl. the NULL super pool); vendor-tier
-- reads/writes only their own vendor's partition. Participants never touch this.
drop policy if exists wpk_rw on workbook_prep_kits;
create policy wpk_rw on workbook_prep_kits for all using (
  is_super_trainer_or_above()
  or (is_vendor_trainer_or_above() and vendor_id is not null and vendor_id = my_vendor_id())
) with check (
  is_super_trainer_or_above()
  or (is_vendor_trainer_or_above() and vendor_id is not null and vendor_id = my_vendor_id())
);

-- ========== 4. Lifecycle RPCs (service-role only) ==========

-- Claim the next available kit for a participant in the session's vendor
-- partition and write its cells into participant_prep. Returns
-- { status: 'allocated'|'exhausted'|'none', prepped: int }.
create or replace function claim_prep_kit(p_session_id uuid, p_participant_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_clone_workbook uuid;
  v_master_workbook uuid;
  v_vendor uuid;
  v_kit workbook_prep_kits%rowtype;
  v_pool_count int;
  v_section_key text;
  v_content text;
  v_clone_section uuid;
  v_prepped int := 0;
begin
  select s.workbook_id, s.vendor_id into v_clone_workbook, v_vendor
  from sessions s where s.id = p_session_id;
  if v_clone_workbook is null then
    return jsonb_build_object('status', 'none', 'prepped', 0);
  end if;

  select coalesce(w.template_id, w.id) into v_master_workbook
  from workbooks w where w.id = v_clone_workbook;

  -- Atomically claim one available kit in this (workbook, vendor) partition.
  select * into v_kit
  from workbook_prep_kits k
  where k.workbook_id = v_master_workbook
    and k.vendor_id is not distinct from v_vendor
    and k.status = 'available'
  order by k.kit_index
  for update skip locked
  limit 1;

  if not found then
    select count(*) into v_pool_count
    from workbook_prep_kits k
    where k.workbook_id = v_master_workbook
      and k.vendor_id is not distinct from v_vendor;
    return jsonb_build_object('status', case when v_pool_count > 0 then 'exhausted' else 'none' end, 'prepped', 0);
  end if;

  update workbook_prep_kits
  set status = 'allocated',
      consumed_session_id = p_session_id,
      consumed_participant_id = p_participant_id,
      consumed_at = now()
  where id = v_kit.id;

  -- Map each master-section value onto the clone section via template_section_id.
  for v_section_key, v_content in
    select key, value from jsonb_each_text(v_kit.payload)
  loop
    if v_content is null or btrim(v_content) = '' then
      continue;
    end if;
    select cs.id into v_clone_section
    from sections cs
    where cs.workbook_id = v_clone_workbook
      and cs.template_section_id = v_section_key::uuid
    limit 1;
    if v_clone_section is null then
      continue; -- master section not present in this clone (structural drift)
    end if;
    insert into participant_prep (session_id, participant_id, section_id, content)
    values (p_session_id, p_participant_id, v_clone_section, v_content)
    on conflict (session_id, participant_id, section_id)
    do update set content = excluded.content, updated_at = now();
    v_prepped := v_prepped + 1;
  end loop;

  return jsonb_build_object('status', 'allocated', 'prepped', v_prepped, 'kit_id', v_kit.id);
end $$;

-- Return a participant's allocated kit(s) to the pool (individual delete).
create or replace function release_prep_kit(p_session_id uuid, p_participant_id uuid)
returns void language plpgsql security definer as $$
begin
  update workbook_prep_kits
  set status = 'available',
      consumed_session_id = null,
      consumed_participant_id = null,
      consumed_at = null
  where consumed_session_id = p_session_id
    and consumed_participant_id = p_participant_id
    and status = 'allocated';
end $$;

-- Permanently mark a closed session's kits as used (never returned to the pool).
create or replace function mark_prep_kits_used(p_session_id uuid)
returns void language plpgsql security definer as $$
begin
  update workbook_prep_kits
  set status = 'used',
      consumed_participant_id = null
  where consumed_session_id = p_session_id
    and status = 'allocated';
end $$;

-- These are invoked only by the edge functions (service role). Close the
-- default PUBLIC execute grant so authenticated users can't self-allocate.
revoke execute on function claim_prep_kit(uuid, uuid) from public;
revoke execute on function release_prep_kit(uuid, uuid) from public;
revoke execute on function mark_prep_kits_used(uuid) from public;
grant execute on function claim_prep_kit(uuid, uuid) to service_role;
grant execute on function release_prep_kit(uuid, uuid) to service_role;
grant execute on function mark_prep_kits_used(uuid) to service_role;

-- ========== 5. Clone RPC: stamp template_section_id on cloned sections ==========
-- Re-creates create_session_with_workbook_clone (6-arg signature unchanged) so
-- each cloned section records its master section id. Logic is otherwise
-- identical to add_vendors_and_roles.sql.

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

  if p_trainer_id is null then
    v_assigned_trainer := auth.uid();
  else
    if v_caller_role = 'vendor_trainer' and p_trainer_id <> auth.uid() then
      raise exception 'vendor_trainer can only create sessions for themselves';
    end if;
    v_assigned_trainer := p_trainer_id;
  end if;

  select vendor_id into v_assigned_vendor
  from profiles where id = v_assigned_trainer;

  if v_caller_role = 'vendor_manager'
     and v_assigned_vendor is distinct from v_caller_vendor then
    raise exception 'vendor_manager can only create sessions inside their own vendor';
  end if;

  insert into workbooks (title, description, is_template, template_id, created_by)
  select title, description, false, id, auth.uid()
  from workbooks
  where id = p_template_id and is_template = true
  returning id into v_new_workbook_id;

  if v_new_workbook_id is null then
    raise exception 'template workbook % not found or is not a template', p_template_id;
  end if;

  for r_section in
    select id, title, order_index from sections
    where workbook_id = p_template_id order by order_index
  loop
    insert into sections (workbook_id, title, order_index, template_section_id)
    values (v_new_workbook_id, r_section.title, r_section.order_index, r_section.id)
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

-- ========== 6. Realtime ==========
do $$ begin
  alter publication supabase_realtime add table workbook_prep_kits;
exception when duplicate_object then null;
  when others then null;
end $$;
