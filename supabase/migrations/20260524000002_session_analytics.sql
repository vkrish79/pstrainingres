-- Lightweight analytics surface for closed sessions.
--
-- close-session already saves the heavy answer-of-record blob to
-- sessions.closed_summary (the ONLY surviving copy of answers — participants
-- are hard-deleted on close). These two thin, typed tables are what analytics
-- queries hit instead of parsing that blob:
--   * session_analytics          — one aggregate row per closed session
--   * session_section_analytics  — one row per section per closed session, so a
--                                  single exercise's difficulty can be rolled up
--                                  across every cohort that ran the workbook.
-- Dimension keys (workbook/vendor/trainer/section) are denormalized uuids so
-- the rows survive later edits/deletes of those entities — this is a reporting
-- (fact) layer, not normalized OLTP.
--
-- Idempotent: safe to re-run (the GitHub→Supabase integration may retry).

-- ===== Per-session aggregate =====
create table if not exists session_analytics (
  session_id    uuid primary key references sessions(id) on delete cascade,
  workbook_id   uuid,
  vendor_id     uuid,
  trainer_id    uuid,
  -- timing
  starts_at         timestamptz,
  ends_at           timestamptz,
  closed_at         timestamptz not null default now(),
  duration_minutes  integer,            -- planned span (ends_at - starts_at), null if unknown
  first_activity_at timestamptz,        -- earliest answer timestamp
  last_activity_at  timestamptz,        -- latest answer timestamp
  -- volume
  participant_count integer not null default 0,
  section_count     integer not null default 0,
  block_count       integer not null default 0,   -- fillable blocks in the workbook
  -- completion
  total_slots           integer not null default 0,   -- participant_count * block_count
  answered_slots        integer not null default 0,
  completion_pct        numeric(5,2) not null default 0,
  fully_completed_count integer not null default 0,    -- participants at 100%
  not_started_count     integer not null default 0,    -- participants with 0 answers
  -- engagement
  flagged_count             integer not null default 0,  -- trainer flags
  trainer_noted_count       integer not null default 0,  -- trainer notes
  section_note_count        integer not null default 0,  -- participant section notes
  prepped_participant_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_session_analytics_workbook  on session_analytics(workbook_id);
create index if not exists idx_session_analytics_vendor    on session_analytics(vendor_id);
create index if not exists idx_session_analytics_trainer   on session_analytics(trainer_id);
create index if not exists idx_session_analytics_closed_at on session_analytics(closed_at);

-- ===== Per-section, per-session =====
create table if not exists session_section_analytics (
  session_id     uuid not null references sessions(id) on delete cascade,
  section_id     uuid not null,
  workbook_id    uuid,                  -- denormalized: group the same exercise across cohorts
  title          text,
  order_index    integer,
  block_count       integer not null default 0,   -- fillable blocks in the section
  participant_count integer not null default 0,
  total_slots       integer not null default 0,
  answered_slots    integer not null default 0,
  completion_pct    numeric(5,2) not null default 0,
  flagged_count     integer not null default 0,
  primary key (session_id, section_id)
);

create index if not exists idx_ssa_workbook_section on session_section_analytics(workbook_id, section_id);

-- ===== RLS: trainers read analytics for sessions they can see =====
-- Writes happen only via the service role (close-session), which bypasses RLS,
-- so only SELECT policies are needed. Mirrors participant_notes_trainer_read.
alter table session_analytics         enable row level security;
alter table session_section_analytics enable row level security;

drop policy if exists session_analytics_trainer_read on session_analytics;
create policy session_analytics_trainer_read on session_analytics for select using (
  is_super_trainer_or_above()
  or exists (
    select 1 from sessions s
    where s.id = session_analytics.session_id
      and ((s.vendor_id is not null and s.vendor_id = my_vendor_id()) or s.trainer_id = auth.uid())
  )
);

drop policy if exists session_section_analytics_trainer_read on session_section_analytics;
create policy session_section_analytics_trainer_read on session_section_analytics for select using (
  is_super_trainer_or_above()
  or exists (
    select 1 from sessions s
    where s.id = session_section_analytics.session_id
      and ((s.vendor_id is not null and s.vendor_id = my_vendor_id()) or s.trainer_id = auth.uid())
  )
);
