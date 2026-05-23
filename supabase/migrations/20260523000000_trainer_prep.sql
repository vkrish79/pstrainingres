-- Trainer practice prep — a SESSION-SCOPED prep copy for the trainer's "My copy".
--
-- Participants draw a kit at enrolment (claim_prep_kit -> participant_prep). The
-- trainer's practice copy (trainer_practice) had block answers but no prep, so
-- prep-dependent exercises couldn't be practised. This adds the same idea for
-- the trainer, but keyed by SESSION (not by user): trainer_practice is shared
-- across super / the vendor's manager / the assigned trainer and resumes on
-- reassignment, so its prep must be session-scoped too (a user-keyed copy would
-- consume one kit per viewer and lose prep on handoff).
--
-- The trainer draws ONE real kit from the pool (consuming it like a participant).
-- Its workbook_prep_kits row has consumed_participant_id = NULL — i.e. a kit with
-- consumed_participant_id IS NULL is a TRAINER kit (don't assume non-null when
-- querying that table). release_prep_kit filters on consumed_participant_id, so a
-- participant delete never returns the trainer kit; mark_prep_kits_used sweeps it
-- to 'used' on close like any other allocated kit.
--
-- Idempotent (see [[supabase-idempotent-migrations]]).

-- ========== 1. Tables ==========
create table if not exists trainer_prep (
  session_id uuid not null references sessions(id) on delete cascade,
  section_id uuid not null references sections(id) on delete cascade,  -- CLONE section id
  content text not null,
  updated_at timestamptz not null default now(),
  primary key (session_id, section_id)
);
create index if not exists trainer_prep_session_idx on trainer_prep (session_id);

create table if not exists trainer_prep_standalone (
  session_id uuid not null references sessions(id) on delete cascade,
  label text not null,
  content text not null,
  updated_at timestamptz not null default now(),
  primary key (session_id, label)
);
create index if not exists trainer_prep_standalone_session_idx on trainer_prep_standalone (session_id);

alter table trainer_prep enable row level security;
alter table trainer_prep_standalone enable row level security;

drop trigger if exists trg_trainer_prep_updated on trainer_prep;
create trigger trg_trainer_prep_updated
  before update on trainer_prep
  for each row execute function set_updated_at();

drop trigger if exists trg_trainer_prep_standalone_updated on trainer_prep_standalone;
create trigger trg_trainer_prep_standalone_updated
  before update on trainer_prep_standalone
  for each row execute function set_updated_at();

-- ========== 2. RLS (trainer-only; no participant access) ==========
-- super OR vendor_manager of the session's vendor OR the session's current
-- trainer. Mirrors trainer_practice.
drop policy if exists trainer_prep_trainer_all on trainer_prep;
create policy trainer_prep_trainer_all on trainer_prep
  for all using (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.id = trainer_prep.session_id
        and ((s.vendor_id is not null and s.vendor_id = my_vendor_id())
             or s.trainer_id = auth.uid())
    )
  ) with check (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.id = trainer_prep.session_id
        and ((s.vendor_id is not null and s.vendor_id = my_vendor_id())
             or s.trainer_id = auth.uid())
    )
  );

drop policy if exists trainer_prep_standalone_trainer_all on trainer_prep_standalone;
create policy trainer_prep_standalone_trainer_all on trainer_prep_standalone
  for all using (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.id = trainer_prep_standalone.session_id
        and ((s.vendor_id is not null and s.vendor_id = my_vendor_id())
             or s.trainer_id = auth.uid())
    )
  ) with check (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.id = trainer_prep_standalone.session_id
        and ((s.vendor_id is not null and s.vendor_id = my_vendor_id())
             or s.trainer_id = auth.uid())
    )
  );

-- ========== 3. Realtime ==========
do $$ begin alter publication supabase_realtime add table trainer_prep;
exception when duplicate_object then null; when others then null; end $$;
do $$ begin alter publication supabase_realtime add table trainer_prep_standalone;
exception when duplicate_object then null; when others then null; end $$;

-- ========== 4. Claim RPC ==========
-- Draw one available kit from the session's vendor partition into the session's
-- trainer prep. SECURITY DEFINER (bypasses kit/prep RLS) but gated internally to
-- trainer-in-session — so, unlike claim_prep_kit (service-role only), this is
-- safe to grant to authenticated and is called straight from the client.
-- Returns { status: 'allocated'|'exists'|'exhausted'|'none', prepped: int }.
create or replace function claim_trainer_prep_kit(p_session_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_role text;
  v_caller_vendor uuid;
  v_clone_workbook uuid;
  v_master_workbook uuid;
  v_vendor uuid;
  v_sess_trainer uuid;
  v_sess_closed timestamptz;
  v_template jsonb;
  v_kit workbook_prep_kits%rowtype;
  v_pool_count int;
  v_header text;
  v_content text;
  v_sec_text text;
  v_matched boolean;
  v_clone_section uuid;
  v_prepped int := 0;
begin
  select role, vendor_id into v_role, v_caller_vendor from profiles where id = auth.uid();

  select s.workbook_id, s.vendor_id, s.trainer_id, s.closed_at
    into v_clone_workbook, v_vendor, v_sess_trainer, v_sess_closed
  from sessions s where s.id = p_session_id;
  if v_clone_workbook is null then
    return jsonb_build_object('status', 'none', 'prepped', 0);
  end if;

  -- Auth: trainer-in-session only.
  if not (
    v_role in ('super_admin', 'super_trainer')
    or (v_role = 'vendor_manager' and v_vendor is not null and v_vendor = v_caller_vendor)
    or v_sess_trainer = auth.uid()
  ) then
    raise exception 'not authorized to draw trainer prep for this session';
  end if;
  if v_sess_closed is not null then
    raise exception 'cannot draw prep for a closed session';
  end if;

  -- Idempotent: one trainer kit per session. Check the prep rows (they persist
  -- even after the kit flips to 'used' on close), not the kit status.
  if exists (select 1 from trainer_prep where session_id = p_session_id)
     or exists (select 1 from trainer_prep_standalone where session_id = p_session_id) then
    return jsonb_build_object('status', 'exists', 'prepped', 0);
  end if;

  select coalesce(w.template_id, w.id) into v_master_workbook
  from workbooks w where w.id = v_clone_workbook;
  select prep_template into v_template from workbooks where id = v_master_workbook;

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

  -- consumed_participant_id stays NULL — marks this as a trainer kit.
  update workbook_prep_kits
  set status = 'allocated',
      consumed_session_id = p_session_id,
      consumed_participant_id = null,
      consumed_at = now()
  where id = v_kit.id;

  -- payload is { "<header>": "content" }. Route each value by its template column.
  for v_header, v_content in select key, value from jsonb_each_text(v_kit.payload)
  loop
    if v_content is null or btrim(v_content) = '' then
      continue;
    end if;

    select elem->>'section_id' into v_sec_text
    from jsonb_array_elements(coalesce(v_template, '[]'::jsonb)) elem
    where lower(btrim(elem->>'header')) = lower(btrim(v_header))
    limit 1;
    v_matched := FOUND;

    if v_matched and v_sec_text is not null and v_sec_text <> '' then
      select cs.id into v_clone_section
      from sections cs
      where cs.workbook_id = v_clone_workbook
        and cs.template_section_id = v_sec_text::uuid
      limit 1;
      if v_clone_section is not null then
        insert into trainer_prep (session_id, section_id, content)
        values (p_session_id, v_clone_section, v_content)
        on conflict (session_id, section_id)
        do update set content = excluded.content, updated_at = now();
        v_prepped := v_prepped + 1;
        continue;
      end if;
    end if;

    insert into trainer_prep_standalone (session_id, label, content)
    values (p_session_id, v_header, v_content)
    on conflict (session_id, label)
    do update set content = excluded.content, updated_at = now();
    v_prepped := v_prepped + 1;
  end loop;

  return jsonb_build_object('status', 'allocated', 'prepped', v_prepped, 'kit_id', v_kit.id);
end $$;

revoke execute on function claim_trainer_prep_kit(uuid) from public;
grant execute on function claim_trainer_prep_kit(uuid) to authenticated;
