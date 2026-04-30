-- pstrainingres: add a 3-letter city/location code to sessions
-- (e.g. AUH, DXB, LHR). Idempotent.

alter table sessions add column if not exists city_code text;

-- Optional sanity check: if set, should be 3 uppercase letters.
do $$ begin
  alter table sessions add constraint sessions_city_code_format
    check (city_code is null or city_code ~ '^[A-Z]{3}$');
exception when duplicate_object then null;
end $$;
