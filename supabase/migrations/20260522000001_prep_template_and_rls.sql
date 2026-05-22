-- R2 of the prep repository (see docs/prep-repository-next.md §9):
--   1. Per-workbook prep template *structure* (which exercises need prep),
--      set by the super trainer via an empty-template upload.
--   2. Tighten workbook_prep_kits write RLS: super reads any partition but
--      uploads only to the shared super pool (vendor_id IS NULL); vendor-tier
--      reads/writes only their own vendor partition.
--
-- Idempotent (see [[supabase-idempotent-migrations]]).

-- ========== 1. workbooks.prep_template ==========
-- Ordered JSON array [{ "section_id": "...", "header": "..." }] defining the
-- prep columns for this workbook. NULL / empty = no prep template set up yet.
alter table workbooks add column if not exists prep_template jsonb;

-- ========== 2. workbook_prep_kits RLS split ==========
-- Replaces the single FOR ALL `wpk_rw` policy.
drop policy if exists wpk_rw on workbook_prep_kits;
drop policy if exists wpk_read on workbook_prep_kits;
drop policy if exists wpk_write on workbook_prep_kits;

-- Read: super sees every partition (for the vendor filter); vendor-tier sees
-- only their own vendor's pool.
create policy wpk_read on workbook_prep_kits for select using (
  is_super_trainer_or_above()
  or (role_of_caller() in ('vendor_manager','vendor_trainer')
      and vendor_id is not null and vendor_id = my_vendor_id())
);

-- Write (insert/update/delete): super only the shared super pool
-- (vendor_id IS NULL); vendor-tier only their own vendor's pool.
-- claim/release/mark_used are SECURITY DEFINER and bypass this, so withdrawal
-- into vendor pools still works.
create policy wpk_write on workbook_prep_kits for all using (
  (is_super_trainer_or_above() and vendor_id is null)
  or (role_of_caller() in ('vendor_manager','vendor_trainer')
      and vendor_id is not null and vendor_id = my_vendor_id())
) with check (
  (is_super_trainer_or_above() and vendor_id is null)
  or (role_of_caller() in ('vendor_manager','vendor_trainer')
      and vendor_id is not null and vendor_id = my_vendor_id())
);
