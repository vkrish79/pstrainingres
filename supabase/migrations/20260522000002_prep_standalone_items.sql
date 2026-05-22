-- R3 of the prep repository (see docs/prep-repository-next.md §10):
-- prep items that are NOT tied to an exercise (e.g. a role-play PNR).
--   1. participant_prep_standalone — per-participant prep with no section.
--   2. Rewrite claim_prep_kit: kit payload keyed by header; route each value to
--      participant_prep (exercise-linked) or participant_prep_standalone, with a
--      header fallback so nothing is dropped.
--   3. Truncate workbook_prep_kits (test-only data; old payloads were keyed by
--      section_id and are incompatible with the new header-keyed model).
--
-- Idempotent (see [[supabase-idempotent-migrations]]).

-- ========== 1. participant_prep_standalone ==========
create table if not exists participant_prep_standalone (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  participant_id uuid not null references profiles(id) on delete cascade,
  label text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table participant_prep_standalone
    add constraint participant_prep_standalone_unique
    unique (session_id, participant_id, label);
exception when duplicate_object then null;
  when others then null;
end $$;

create index if not exists pps_session_idx on participant_prep_standalone (session_id);
create index if not exists pps_participant_idx on participant_prep_standalone (participant_id);

alter table participant_prep_standalone enable row level security;

drop trigger if exists trg_pps_updated on participant_prep_standalone;
create trigger trg_pps_updated
  before update on participant_prep_standalone
  for each row execute function set_updated_at();

-- Participant reads own; trainer-in-session (super / vendor_manager of vendor /
-- session trainer) full CRUD. Mirrors participant_prep.
drop policy if exists pps_self_read on participant_prep_standalone;
create policy pps_self_read on participant_prep_standalone
  for select using (participant_id = auth.uid());

drop policy if exists pps_trainer_all on participant_prep_standalone;
create policy pps_trainer_all on participant_prep_standalone
  for all using (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.id = participant_prep_standalone.session_id
        and ((s.vendor_id is not null and s.vendor_id = my_vendor_id())
             or s.trainer_id = auth.uid())
    )
  ) with check (
    is_super_trainer_or_above()
    or exists (
      select 1 from sessions s
      where s.id = participant_prep_standalone.session_id
        and ((s.vendor_id is not null and s.vendor_id = my_vendor_id())
             or s.trainer_id = auth.uid())
    )
  );

do $$ begin
  alter publication supabase_realtime add table participant_prep_standalone;
exception when duplicate_object then null;
  when others then null;
end $$;

-- ========== 2. Reset kits (test data; incompatible payload keying) ==========
truncate table workbook_prep_kits;

-- ========== 3. Rewrite claim_prep_kit (header-keyed payload) ==========
create or replace function claim_prep_kit(p_session_id uuid, p_participant_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_clone_workbook uuid;
  v_master_workbook uuid;
  v_vendor uuid;
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
  select s.workbook_id, s.vendor_id into v_clone_workbook, v_vendor
  from sessions s where s.id = p_session_id;
  if v_clone_workbook is null then
    return jsonb_build_object('status', 'none', 'prepped', 0);
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

  update workbook_prep_kits
  set status = 'allocated',
      consumed_session_id = p_session_id,
      consumed_participant_id = p_participant_id,
      consumed_at = now()
  where id = v_kit.id;

  -- payload is { "<header>": "content" }. Route each value by its template column.
  for v_header, v_content in select key, value from jsonb_each_text(v_kit.payload)
  loop
    if v_content is null or btrim(v_content) = '' then
      continue;
    end if;

    -- Look up the template column for this header (case-insensitive).
    select elem->>'section_id' into v_sec_text
    from jsonb_array_elements(coalesce(v_template, '[]'::jsonb)) elem
    where lower(btrim(elem->>'header')) = lower(btrim(v_header))
    limit 1;
    v_matched := FOUND;

    if v_matched and v_sec_text is not null and v_sec_text <> '' then
      -- Exercise-linked: map master section -> clone section.
      select cs.id into v_clone_section
      from sections cs
      where cs.workbook_id = v_clone_workbook
        and cs.template_section_id = v_sec_text::uuid
      limit 1;
      if v_clone_section is not null then
        insert into participant_prep (session_id, participant_id, section_id, content)
        values (p_session_id, p_participant_id, v_clone_section, v_content)
        on conflict (session_id, participant_id, section_id)
        do update set content = excluded.content, updated_at = now();
        v_prepped := v_prepped + 1;
        continue;
      end if;
      -- clone section missing (structural drift) -> fall through to standalone
    end if;

    -- Standalone (no template match, matched-but-no-section, or clone missing).
    insert into participant_prep_standalone (session_id, participant_id, label, content)
    values (p_session_id, p_participant_id, v_header, v_content)
    on conflict (session_id, participant_id, label)
    do update set content = excluded.content, updated_at = now();
    v_prepped := v_prepped + 1;
  end loop;

  return jsonb_build_object('status', 'allocated', 'prepped', v_prepped, 'kit_id', v_kit.id);
end $$;

revoke execute on function claim_prep_kit(uuid, uuid) from public;
grant execute on function claim_prep_kit(uuid, uuid) to service_role;
