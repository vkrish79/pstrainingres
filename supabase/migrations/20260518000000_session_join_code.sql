-- Session join codes for session-first enrolment.
--
-- Each session gets a short opaque code used in /join/:code URLs and in
-- the synthetic auth email namespace (username@{join_code}.pstrainingres.local).
-- See docs/vendor-trainer-model.md "Session-first enrolment + username identity".

create or replace function gen_join_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  ok boolean := false;
begin
  while not ok loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    perform 1 from sessions where join_code = code;
    if not found then ok := true; end if;
  end loop;
  return code;
end;
$$;

alter table sessions
  add column join_code text;

do $$
declare r record;
begin
  for r in select id from sessions where join_code is null loop
    update sessions set join_code = gen_join_code() where id = r.id;
  end loop;
end;
$$;

alter table sessions
  alter column join_code set not null,
  alter column join_code set default gen_join_code(),
  add constraint sessions_join_code_unique unique (join_code);
