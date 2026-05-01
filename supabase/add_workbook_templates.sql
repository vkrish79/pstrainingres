-- pstrainingres: per-session workbook clones.
--
-- Each session gets its own deep copy of the chosen template workbook. Edits
-- to a session's workbook never affect other sessions or the template.
-- Idempotent — safe to re-run.

-- ========== SCHEMA ==========

alter table workbooks
  add column if not exists is_template boolean not null default true,
  add column if not exists template_id uuid references workbooks(id) on delete set null;

create index if not exists workbooks_is_template_idx on workbooks (is_template);

-- ========== ONE-TIME WIPE OF LEGACY SESSIONS ==========
-- Sessions created before this migration point at template workbooks (since
-- every existing workbook is now is_template=true by default). Wipe them so
-- the rollout starts clean. Cascades via existing FKs to session_participants,
-- answers, and answer_notes. Idempotent: a re-run finds no matching rows.

delete from sessions
where workbook_id in (select id from workbooks where is_template = true);

-- ========== ATOMIC CLONE + SESSION CREATE ==========
-- Returns the new session's id. Wraps workbook clone, sections clone, blocks
-- clone, and session insert in a single transaction so a failure midway can't
-- leave orphaned rows.

create or replace function create_session_with_workbook_clone(
  p_template_id uuid,
  p_name text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_city_code text default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_new_workbook_id uuid;
  v_new_session_id uuid;
  r_section record;
  v_new_section_id uuid;
begin
  if not is_trainer() then
    raise exception 'only trainers can create sessions';
  end if;

  -- Clone the workbook row (mark as a non-template; remember its parent).
  insert into workbooks (title, description, is_template, template_id, created_by)
  select title, description, false, id, auth.uid()
  from workbooks
  where id = p_template_id and is_template = true
  returning id into v_new_workbook_id;

  if v_new_workbook_id is null then
    raise exception 'template workbook % not found or is not a template', p_template_id;
  end if;

  -- Clone each section and its blocks, preserving order.
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

  -- Create the session pointing at the clone.
  insert into sessions (workbook_id, name, trainer_id, starts_at, ends_at, city_code)
  values (v_new_workbook_id, p_name, auth.uid(), p_starts_at, p_ends_at, p_city_code)
  returning id into v_new_session_id;

  return v_new_session_id;
end;
$$;

grant execute on function create_session_with_workbook_clone(uuid, text, timestamptz, timestamptz, text) to authenticated;
